import { useState, useEffect, useRef } from "react";
import { API } from "./api.js";

//walking distance reads better than raw meters
function walkTime(meters) {
    const mins = Math.round(meters / 80);//~80 m/min is a normal walking pace
    if (mins <= 1) return "1 min walk";
    return `${mins} min walk`;
}

function StopPicker({ position, activeStop, onPick }) {
    const [query, setQuery] = useState("");
    const [results, setResults] = useState([]);
    const [nearby, setNearby] = useState([]);
    const [open, setOpen] = useState(false);
    const boxRef = useRef(null);

    //as soon as we know where the user is, ask the backend whats close by.
    //this is the bit that means you dont have to know any stop numbers
    useEffect(() => {
        if (!position) return;

        fetch(`${API}/stops/near?lat=${position[0]}&lon=${position[1]}&limit=6`)
            .then((r) => r.json())
            .then((d) => setNearby(d.stops || []))
            .catch(() => setNearby([]));
    }, [position]);

    //search as you type, but wait for a pause so we dont fire a request per keystroke
    useEffect(() => {
        const text = query.trim();
        if (!text) return;//empty box is handled by `visible` below, no state to clear

        const timer = setTimeout(() => {
            fetch(`${API}/stops/search?q=${encodeURIComponent(text)}&limit=8`)
                .then((r) => r.json())
                .then((d) => setResults(d.stops || []))
                .catch(() => setResults([]));
        }, 250);

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
    const visible = query.trim() ? results : [];

    const choose = (stop) => {
        onPick(stop);
        setQuery("");
        setOpen(false);
    };

    return (
        <div className="picker" ref={boxRef}>
            <div className="search-row">
                <span className="search-icon" aria-hidden="true">⌕</span>
                <input
                    type="text"
                    placeholder="Search a stop name or number..."
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

            {open && query.trim() && (
                <ul className="dropdown">
                    {visible.length === 0 && <li className="dropdown-empty">No stops match that</li>}
                    {visible.map((stop) => (
                        <li key={stop.id}>
                            <button onClick={() => choose(stop)}>
                                <span className="stop-name">{stop.name}</span>
                                <span className="stop-num">#{stop.id}</span>
                            </button>
                        </li>
                    ))}
                </ul>
            )}

            {/*quick pick row, only useful once the browser has told us where we are*/}
            {nearby.length > 0 && (
                <div className="nearby">
                    <span className="nearby-label">Near you</span>
                    <div className="chips">
                        {nearby.map((stop) => (
                            <button
                                key={stop.id}
                                className={"chip" + (String(stop.id) === String(activeStop) ? " chip-on" : "")}
                                onClick={() => choose(stop)}
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
