import { useState, useEffect } from "react"; //brings in usestate, how react remembers information
import MapView from "./MapView.jsx";//leaflets css is loaded in main.jsx, before our theme
import StopPicker from "./StopPicker.jsx";
import { minutesAway, isTracked, formatWait, decodeText } from "./arrivals.js";
import { API } from "./api.js";

const REFRESH_MS = 30000;//re-ask the backend every 30 seconds
const SHOW_AT_FIRST = 6;//thebus returns ~25 arrivals, hours out. nobody scrolls that

//where we start when we dont know (and arent asking) where you are.
//waikiki, because its the bit of oahu a stranger will recognise
const DEFAULT_CENTER = [21.2793, -157.8292]
const DEFAULT_LABEL = "Waikīkī"

//rough box around oahu. a gps fix outside this is real, just useless here
const OAHU = { minLat: 21.20, maxLat: 21.75, minLon: -158.32, maxLon: -157.60 }

function onOahu([lat, lon]) {
    return lat >= OAHU.minLat && lat <= OAHU.maxLat && lon >= OAHU.minLon && lon <= OAHU.maxLon
}

const THEMES = ["auto", "light", "dark"]//tapping the button walks this list
const THEME_ICON = { auto: "◐", light: "☀", dark: "☾" }

function App() {
    const [stop, setStop] = useState(null)//the whole stop object now, not just a number
    const [reloadKey, setReloadKey] = useState(0)//bumping this forces a re-fetch of the same stop
    const [arrivals, setArrivals] = useState([])//list of bus arrivals from the backend
    const [stopInfo, setStopInfo] = useState(null)//name + position the backend looked up for us
    const [loading, setLoading] = useState(false);//only true on a fresh search, not background refreshes
    const [error, setError] = useState('')//error messages
    const [position, setPosition] = useState(null)//[lat, lng] once the browser tells us, null until then
    const [geoError, setGeoError] = useState('')//separate from error so a denied map doesnt hide arrivals
    const [geoBusy, setGeoBusy] = useState(false)//waiting on the browsers permission box
    const [updatedAt, setUpdatedAt] = useState(null)//when we last heard from the backend
    const [selectedId, setSelectedId] = useState(null)//which bus the user clicked in the list
    const [place, setPlace] = useState(null)//a street/landmark searched instead of using gps
    const [nearby, setNearby] = useState([])//stops around whichever point were centred on
    const [showAll, setShowAll] = useState(false)//expand past the first handful of arrivals
    const [stuck, setStuck] = useState(false)//true once youve scrolled, to line the header
    //"auto" follows the phone. picking light or dark overrides it and sticks
    const [theme, setTheme] = useState(() => localStorage.getItem("theme") || "auto")
    const [systemDark, setSystemDark] = useState(
        () => window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false
    )

    const [mapView, setMapView] = useState(null)//where the map is looking right now
    const [mapStops, setMapStops] = useState([])//stops around that spot

    //the css keys off this attribute. removing it entirely hands control back
    //to the phones own setting
    useEffect(() => {
        const root = document.documentElement

        if (theme === "auto") root.removeAttribute("data-theme")
        else root.setAttribute("data-theme", theme)

        localStorage.setItem("theme", theme)
    }, [theme])

    //keeps "auto" honest if you flip the system setting while the page is open
    useEffect(() => {
        const mq = window.matchMedia?.("(prefers-color-scheme: dark)")
        if (!mq) return

        const onChange = (e) => setSystemDark(e.matches)
        mq.addEventListener("change", onChange)
        return () => mq.removeEventListener("change", onChange)
    }, [])

    //what the map tiles need to know: are we actually dark right now
    const isDark = theme === "dark" || (theme === "auto" && systemDark)

    //the header only grows its bottom border once content slides under it
    useEffect(() => {
        const onScroll = () => setStuck(window.scrollY > 4)
        window.addEventListener("scroll", onScroll, { passive: true })
        return () => window.removeEventListener("scroll", onScroll)
    }, [])
    //stored with the id it belongs to, so we can tell whether it matches the
    //currently selected bus instead of clearing it in an effect
    const [shapeCache, setShapeCache] = useState({ id: null, points: null })

    const activeStop = stop?.id || null

    //a searched place wins over gps, so you can look up stops anywhere on oahu
    //even if youre not on the island. derived, not stored, so theres no effect
    //fighting to keep two bits of state in sync
    const center = place ? [place.lat, place.lon] : position || DEFAULT_CENTER
    const centerLabel = place ? place.name : position ? "you" : DEFAULT_LABEL
    const centerKey = place
        ? `place:${place.lat},${place.lon}`
        : position ? "gps" : "default"

    //hide the map rings when youre zoomed out far enough that they'd be a mess.
    //derived rather than cleared in an effect, so theres no extra render
    //also drop anything more than ~2.5km from the middle of the map. without this,
    //panning somewhere with no service still pins the 7 nearest stops on the far
    //side of town, which looks broken
    const visibleMapStops = mapView && mapView.zoom >= 13
        ? mapStops.filter((s) => s.meters <= 2500)
        : []

    //pulled out as plain numbers so the effect below has simple, checkable deps
    const centerLat = center ? center[0] : null
    const centerLon = center ? center[1] : null

    //deliberately NOT called on load. a permission prompt the second the page
    //opens is hostile to anyone just taking a look, and a fix from the mainland
    //is useless here anyway. you tap the button when you actually want it
    const askForLocation = () => {
        if (!navigator.geolocation) {
            setGeoError("This browser can't do location.")
            return
        }

        setGeoBusy(true)

        navigator.geolocation.getCurrentPosition(
            (pos) => {//success, browser hands us a position object
                const fix = [pos.coords.latitude, pos.coords.longitude]
                setGeoBusy(false)

                if (!onOahu(fix)) {//youre somewhere this app cant help with
                    setGeoError("You're not on Oahu, so we've stayed in Waikīkī. Search any Oahu street to look around.")
                    return
                }

                setGeoError('')
                setPosition(fix)
            },
            (err) => {//user hit block, or it timed out
                setGeoBusy(false)
                setGeoError(
                    err.code === err.PERMISSION_DENIED
                        ? "Location blocked. Search a stop or street instead."
                        : "Couldn't get your location."
                )
            }
        )
    }

    //stops near wherever the map is pointed. refreshed as you pan, so you can
    //drag around town and see whats there without searching. capped low on
    //purpose: every stop on oahu at once is unreadable
    useEffect(() => {
        if (!mapView || mapView.zoom < 13) return//zoomed way out, dont bother

        const timer = setTimeout(() => {
            fetch(`${API}/stops/near?lat=${mapView.lat}&lon=${mapView.lon}&limit=7`)
                .then((r) => r.json())
                .then((d) => setMapStops(d.stops || []))
                .catch(() => { })
        }, 300)//wait until you stop dragging

        return () => clearTimeout(timer)
    }, [mapView])

    //stops around the current centre, whether thats your gps fix or a searched
    //street. these show as chips up top
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

    //show the next few by default. if you tapped a bus on the map thats further
    //down the list, stretch the cut-off far enough to include it, otherwise its
    //card would be hidden and the highlight would look broken
    const selectedIndex = arrivals.findIndex((a) => a.id === selectedId)
    const baseLimit = showAll ? arrivals.length : SHOW_AT_FIRST
    const limit = selectedIndex >= baseLimit ? selectedIndex + 1 : baseLimit
    const visibleArrivals = arrivals.slice(0, limit)
    const hiddenCount = arrivals.length - visibleArrivals.length

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
        setShowAll(false)//a new stop starts collapsed again
        setArrivals([])
        setStop(next)
        setReloadKey((n) => n + 1)//makes picking the same stop twice actually refetch
    }

    return (
        <div className="app">
            {/* app title. sticky, so the search stays reachable while you scroll */}
            <header className={"topbar" + (stuck ? " is-stuck" : "")}>
                <div className="topbar-inner">
                    <span className="brand-mark">🚌</span>
                    <div className="brand-text">
                        <h1>Buss Up</h1>
                        {/*spelled out so nobody expects it to work on another island*/}
                        <p className="subtitle">Oahu, Hawaii only</p>
                    </div>
                    {activeStop && !error && (
                        <span className="live-pill"><i className="live-dot" />Live</span>
                    )}

                    <button
                        className="theme-btn"
                        //functional update, so two fast taps cant both read the
                        //same stale value and land on the same theme
                        onClick={() => setTheme((t) => THEMES[(THEMES.indexOf(t) + 1) % THEMES.length])}
                        title={`Theme: ${theme}`}
                        aria-label={`Theme: ${theme}. Tap to change.`}
                    >
                        {THEME_ICON[theme]}
                    </button>
                </div>
            </header>

            <StopPicker
                nearby={nearby}
                centerLabel={centerLabel}
                activeStop={activeStop}
                onPickStop={pickStop}
                //searching a new place means you've moved on. keeping the old bus
                //selected left the map trying to follow it and the new place at once
                onPickPlace={(p) => { setSelectedId(null); setPlace(p) }}
            />

            <p className="geo-note">
                {place ? (
                    <>
                        Showing stops near {place.name}.{" "}
                        <button className="link" onClick={() => setPlace(null)}>
                            {position ? "Back to my location" : `Back to ${DEFAULT_LABEL}`}
                        </button>
                    </>
                ) : position ? (
                    <>Showing stops near you.</>
                ) : (
                    <>
                        {geoError || `Starting in ${DEFAULT_LABEL}.`}{" "}
                        {/*opt-in, so nobody gets a permission box just for visiting*/}
                        <button className="link" onClick={askForLocation} disabled={geoBusy}>
                            {geoBusy ? "Locating..." : "Use my location"}
                        </button>
                    </>
                )}
            </p>

            {/*map sits under the search box. shows oahu until a stop is picked*/}
            <section className="panel">
                <MapView
                    position={position}
                    arrivals={arrivals}
                    selectedId={selectedId}
                    stop={stopInfo}
                    shape={shape}
                    mapStops={visibleMapStops}
                    center={center}
                    centerKey={centerKey}
                    onPickStop={pickStop}
                    onMapMove={setMapView}
                    onPickBus={setSelectedId}
                    dark={isDark}
                />

                {/*colour key. one scrolling row so it stays a single line even on
                   a phone, and entries only appear when theyre actually on screen*/}
                <div className="legend">
                    {position && <span className="legend-item"><i className="dot dot-you" />You</span>}
                    {activeStop && <span className="legend-item"><i className="dot dot-stop" />Your stop</span>}
                    <span className="legend-item"><i className="dot dot-ring" />Other stops</span>
                    {arrivals.length > 0 && <span className="legend-item"><i className="dot dot-bus" />Bus now</span>}
                    {selected && <span className="legend-item"><i className="dot dot-line" />Route {selected.route}</span>}
                </div>
            </section>

            {/*error*/}
            {error && <p className="alert">{error}</p>}

            {/* placeholder cards instead of a "loading..." line, so nothing jumps */}
            {loading && [0, 1, 2, 3].map((n) => (
                <div key={n} className="skeleton">
                    <div className="sk-block sk-badge" />
                    <div className="sk-body">
                        <div className="sk-block sk-line" />
                        <div className="sk-block sk-line-sm" />
                    </div>
                    <div className="sk-block sk-time" />
                </div>
            ))}

            {!activeStop && !loading && (
                <div className="empty-state">
                    <span className="empty-mark" aria-hidden="true">🗺️</span>
                    <p className="empty-title">Pick a stop to get started</p>
                    <p className="muted">
                        Covers TheBus on Oahu only. Tap a stop near you, or search
                        a street like "Bannister".
                    </p>
                </div>
            )}

            {activeStop && !loading && !error && (
                <>
                    {/*labelled so the page reads top to bottom: which stop youre
                       looking at, then whats coming to it. without the labels the
                       list just appears and you have to infer what it is*/}
                    <div className="results-head">
                        <p className="eyebrow">Your stop</p>
                        <h2>{stopInfo?.stopName || stop?.name || `Stop ${activeStop}`}</h2>
                        <p className="stop-sub">
                            Stop #{activeStop}
                            {updatedAt && ` · updated ${updatedAt.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`}
                        </p>
                    </div>

                    {arrivals.length > 0 && (
                        <div className="section-head">
                            <p className="eyebrow">Upcoming arrivals</p>
                            <span className="section-count">{arrivals.length}</span>
                        </div>
                    )}

                    {arrivals.length === 0 && (
                        <p className="muted">No buses due here right now.</p>
                    )}
                </>
            )}

            {/*loop through arrivals and show each*/}
            {visibleArrivals.map((arrival) => {
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
                        {/*left: route number badge. the number alone is how riders
                           talk about routes ("catch the 42"), but screen readers
                           need the word or it reads as a bare number*/}
                        <div className="route-badge" aria-label={`Route ${arrival.route}`}>
                            {arrival.route}
                        </div>

                        {/*middle destination name */}
                        {/*the meta line used to repeat "tap to trace its route" on
                           every single row, which was just noise. now it only speaks
                           up when theres something specific to say*/}
                        <div className="arrival-info">
                            <p className="headsign">{decodeText(arrival.headsign)}</p>
                            {selectedId === arrival.id && <p className="meta">Route shown on map</p>}
                            {!tracked && <p className="meta">No live location</p>}
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

            {/*the rest are usually an hour or more out, so theyre behind a tap*/}
            {hiddenCount > 0 && (
                <button className="more" onClick={() => setShowAll(true)}>
                    Show {hiddenCount} more {hiddenCount === 1 ? "arrival" : "arrivals"}
                </button>
            )}

            {showAll && arrivals.length > SHOW_AT_FIRST && (
                <button className="more" onClick={() => setShowAll(false)}>
                    Show fewer
                </button>
            )}
        </div>
    )
}

export default App;//makes this usable by other files
