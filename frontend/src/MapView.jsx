import { MapContainer, TileLayer, CircleMarker, Marker, Polyline, Popup } from "react-leaflet";
import { useEffect, useRef } from "react";
import L from "leaflet";//the raw leaflet library, needed to build our own icons
import { minutesAway, isTracked, upcomingSegment, walkTime } from "./arrivals.js";

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

function MapView({ position, arrivals = [], selectedId, stop, shape, nearby = [], center, centerKey, onPickStop }) {
    //honolulu, used as the starting view before we know where the user is
    const fallback = [21.3069, -157.8583];

    const mapRef = useRef(null);//the leaflet map object once its built
    const markerRefs = useRef({});//id -> marker, so we can pop one open on command
    const centeredOnUser = useRef(false);//only auto-center on the user once

    //buses with no gps report as "0"/"0" (vehicle shows as ???), those would
    //land off the coast of africa so drop them
    const buses = arrivals.filter(isTracked);

    const stopPoint = stop?.stopLat && stop?.stopLon ? [stop.stopLat, stop.stopLon] : null;

    //move to whatever were centred on: your gps fix the first time it arrives,
    //or a street you searched. centerKey changes only when the place really
    //changes, so panning around doesnt get yanked back
    useEffect(() => {
        if (!center || !mapRef.current) return;
        if (centerKey === "gps" && centeredOnUser.current) return;//only auto-follow gps once

        mapRef.current.setView(center, 15);//15 = zoom level, higher is closer
        if (centerKey === "gps") centeredOnUser.current = true;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [centerKey]);

    //when a stop gets picked, frame it
    useEffect(() => {
        if (stopPoint && mapRef.current) {
            mapRef.current.setView(stopPoint, 14);
        }
        //only when the stop actually changes, not on every refresh
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [stop?.stop]);

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
    //rather than zooming to the bus alone, which pushes the stop off screen
    useEffect(() => {
        if (selLat === null || selLng === null || !mapRef.current) return;

        if (stopPoint) {
            mapRef.current.fitBounds([[selLat, selLng], stopPoint], {
                padding: [45, 45],
                maxZoom: 15,//dont zoom absurdly close when the bus is nearly here
            });
        } else {
            mapRef.current.flyTo([selLat, selLng], 14);
        }

        markerRefs.current[selectedId]?.openPopup();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedId, selLat, selLng]);

    return (
        <div className="map-wrap">
            <MapContainer
                ref={mapRef}
                center={position || fallback}
                zoom={position ? 15 : 11}
                className="map"
            >
                {/*carto positron: same openstreetmap data but a muted palette, so the
                   buses and route line stand out instead of fighting the map*/}
                <TileLayer
                    url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
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
                        <Popup>You are here</Popup>
                    </CircleMarker>
                )}

                {/*the other stops around you. small hollow rings so they read as
                   "options" next to the solid marker for the stop youve picked.
                   tapping one switches to it, same as tapping the chip up top*/}
                {nearby
                    .filter((s) => String(s.id) !== String(stop?.stop))
                    .map((s) => (
                        <CircleMarker
                            key={`near-${s.id}`}
                            center={[s.lat, s.lon]}
                            radius={5}
                            pathOptions={{ color: "#14263c", weight: 2, fillColor: "#ffffff", fillOpacity: 1 }}
                            eventHandlers={{ click: () => onPickStop?.(s) }}
                        >
                            <Popup>
                                <strong>{s.name}</strong>
                                <br />
                                Stop #{s.id} · {walkTime(s.meters)}
                                <br />
                                <span className="popup-note">Tap the ring to see arrivals</span>
                            </Popup>
                        </CircleMarker>
                    ))}

                {/*where youre actually waiting*/}
                {stopPoint && (
                    <Marker position={stopPoint} icon={stopIcon()}>
                        <Popup>
                            <strong>{stop.stopName || `Stop ${stop.stop}`}</strong>
                            <br />
                            Stop #{stop.stop}
                        </Popup>
                    </Marker>
                )}

                {/*one badge per bus that actually reported gps*/}
                {buses.map((bus) => {
                    const mins = minutesAway(bus);

                    return (
                        <Marker
                            key={bus.id}
                            position={[parseFloat(bus.latitude), parseFloat(bus.longitude)]}
                            icon={busIcon(bus.route, bus.id === selectedId)}
                            ref={(m) => {
                                if (m) markerRefs.current[bus.id] = m;
                            }}
                        >
                            <Popup>
                                <strong>Route {bus.route}</strong>
                                <br />
                                Toward {bus.headsign}
                                <br />
                                {/*this is the bit that was confusing before: the pin is where the
                                   bus is NOW, the time is when it reaches the stop you picked*/}
                                <span className="popup-note">
                                    Bus is here now · reaches {stop?.stopName || `stop ${stop?.stop}`} at {bus.stopTime}
                                    {mins !== null && mins > 0 ? ` (${mins} min)` : ""}
                                </span>
                            </Popup>
                        </Marker>
                    );
                })}
            </MapContainer>
        </div>
    );
}

export default MapView;
