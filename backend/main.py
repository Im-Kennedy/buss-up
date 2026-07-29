from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import httpx # lets python call busapi
import os #read api key
import json
import math
import time
from dotenv import load_dotenv

load_dotenv() #reads . end file

API_KEY = os.getenv("THEBUS_API_KEY")#grabss value of api key from .env

DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")

app = FastAPI() #creates fastapi. this app objet is wha teverything is attache to
                #every endpoint we make gets added to this object

#which frontends are allowed to call us. locally thats vite on 5173, in production
#its the deployed site, set as ALLOWED_ORIGINS (comma separated) on the host.
#browsers block the request entirely if the origin isnt on this list
ALLOWED_ORIGINS = [
    origin.strip()
    for origin in os.getenv("ALLOWED_ORIGINS", "http://localhost:5173").split(",")
    if origin.strip()
]

app.add_middleware(#cross origin resource sharing
    #middleware allows different ports to talk to each other to test locally
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,

    #allows origin is the list of frontends allowed to talk to backend, currently just react
    allow_methods=["*"],#allows http(get,post)
    allow_headers=["*"],#allow headers with requests
)


def load_json(name):
    """reads one of the files build_gtfs.py made. missing file just means
       we havent built them yet, so the app still runs, just without names"""
    path = os.path.join(DATA_DIR, name)

    if not os.path.exists(path):
        print(f"warning: {path} missing. run: python build_gtfs.py")
        return None

    with open(path) as f:
        return json.load(f)


#loaded once when the server boots, not per request
STOPS = load_json("stops.json") or []
SHAPES = load_json("shapes.json") or {}

#stop number -> stop, so looking one up is instant instead of scanning 3800 rows
STOPS_BY_ID = {}
for _stop in STOPS:
    STOPS_BY_ID[str(_stop["id"])] = _stop
    STOPS_BY_ID.setdefault(str(_stop["code"]), _stop)


def meters_between(lat1, lon1, lat2, lon2):
    """rough distance in meters. flat-earth math is fine across one island"""
    dlat = (lat2 - lat1) * 111320
    dlon = (lon2 - lon1) * 111320 * math.cos(math.radians(lat1))
    return math.hypot(dlat, dlon)


#thebus updates every 30-60s, so hitting them more often than that just wastes
#requests. we hold each stops answer briefly and hand out the same one
ARRIVALS_CACHE = {}
CACHE_SECONDS = 15


#first endpoint to test
#HEAD as well as GET: renders health check and most uptime pingers send HEAD,
#and a GET-only route answers those with 405, which reads as "service is broken"
@app.api_route("/", methods=["GET", "HEAD"])#decorater, tells fastapi to run this when someone does a get request
def home():#function runs when url is called
    return {
        "mesasage": "Buss Up API is running!",#fastpi converste this python dict to JSON
        "stops_loaded": len(STOPS),
        "shapes_loaded": len(SHAPES),
    }


@app.get("/stops/near")#/stops/near?lat=21.30&lon=-157.85
def stops_near(lat: float, lon: float, limit: int = 8):
    """closest stops to a point. this is what lets people skip knowing stop numbers"""
    if not STOPS:
        raise HTTPException(status_code=503, detail="stop data not built yet, run build_gtfs.py")

    scored = []
    for stop in STOPS:
        meters = meters_between(lat, lon, stop["lat"], stop["lon"])
        scored.append((meters, stop))

    scored.sort(key=lambda pair: pair[0])#nearest first

    return {
        "stops": [
            {**stop, "meters": round(meters)}
            for meters, stop in scored[:limit]
        ]
    }


@app.get("/stops/search")#/stops/search?q=ala moana
def stops_search(q: str, limit: int = 10):
    """type a place name instead of a stop number"""
    if not STOPS:
        raise HTTPException(status_code=503, detail="stop data not built yet, run build_gtfs.py")

    needle = q.strip().upper()
    if not needle:
        return {"stops": []}

    #a stop number typed straight in should still win
    exact = STOPS_BY_ID.get(needle)
    hits = [exact] if exact else []

    for stop in STOPS:
        if len(hits) >= limit:
            break
        if stop is exact:
            continue
        if needle in stop["name"].upper():
            hits.append(stop)

    return {"stops": hits}


@app.get("/shape/{shape_id}")
def shape(shape_id: str):
    """the actual path a bus drives, so we can draw it on the map"""
    points = SHAPES.get(shape_id)

    if points is None:
        raise HTTPException(status_code=404, detail="unknown shape")

    return {"shape": shape_id, "points": points}


@app.get("/arrivals/{stop_id}")#creates endpoint at arrivals, stop id is variable example, /arriavls/4287
async def get_arrivals(stop_id: str):#async pause and wait for api to respond, stop_id:str means fastapi grabs stopid from url and passes it as string
    cached = ARRIVALS_CACHE.get(stop_id)
    if cached and time.time() - cached["at"] < CACHE_SECONDS:
        return cached["payload"]#still fresh, dont bother thebus again

    #arrivalsJSON is the json version of the old /arrivals/ xml endpoint
    url = f"http://api.thebus.org/arrivalsJSON/?key={API_KEY}&stop={stop_id}"#builds full bus api url

    async with httpx.AsyncClient() as client:#creates http client(like opening browser), async automaticadlly closes connect when done
        response = await client.get(url)#calls bus api and wait for response.

    data = response.json()#already json, no xml parsing needed
    stop = STOPS_BY_ID.get(str(stop_id))#gtfs knows the name, the realtime feed doesnt

    payload = {
        "stop": data.get("stop"),
        "stopName": stop["name"] if stop else None,
        "stopLat": stop["lat"] if stop else None,
        "stopLon": stop["lon"] if stop else None,
        "timestamp": data.get("timestamp"),
        "arrivals": data.get("arrivals", [])#empty list when no buses are coming
    }#gets response from the bus, convert to jason and send bck to endpoint/

    ARRIVALS_CACHE[stop_id] = {"at": time.time(), "payload": payload}
    return payload

# User types stop 4287 in React
# → React calls http://localhost:8000/arrivals/4287
# → FastAPI builds the TheBus URL with your secret API key
# → TheBus sends back arrival data
# → FastAPI sends it to React
# → React displays it on screen
