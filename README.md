# Buss Up 🚌

Real-time bus arrivals for Oahu. React frontend, FastAPI backend, data from
TheBus API plus their public GTFS feed.

- pick a stop from the ones nearest you, or search by name
- live arrivals with minutes-until, refreshed every 30s
- map showing your location, the stop, and every bus currently reporting GPS
- tap a bus to trace the stretch of road it still has to drive to reach you

## Running it locally

You need Node 20+ and Python 3.12.

**1. Backend**

```bash
cd backend
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
```

Create `backend/.env` with your key from
[TheBus developer page](http://hea.thebus.org/api_info.asp):

```
THEBUS_API_KEY=your-key-here
```

**2. Build the GTFS data (required)**

```bash
cd backend && .venv/bin/python build_gtfs.py
```

This downloads TheBus GTFS feed (~11MB) and writes `data/stops.json` and
`data/shapes.json`. The realtime API only returns stop *numbers* and shape
IDs, so without this step there are no stop names, no nearby-stop search
(`/stops/near` returns 503), and no route lines.

`data/` is gitignored, so run this again on any fresh clone. Re-run it every
few months, or whenever routes change — the feed is a static snapshot.

**3. Start both servers**

```bash
./dev.sh
```

Or in two terminals: `.venv/bin/python -m uvicorn main:app --reload` in
`backend/`, and `npm run dev` in `frontend/`. Then open http://localhost:5173.

## API

| endpoint | what it does |
| --- | --- |
| `/arrivals/{stop_id}` | upcoming buses, with the stop's name and position. cached 15s |
| `/stops/near?lat=&lon=` | closest stops to a point, with distance |
| `/stops/search?q=` | stop lookup by name or number |
| `/shape/{shape_id}` | the points making up a route line |

## Deploying

Backend on Render, frontend on Vercel, both free.

**Backend (Render)**

1. New → Blueprint, point it at this repo. It reads `render.yaml`.
2. Set `THEBUS_API_KEY` when prompted.
3. Leave `ALLOWED_ORIGINS` blank for now — you don't know the frontend URL yet.
4. Deploy, then copy the service URL (`https://buss-up-api.onrender.com`).

**Frontend (Vercel)**

1. Import this repo, set **Root Directory** to `frontend`.
2. Add env var `VITE_API_URL` = the Render URL from above.
3. Deploy, then copy the Vercel URL.

**Then connect them**

Back on Render, set `ALLOWED_ORIGINS` to the Vercel URL and redeploy.
Without this the browser blocks every request with a CORS error.

Note: Render's free tier sleeps after ~15 minutes idle, so the first
request after a quiet spell takes about a minute.
