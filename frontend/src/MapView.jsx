import { MapContainer, TileLayer, CircleMarker, Marker, Polyline, Popup } from "react-leaflet";
import { useEffect, useRef, useState } from "react";
import L from "leaflet";//the raw leaflet library, needed to build our own icons
import { minutesAway, isTracked, upcomingSegment, formatWait, decodeText } from "./arrivals.js";

//builds a little badge with the route number inside it.
//divIcon means the marker is just html, so we skip leaflets broken image icons
function busIcon(route, selected) {
    return L.divIcon({
        className: "",//leaflet adds its own class otherwise, which we dont want
        html: `<div class="bus-pin${selected ? " bus-pin-on" : ""}">${route}</div>`,
        iconSize: [34, 24],
        iconAnchor: [17, 12],//centers the badge on the actual coordinate
    });
}

//the stop itself, so its obvious where youre waiting vs where the buses are
function stopIcon() {
    return L.divIcon({
        className: "",
        html: '<div class="stop-pin"></div>',
        iconSize: [18, 18],
        iconAnchor: [9, 9],
    });
}

function MapView({ position, arrivals = [], selectedId, stop, shape, mapStops = [], center, centerKey, onPickStop, onMapMove, onPickBus, dark = false }) {
    //honolulu, used as the starting view before we know where the user is
    const fallback = [21.3069, -157.8583];

    //a light map inside a dark app looks like a hole punched in the page, so the
    //tiles follow whatever theme the app settled on (system or your override)
    const darkTiles = dark;

    //held in state, not a ref: a ref is still null when our effects first run, so
    //anything that only attaches once (like the moveend listener) silently missed it
    const [map, setMap] = useState(null);
    const centeredOnUser = useRef(false);//only auto-center on the user once
    const framedFor = useRef(null);//which bus weve already pointed the map at

    //buses with no gps report as "0"/"0" (vehicle shows as ???), those would
    //land off the coast of africa so drop them
    const buses = arrivals.filter(isTracked);

    const stopPoint = stop?.stopLat && stop?.stopLon ? [stop.stopLat, stop.stopLon] : null;

    //tell the app where the map is looking whenever you stop dragging, so it can
    //load the handful of stops around that spot
    useEffect(() => {
        if (!map || !onMapMove) return;

        const report = () => {
            const c = map.getCenter();
            onMapMove({ lat: c.lat, lon: c.lng, zoom: map.getZoom() });
        };

        map.on("moveend", report);
        report();//seed it, so stops appear before you touch anything

        return () => map.off("moveend", report);
    }, [map, onMapMove]);

    //move to whatever were centred on: your gps fix the first time it arrives,
    //or a street you searched. centerKey changes only when the place really
    //changes, so panning around doesnt get yanked back
    useEffect(() => {
        if (!center || !map) return;
        if (centerKey === "gps" && centeredOnUser.current) return;//only auto-follow gps once

        //an open popup drags the map back to its own marker (leaflet autoPan),
        //so it has to go before we move, or we never arrive
        map.closePopup();
        map.setView(center, 15);//15 = zoom level, higher is closer
        if (centerKey === "gps") centeredOnUser.current = true;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [map, centerKey]);

    //when a stop gets picked, frame it
    useEffect(() => {
        if (stopPoint && map) {
            map.setView(stopPoint, 14);
        }
        //only when the stop actually changes, not on every refresh
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [map, stop?.stop]);

    const selectedBus = buses.find((b) => b.id === selectedId) || null;
    //pull the coords out as plain numbers. if we depended on the bus object itself
    //the map would jump back every 30s refresh, even if youd panned somewhere else
    const selLat = selectedBus ? parseFloat(selectedBus.latitude) : null;
    const selLng = selectedBus ? parseFloat(selectedBus.longitude) : null;

    //the leg from the bus to your stop, so the line reads as a direction not just a shape
    const upcoming = shape && selectedBus && stopPoint
        ? upcomingSegment(shape, selLat, selLng, stopPoint[0], stopPoint[1])
        : null;

    //when a card in the list gets clicked, frame the whole leg (bus + your stop)
    //rather than zooming to the bus alone, which pushes the stop off screen.
    //framed ONCE per selection: the buses coordinates change every refresh, and
    //re-framing on those kept dragging the map back and fighting other moves
    useEffect(() => {
        if (!selectedId) {
            framedFor.current = null;//deselected, so allow framing again next time
            map?.closePopup();//dont leave a bubble hanging over the map
            return;
        }

        if (framedFor.current === selectedId) return;//already framed this one
        if (selLat === null || selLng === null || !map) return;

        if (stopPoint) {
            map.fitBounds([[selLat, selLng], stopPoint], {
                padding: [45, 45],
                maxZoom: 15,//dont zoom absurdly close when the bus is nearly here
            });
        } else {
            map.flyTo([selLat, selLng], 14);
        }

        framedFor.current = selectedId;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [map, selectedId, selLat, selLng]);

    return (
        <div className="map-wrap">
            <MapContainer
                ref={setMap}
                center={position || fallback}
                zoom={position ? 15 : 11}
                className="map"
            >
                {/*carto positron: same openstreetmap data but a muted palette, so the
                   buses and route line stand out instead of fighting the map*/}
                <TileLayer
                    key={darkTiles ? "dark" : "light"}//forces leaflet to swap tile sets
                    url={`https://{s}.basemaps.cartocdn.com/${darkTiles ? "dark_all" : "light_all"}/{z}/{x}/{y}{r}.png`}
                    attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'
                    subdomains="abcd"
                />

                {/*the path the selected bus drives. drawn first so pins sit on top.
                   the whole route stays faint, the part its about to drive is bold,
                   which is what actually shows you the direction its heading*/}
                {shape && (
                    <Polyline positions={shape} pathOptions={{ color: "#14263c", weight: 3, opacity: 0.2 }} />
                )}
                {upcoming && (
                    <>
                        <Polyline positions={upcoming} pathOptions={{ color: "#14263c", weight: 8, opacity: 0.15 }} />
                        <Polyline positions={upcoming} pathOptions={{ color: "#0098a6", weight: 5, opacity: 0.95 }} />
                    </>
                )}

                {/*blue dot for the user. circlemarker instead of a pin so we dont
                   have to deal with leaflets broken default icon images*/}
                {position && (
                    <CircleMarker
                        center={position}
                        radius={7}
                        pathOptions={{ color: "#ffffff", weight: 3, fillColor: "#2563eb", fillOpacity: 1 }}
                    >
                        <Popup autoPan={false}>You are here</Popup>
                    </CircleMarker>
                )}

                {/*stops around wherever the map is currently looking, refreshed as
                   you pan. small hollow rings so they read as "options" next to the
                   solid marker for the stop youve picked*/}
                {mapStops
                    .filter((s) => String(s.id) !== String(stop?.stop))
                    .map((s) => (
                        <CircleMarker
                            key={`near-${s.id}`}
                            center={[s.lat, s.lon]}
                            radius={stopPoint ? 4 : 5}
                            //hollow in both themes, so it matches the legend swatch.
                            //once youve chosen a stop these fade back: still tappable
                            //for the stop across the street, but no longer competing
                            //with your stop and the route line
                            pathOptions={{
                                color: darkTiles ? "#e9f1f6" : "#14263c",
                                weight: stopPoint ? 1.5 : 2,
                                opacity: stopPoint ? 0.4 : 1,
                                fillColor: darkTiles ? "#0a1017" : "#ffffff",
                                fillOpacity: stopPoint ? 0.35 : 1,
                            }}
                            eventHandlers={{ click: () => onPickStop?.(s) }}
                        >
                            <Popup maxWidth={200} minWidth={120} autoPan={false}>
                                <span className="pop-head">{s.name}</span>
                                <span className="pop-sub">Stop #{s.id} · tap for arrivals</span>
                            </Popup>
                        </CircleMarker>
                    ))}

                {/*where youre actually waiting*/}
                {stopPoint && (
                    <Marker position={stopPoint} icon={stopIcon()}>
                        <Popup maxWidth={200} minWidth={120} autoPan={false}>
                            <span className="pop-head">{stop.stopName || `Stop ${stop.stop}`}</span>
                            <span className="pop-sub">Your stop · #{stop.stop}</span>
                        </Popup>
                    </Marker>
                )}

                {/*one badge per bus that actually reported gps. no popup: when a bus
                   sits near your stop the bubble covered the stop and the route line,
                   so the details live in the strip below instead*/}
                {buses.map((bus) => (
                    <Marker
                        key={bus.id}
                        position={[parseFloat(bus.latitude), parseFloat(bus.longitude)]}
                        icon={busIcon(bus.route, bus.id === selectedId)}
                        eventHandlers={{ click: () => onPickBus?.(bus.id) }}
                    />
                ))}
            </MapContainer>

            {/*details for the selected bus, pinned inside the map instead of floating
               over its own marker. sits in reserved space, so it can never cover the
               stop, the route line or another bus*/}
            {selectedBus && (
                <div className="bus-strip">
                    <span className="strip-route">{selectedBus.route}</span>

                    <div className="strip-body">
                        <p className="strip-head">{decodeText(selectedBus.headsign)}</p>
                        <p className="strip-sub">Here now · arrives {selectedBus.stopTime}</p>
                    </div>

                    <span className="strip-mins">
                        {formatWait(minutesAway(selectedBus)) ?? selectedBus.stopTime}
                    </span>

                    <button className="strip-close" onClick={() => onPickBus?.(null)} aria-label="Close">×</button>
                </div>
            )}
        </div>
    );
}

export default MapView;
