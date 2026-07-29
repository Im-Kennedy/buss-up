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

    if (from === to) return null;
    if (from < to) return points.slice(from, to + 1);

    //bus is already past this stop on the shape, nothing left to draw
    return null;
}

//distance means more as "how long will this take me"
export function walkTime(meters) {
    const mins = Math.round(meters / 80);//~80 m/min is a normal walking pace
    if (mins <= 1) return "1 min walk";
    return `${mins} min walk`;
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
