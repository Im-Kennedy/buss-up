"""
Turns TheBus GTFS feed into two small json files the api loads at startup.

TheBus realtime api only gives us stop NUMBERS and shape IDs, no stop names and
no route lines. Both of those live in the gtfs feed instead, which is a static
zip they publish. Run this once (and again whenever routes change):

    .venv/bin/python build_gtfs.py

writes data/stops.json and data/shapes.json
"""

import csv
import io
import json
import math
import os
import sys
import urllib.request
import zipfile

GTFS_URL = "http://thebus.org/transitdata/production/google_transit.zip"
DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")

#shapes.txt is 278k points. drawing every one is pointless at map zoom, so we
#drop points closer than this to the previous kept point
MIN_POINT_GAP_M = 15


def meters_between(lat1, lon1, lat2, lon2):
    """rough distance in meters. good enough for thinning out shape points"""
    dlat = (lat2 - lat1) * 111320
    dlon = (lon2 - lon1) * 111320 * math.cos(math.radians(lat1))
    return math.hypot(dlat, dlon)


def download(url):
    print(f"downloading {url} ...")
    with urllib.request.urlopen(url, timeout=300) as response:
        return response.read()


def build_stops(archive):
    """stop_id -> name and position, so we can name stops and find nearby ones"""
    with archive.open("stops.txt") as f:
        reader = csv.DictReader(io.TextIOWrapper(f, encoding="utf-8-sig"))
        stops = []

        for row in reader:
            try:
                lat = float(row["stop_lat"])
                lon = float(row["stop_lon"])
            except (ValueError, KeyError):
                continue#a few rows have blank coords, skip them

            stops.append({
                "id": row["stop_id"],
                "code": row.get("stop_code") or row["stop_id"],
                "name": row["stop_name"],
                "lat": lat,
                "lon": lon,
            })

    return stops


def build_shapes(archive):
    """shape_id -> list of [lat, lon] points, thinned down"""
    with archive.open("shapes.txt") as f:
        reader = csv.DictReader(io.TextIOWrapper(f, encoding="utf-8-sig"))
        raw = {}

        for row in reader:
            try:
                point = (
                    int(row["shape_pt_sequence"]),
                    float(row["shape_pt_lat"]),
                    float(row["shape_pt_lon"]),
                )
            except (ValueError, KeyError):
                continue

            raw.setdefault(row["shape_id"], []).append(point)

    shapes = {}
    kept = dropped = 0

    for shape_id, points in raw.items():
        points.sort()#sequence order, otherwise the line zigzags
        thinned = []

        for _, lat, lon in points:
            if not thinned or meters_between(thinned[-1][0], thinned[-1][1], lat, lon) >= MIN_POINT_GAP_M:
                thinned.append([round(lat, 5), round(lon, 5)])
            else:
                dropped += 1

        #always keep the true end point so the line doesnt stop short
        last = [round(points[-1][1], 5), round(points[-1][2], 5)]
        if thinned[-1] != last:
            thinned.append(last)

        kept += len(thinned)
        shapes[shape_id] = thinned

    print(f"shapes: kept {kept} points, dropped {dropped}")
    return shapes


def main():
    os.makedirs(DATA_DIR, exist_ok=True)

    #let you point at an already downloaded zip: python build_gtfs.py path/to.zip
    if len(sys.argv) > 1:
        with open(sys.argv[1], "rb") as f:
            blob = f.read()
    else:
        blob = download(GTFS_URL)

    archive = zipfile.ZipFile(io.BytesIO(blob))

    stops = build_stops(archive)
    shapes = build_shapes(archive)

    stops_path = os.path.join(DATA_DIR, "stops.json")
    shapes_path = os.path.join(DATA_DIR, "shapes.json")

    with open(stops_path, "w") as f:
        json.dump(stops, f)

    with open(shapes_path, "w") as f:
        json.dump(shapes, f, separators=(",", ":"))#no spaces, keeps the file small

    print(f"wrote {len(stops)} stops -> {stops_path} ({os.path.getsize(stops_path) // 1024} KB)")
    print(f"wrote {len(shapes)} shapes -> {shapes_path} ({os.path.getsize(shapes_path) // 1024} KB)")


if __name__ == "__main__":
    main()
