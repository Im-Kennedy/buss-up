import { useState, useEffect } from "react"; //brings in usestate, how react remembers information
import "leaflet/dist/leaflet.css";//leaflets own styles, without this the map looks scrambled
import MapView from "./MapView.jsx";
import StopPicker from "./StopPicker.jsx";
import { minutesAway, isTracked, formatWait } from "./arrivals.js";
import { API } from "./api.js";

const REFRESH_MS = 30000;//re-ask the backend every 30 seconds

function App() {
    const [stop, setStop] = useState(null)//the whole stop object now, not just a number
    const [reloadKey, setReloadKey] = useState(0)//bumping this forces a re-fetch of the same stop
    const [arrivals, setArrivals] = useState([])//list of bus arrivals from the backend
    const [stopInfo, setStopInfo] = useState(null)//name + position the backend looked up for us
    const [loading, setLoading] = useState(false);//only true on a fresh search, not background refreshes
    const [error, setError] = useState('')//error messages
    const [position, setPosition] = useState(null)//[lat, lng] once the browser tells us, null until then
    //worked out up front rather than inside an effect, otherwise react re-renders twice
    const [geoError, setGeoError] = useState(() =>
        navigator.geolocation ? '' : "This browser can't do location."
    )//separate from error so a denied map doesnt hide arrivals
    const [updatedAt, setUpdatedAt] = useState(null)//when we last heard from the backend
    const [selectedId, setSelectedId] = useState(null)//which bus the user clicked in the list
    const [place, setPlace] = useState(null)//a street/landmark searched instead of using gps
    const [nearby, setNearby] = useState([])//stops around whichever point were centred on
    //stored with the id it belongs to, so we can tell whether it matches the
    //currently selected bus instead of clearing it in an effect
    const [shapeCache, setShapeCache] = useState({ id: null, points: null })

    const activeStop = stop?.id || null

    //a searched place wins over gps, so you can look up stops anywhere on oahu
    //even if youre not on the island. derived, not stored, so theres no effect
    //fighting to keep two bits of state in sync
    const center = place ? [place.lat, place.lon] : position
    const centerLabel = place ? place.name : "you"
    const centerKey = place ? `place:${place.lat},${place.lon}` : position ? "gps" : ""

    //pulled out as plain numbers so the effect below has simple, checkable deps
    const centerLat = center ? center[0] : null
    const centerLon = center ? center[1] : null

    //runs once when the page first loads. [] at the bottom means "only once"
    useEffect(() => {
        if (!navigator.geolocation) return//really old browsers, message already set above

        //this is what pops up the browsers "allow location?" permission box
        navigator.geolocation.getCurrentPosition(
            (pos) => {//success, browser hands us a position object
                setPosition([pos.coords.latitude, pos.coords.longitude])
            },
            (err) => {//user hit block, or it timed out
                setGeoError(
                    err.code === err.PERMISSION_DENIED
                        ? "Location off, so we can't list stops near you. Search by name instead."
                        : "Couldn't get your location."
                )
            }
        )
    }, [])

    //stops around the current centre, whether thats your gps fix or a searched
    //street. these show as chips up top AND as rings on the map
    useEffect(() => {
        if (centerLat === null || centerLon === null) return

        let cancelled = false

        fetch(`${API}/stops/near?lat=${centerLat}&lon=${centerLon}&limit=6`)
            .then((r) => r.json())
            .then((d) => { if (!cancelled) setNearby(d.stops || []) })
            .catch(() => { if (!cancelled) setNearby([]) })

        return () => { cancelled = true }
        //primitives, not the array, or this refires on every render
    }, [centerLat, centerLon])

    //re-runs whenever the chosen stop changes. also sets up the 30s timer
    useEffect(() => {
        if (!activeStop) return//nothing picked yet

        let cancelled = false//guards against a slow response landing after we moved on

        const load = async (isFirstLoad) => {
            if (isFirstLoad) setLoading(true)//spinner only on a real search, refreshes stay quiet

            try {
                const response = await fetch(`${API}/arrivals/${activeStop}`)
                const data = await response.json();//convert response to json
                if (cancelled) return

                setArrivals(data.arrivals || [])
                setStopInfo(data)
                setUpdatedAt(new Date())
                setError('')
            } catch {
                if (!cancelled) setError('Could not get arrivals. Is the backend running?')
            } finally {
                if (!cancelled && isFirstLoad) setLoading(false)
            }
        }

        load(true)//fetch straight away
        const timer = setInterval(() => load(false), REFRESH_MS)//then keep it fresh

        //react runs this when the stop changes or the page closes.
        //without it every search would leave another timer running forever
        return () => {
            cancelled = true
            clearInterval(timer)
        }
    }, [activeStop, reloadKey])

    const selected = arrivals.find((a) => a.id === selectedId) || null
    const trackedCount = arrivals.filter(isTracked).length

    //once a bus passes the stop it drops out of the feed. `selected` goes null on
    //its own then, so the highlight and the route line both disappear by themselves

    //only draw the line if it belongs to the bus thats actually selected right now
    const shape = shapeCache.id && shapeCache.id === selected?.shape ? shapeCache.points : null

    //pull the driving path for whichever bus is selected. the arrivals feed gives
    //us a shape id, the backend turns that into a list of points from the gtfs data
    useEffect(() => {
        const shapeId = selected?.shape
        if (!shapeId) return

        let cancelled = false

        fetch(`${API}/shape/${shapeId}`)
            .then((r) => (r.ok ? r.json() : null))
            .then((d) => {
                if (!cancelled) setShapeCache({ id: shapeId, points: d?.points || null })
            })
            .catch(() => {
                if (!cancelled) setShapeCache({ id: shapeId, points: null })
            })

        return () => { cancelled = true }
    }, [selected?.shape])

    const pickStop = (next) => {
        setSelectedId(null)//clear any highlighted bus from the last stop
        setArrivals([])
        setStop(next)
        setReloadKey((n) => n + 1)//makes picking the same stop twice actually refetch
    }

    return (
        <div className="app">
            {/* app title */}
            <header className="app-head">
                <div className="brand">
                    <span className="brand-mark">🚌</span>
                    <div>
                        <h1>Buss Up</h1>
                        <p className="subtitle">Real-time arrivals for Oahu</p>
                    </div>
                </div>
            </header>

            <StopPicker
                nearby={nearby}
                centerLabel={centerLabel}
                activeStop={activeStop}
                onPickStop={pickStop}
                onPickPlace={setPlace}
            />

            {place && (
                <p className="geo-note">
                    Showing stops near {place.name}.{" "}
                    <button className="link" onClick={() => setPlace(null)}>
                        {position ? "Back to my location" : "Clear"}
                    </button>
                </p>
            )}

            {!position && !place && geoError && <p className="geo-note">{geoError}</p>}

            {/*map sits under the search box. shows oahu until a stop is picked*/}
            <section className="panel">
                <MapView
                    position={position}
                    arrivals={arrivals}
                    selectedId={selectedId}
                    stop={stopInfo}
                    shape={shape}
                    nearby={nearby}
                    center={center}
                    centerKey={centerKey}
                    onPickStop={pickStop}
                />

                <div className="legend">
                    <span className="legend-item"><i className="dot dot-you" />You</span>
                    <span className="legend-item"><i className="dot dot-stop" />Stop</span>
                    <span className="legend-item"><i className="dot dot-bus" />Bus now</span>
                    {selected && <span className="legend-item"><i className="dot dot-line" />Route {selected.route}</span>}
                </div>
            </section>

            {/*error*/}
            {error && <p className="alert">{error}</p>}

            {/* loading message*/}
            {loading && <p className="muted">Loading arrivals...</p>}

            {!activeStop && !loading && (
                <div className="empty-state">
                    <p className="empty-title">Pick a stop to get started</p>
                    <p className="muted">
                        Tap one of the stops near you, or search by name like "Ala Moana".
                    </p>
                </div>
            )}

            {activeStop && !loading && !error && (
                <>
                    <div className="results-head">
                        <div>
                            <h2>{stopInfo?.stopName || stop?.name || `Stop ${activeStop}`}</h2>
                            <p className="stop-sub">
                                Stop #{activeStop}
                                {arrivals.length > 0 && ` · ${arrivals.length} coming · ${trackedCount} live`}
                            </p>
                        </div>
                        {updatedAt && (
                            <span className="updated">
                                Updated {updatedAt.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                                <br />refreshes every 30s
                            </span>
                        )}
                    </div>

                    {arrivals.length === 0 && (
                        <p className="muted">No buses due here right now.</p>
                    )}
                </>
            )}

            {/*loop through arrivals and show each*/}
            {arrivals.map((arrival) => {
                const mins = minutesAway(arrival)
                const tracked = isTracked(arrival)

                return (
                    <div
                        key={arrival.id}
                        className={
                            "arrival-card"
                            + (selectedId === arrival.id ? " is-selected" : "")
                            + (tracked ? "" : " is-untracked")
                        }
                        //only buses we can actually point at on the map are clickable
                        onClick={() => tracked && setSelectedId(arrival.id === selectedId ? null : arrival.id)}
                    >
                        {/*left: route number badge*/}
                        <div className="route-badge">{arrival.route}</div>

                        {/*middle destination name */}
                        <div className="arrival-info">
                            <p className="headsign">{arrival.headsign}</p>
                            <p className="meta">
                                {tracked
                                    ? (selectedId === arrival.id ? "Showing route on map" : "Tap to trace its route")
                                    : "Not sending location yet"}
                            </p>
                        </div>

                        {/*arrival time right*/}
                        <div className="arrival-time">
                            <span className={"mins" + (mins !== null && mins <= 2 ? " mins-soon" : "")}>
                                {formatWait(mins) ?? arrival.stopTime}
                            </span>
                            <span className="clock">{arrival.stopTime}</span>
                        </div>
                    </div>
                )
            })}
        </div>
    )
}

export default App;//makes this usable by other files
