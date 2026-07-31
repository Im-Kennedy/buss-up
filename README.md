# Buss Up 🚌

Real-time bus arrivals for Oahu, Hawaii. React frontend, FastAPI backend, data
from TheBus API plus their public GTFS feed.

**Live:** [buss-up.vercel.app](https://buss-up.vercel.app)

Covers TheBus on Oahu only.

## What it does

- opens in Waikīkī with nearby stops already listed — no permission prompt
  on load, location is a "use my location" button
- find a stop from the ones nearest you, by name, or by street/landmark
  ("bannister street", "diamond head")
- stops load around wherever the map is pointed and refresh as you pan
- live arrivals showing minutes-until, auto-refreshed every 30s
- map showing your location, the stop, and every bus currently reporting GPS
- tap a bus to draw the stretch of road it still has to drive to reach you
- light/dark/auto theme, including matching map tiles

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

This downloads TheBus GTFS feed (~11MB) and writes `data/stops.json` (3,847
stops) and `data/shapes.json` (532 route shapes). The realtime API only returns
stop *numbers* and shape IDs, so without this step there are no stop names, no
nearby-stop search (`/stops/near` returns 503), and no route lines.

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
| `/stops/near?lat=&lon=` | closest stops to a point, with distance in metres |
| `/stops/search?q=` | stop lookup by name or number |
| `/geocode?q=` | street/landmark to coordinates, boxed to Oahu. cached |
| `/shape/{shape_id}` | the points making up a route line |

Geocoding uses OpenStreetMap's Nominatim. Results are cached server-side and
the frontend debounces typing, which keeps a personal-scale app inside their
usage policy. Heavier traffic would want a paid geocoder.

## How it fits together

```
frontend/src
  App.jsx         state, arrival polling, layout
  MapView.jsx     leaflet map, markers, route lines, selected-bus strip
  StopPicker.jsx  search box, results dropdown, nearby chips
  arrivals.js     time/distance helpers, shared by both views
  api.js          backend URL (VITE_API_URL, defaults to localhost)

backend
  main.py         the api
  build_gtfs.py   turns the gtfs feed into data/*.json
  data/           generated, gitignored
```

Things worth knowing before changing anything:

- **Leaflet's CSS is imported in `main.jsx`, before `index.css`.** Whatever
  loads last wins, and our theme has to override Leaflet's popup colors.
- **The map instance lives in state, not a ref.** A ref is still null when
  effects first run, so anything attaching a listener once would miss it.
- **Popups have `autoPan` off.** An open popup pans the map back toward its own
  marker, which fought every attempt to navigate somewhere else.
- **Buses with no GPS report `0`/`0`** and are filtered out of the map, so the
  arrival list is often longer than the number of pins.
- **Headsigns arrive HTML-encoded** (`WAIKIKI BEACH &amp; HOTELS`) and are
  decoded before rendering.

## Deploying

Backend on Render, frontend on Vercel, both free.

**Backend (Render)**

1. New → Blueprint, point it at this repo. It reads `render.yaml`.
2. Set `THEBUS_API_KEY` when prompted.
3. Leave `ALLOWED_ORIGINS` blank for now — you don't know the frontend URL yet.
4. Deploy, then copy the service URL (`https://buss-up.onrender.com`).

**Frontend (Vercel)**

1. Import this repo, set **Root Directory** to `frontend`.
2. Add env var `VITE_API_URL` = the Render URL from above.
3. Deploy, then copy the Vercel URL.

**Then connect them**

Back on Render, set `ALLOWED_ORIGINS` to the Vercel URL and redeploy.
Without this the browser blocks every request with a CORS error. Trailing
slashes are stripped, so pasting straight from the address bar is fine.

Note: Render's free tier sleeps after ~15 minutes idle, so the first request
after a quiet spell takes about a minute. Every deploy re-runs `build_gtfs.py`,
so stop and route data refreshes on each push.
