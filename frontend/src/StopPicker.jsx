import { useState, useEffect, useRef } from "react";
import { API } from "./api.js";
import { walkTime } from "./arrivals.js";

function StopPicker({ nearby = [], centerLabel, activeStop, onPickStop, onPickPlace }) {
    const [query, setQuery] = useState("");
    const [stops, setStops] = useState([]);
    const [places, setPlaces] = useState([]);
    const [open, setOpen] = useState(false);
    const boxRef = useRef(null);

    //search as you type, but wait for a pause so we dont fire a request per keystroke.
    //two lookups run side by side: stop names from our own gtfs data, and street
    //or landmark names from openstreetmap
    useEffect(() => {
        const text = query.trim();
        if (!text) return;//empty box is handled by the `visible` vars below

        const timer = setTimeout(() => {
            fetch(`${API}/stops/search?q=${encodeURIComponent(text)}&limit=6`)
                .then((r) => r.json())
                .then((d) => setStops(d.stops || []))
                .catch(() => setStops([]));

            fetch(`${API}/geocode?q=${encodeURIComponent(text)}&limit=3`)
                .then((r) => r.json())
                .then((d) => setPlaces(d.places || []))
                .catch(() => setPlaces([]));
        }, 350);

        return () => clearTimeout(timer);//cancels the pending search if you keep typing
    }, [query]);

    //clicking anywhere else closes the dropdown
    useEffect(() => {
        const onClickAway = (e) => {
            if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false);
        };

        document.addEventListener("mousedown", onClickAway);
        return () => document.removeEventListener("mousedown", onClickAway);
    }, []);

    //derived instead of stored, so clearing the box cant leave stale hits on screen
    const typing = query.trim();
    const visibleStops = typing ? stops : [];
    const visiblePlaces = typing ? places : [];

    const chooseStop = (stop) => {
        onPickStop(stop);
        setQuery("");
        setOpen(false);
    };

    const choosePlace = (place) => {
        onPickPlace(place);
        setQuery("");
        setOpen(false);
    };

    return (
        <div className="picker" ref={boxRef}>
            <div className="search-row">
                <span className="search-icon" aria-hidden="true">⌕</span>
                <input
                    type="text"
                    placeholder="Search a stop, street or place..."
                    value={query}
                    onChange={(e) => {
                        setQuery(e.target.value);
                        setOpen(true);
                    }}
                    onFocus={() => setOpen(true)}
                />
                {query && (
                    <button className="clear" onClick={() => setQuery("")} aria-label="Clear">×</button>
                )}
            </div>

            {open && typing && (
                <div className="dropdown">
                    {visibleStops.length === 0 && visiblePlaces.length === 0 && (
                        <p className="dropdown-empty">Nothing found. Try a street name.</p>
                    )}

                    {visibleStops.length > 0 && (
                        <>
                            <p className="dropdown-head">Bus stops</p>
                            <ul>
                                {visibleStops.map((stop) => (
                                    <li key={stop.id}>
                                        <button onClick={() => chooseStop(stop)}>
                                            <span className="stop-name">{stop.name}</span>
                                            <span className="stop-num">#{stop.id}</span>
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        </>
                    )}

                    {/*streets and landmarks. picking one doesnt pick a stop, it moves
                       the "near you" list over there so you can see whats around it*/}
                    {visiblePlaces.length > 0 && (
                        <>
                            <p className="dropdown-head">Places</p>
                            <ul>
                                {visiblePlaces.map((place) => (
                                    <li key={`${place.lat},${place.lon}`}>
                                        <button onClick={() => choosePlace(place)}>
                                            <span className="stop-name">{place.name}</span>
                                            <span className="stop-num">{place.detail}</span>
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        </>
                    )}
                </div>
            )}

            {nearby.length > 0 && (
                <div className="nearby">
                    <span className="nearby-label">Near {centerLabel}</span>
                    <div className="chips">
                        {nearby.map((stop) => (
                            <button
                                key={stop.id}
                                className={"chip" + (String(stop.id) === String(activeStop) ? " chip-on" : "")}
                                onClick={() => chooseStop(stop)}
                                title={`${stop.name} · stop ${stop.id}`}
                            >
                                <span className="chip-name">{stop.name}</span>
                                <span className="chip-dist">{walkTime(stop.meters)}</span>
                            </button>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}

export default StopPicker;
