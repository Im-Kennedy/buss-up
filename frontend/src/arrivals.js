//helpers for working with the arrival data the backend hands us.
//these live in their own file so App.jsx only exports the component,
//otherwise vite cant hot-reload and does a full page refresh on every edit

//turns "7/28/2026" + "1:54 PM" into a real date object so we can do math on it
export function parseArrival(dateStr, timeStr) {
    if (!dateStr || !timeStr) return null;
    const [month, day, year] = dateStr.split("/").map(Number);
    const [clock, ampm] = timeStr.trim().split(" ");
    const [rawHour, minute] = clock.split(":").map(Number);

    let hour = rawHour;
    if (/pm/i.test(ampm) && hour !== 12) hour += 12;//1 pm -> 13
    if (/am/i.test(ampm) && hour === 12) hour = 0;//12 am -> 0

    return new Date(year, month - 1, day, hour, minute);
}

//"5 min" reads way faster than "1:54 PM" when youre standing at a stop
export function minutesAway(arrival) {
    const when = parseArrival(arrival.date, arrival.stopTime);
    if (!when) return null;
    return Math.round((when - new Date()) / 60000);
}

//rough metres between two points. flat-earth maths is fine across one island
function metresBetween(aLat, aLon, bLat, bLon) {
    const dlat = (bLat - aLat) * 111320;
    const dlon = (bLon - aLon) * 111320 * Math.cos((aLat * Math.PI) / 180);
    return Math.hypot(dlat, dlon);
}

//a bus further than this from the route line isnt really driving that line yet:
//usually its finishing an earlier trip or heading to the start. snapping it to
//the "nearest" point anyway drew a short line miles from the actual bus
const MAX_OFF_ROUTE_M = 400;

//same idea for the stop sequence, allowing for genuinely sparse rural stops
const MAX_OFF_STOP_M = 800;

//which point on a route line is closest to a given spot.
//plain squared distance, no square root, since we only care which is smallest
export function nearestPointIndex(points, lat, lon) {
    let best = 0;
    let bestDist = Infinity;

    for (let i = 0; i < points.length; i++) {
        const dlat = points[i][0] - lat;
        const dlon = points[i][1] - lon;
        const dist = dlat * dlat + dlon * dlon;

        if (dist < bestDist) {
            bestDist = dist;
            best = i;
        }
    }

    return best;
}

//the stretch of road the bus still has to cover before it reaches you.
//gtfs lists shape points in travel order, so "between the two indexes" is
//already the direction its driving
export function upcomingSegment(points, busLat, busLon, stopLat, stopLon) {
    if (!points || points.length < 2) return null;

    const from = nearestPointIndex(points, busLat, busLon);
    const to = nearestPointIndex(points, stopLat, stopLon);

    //bail if the bus isnt actually anywhere near this line. without this the
    //match still "succeeds" and draws a stub of road nowhere near the bus
    const offBy = metresBetween(busLat, busLon, points[from][0], points[from][1]);
    if (offBy > MAX_OFF_ROUTE_M) return null;

    if (from === to) return null;
    if (from < to) return points.slice(from, to + 1);

    //bus is already past this stop on the shape, nothing left to draw
    return null;
}

//thebus sends headsigns html-encoded, so "WAIKIKI BEACH & HOTELS" arrives as
//"WAIKIKI BEACH &amp; HOTELS". react escapes output, so it renders literally.
//explicit replacements rather than innerHTML, which would run markup
const ENTITIES = {
    "&amp;": "&",
    "&quot;": '"',
    "&#39;": "'",
    "&apos;": "'",
    "&lt;": "<",
    "&gt;": ">",
    "&nbsp;": " ",
};

export function decodeText(text) {
    if (!text) return text;
    return text.replace(/&(amp|quot|#39|apos|lt|gt|nbsp);/g, (m) => ENTITIES[m] || m);
}

//distance means more as "how long will this take me"
export function walkTime(meters) {
    const mins = Math.round(meters / 80);//~80 m/min is a normal walking pace
    if (mins <= 1) return "1 min walk";
    return `${mins} min walk`;
}

//how many stops the bus still has to call at before it reaches yours.
//routeStops is the shapes stop list in travel order, so this is just the gap
//between two positions in that list. the bus is usually BETWEEN stops, so we
//snap it to the nearest one, which can be off by one either way
export function stopsAway(routeStops, busLat, busLon, myStopId) {
    if (!routeStops || routeStops.length === 0 || !myStopId) return null;

    const mine = routeStops.findIndex((s) => String(s.id) === String(myStopId));
    if (mine < 0) return null;//your stop isnt on this buses route at all

    let busAt = -1;
    let best = Infinity;

    for (let i = 0; i < routeStops.length; i++) {
        const dlat = routeStops[i].lat - busLat;
        const dlon = routeStops[i].lon - busLon;
        const dist = dlat * dlat + dlon * dlon;//squared is enough to rank them

        if (dist < best) {
            best = dist;
            busAt = i;
        }
    }

    if (busAt < 0 || busAt >= mine) return null;//already passed, or right at it

    //same guard as the route line: if the bus isnt near any stop on this route,
    //its not running it yet and any count would be made up
    const near = routeStops[busAt];
    if (metresBetween(busLat, busLon, near.lat, near.lon) > MAX_OFF_STOP_M) return null;

    return mine - busAt;
}

//"107 min" is hard to read at a glance, "1h 47m" isnt
export function formatWait(mins) {
    if (mins === null) return null;
    if (mins <= 0) return "Due";
    if (mins < 60) return `${mins} min`;

    const hours = Math.floor(mins / 60);
    const rest = mins % 60;
    return rest ? `${hours}h ${rest}m` : `${hours}h`;
}

//buses with no gps report 0/0, we cant put those on the map
export function isTracked(arrival) {
    const lat = parseFloat(arrival.latitude);
    const lng = parseFloat(arrival.longitude);
    return Boolean(lat && lng) && !Number.isNaN(lat) && !Number.isNaN(lng);
}
