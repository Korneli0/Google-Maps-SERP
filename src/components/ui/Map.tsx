'use client';

import { useEffect, useState } from 'react';
import {
    MapContainer,
    TileLayer,
    CircleMarker,
    Popup,
    useMap,
    ZoomControl,
    useMapEvents,
    Circle,
    Marker
} from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';

// Fix for default marker icon
// @ts-ignore
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
    iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
    iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
    shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
});

interface Point {
    lat: number;
    lng: number;
    rank: number | null;
    hasData?: boolean;
    id?: string;
    draggable?: boolean;
}

interface MapProps {
    center: [number, number];
    zoom: number;
    points?: Point[];
    onCenterChange?: (lat: number, lng: number) => void;
    selectionMode?: boolean;
    radius?: number; // In KM
    gridSize?: number;
    onPointClick?: (point: Point) => void;
    onPointMove?: (pointId: string, lat: number, lng: number) => void;
}

function MapUpdater({ center, zoom }: { center: [number, number]; zoom: number }) {
    const map = useMap();
    useEffect(() => {
        map.setView(center, zoom);
    }, [center, zoom, map]);
    return null;
}

function SelectionHandler({ onCenterChange }: { onCenterChange?: (lat: number, lng: number) => void }) {
    useMapEvents({
        click(e) {
            onCenterChange?.(e.latlng.lat, e.latlng.lng);
        },
    });
    return null;
}

const RankMarker = ({
    point,
    onClick,
    onMove
}: {
    point: Point;
    onClick?: (point: Point) => void;
    onMove?: (pointId: string, lat: number, lng: number) => void;
}) => {
    let color = '#9ca3af'; // gray-400 (not found)
    let fillColor = '#d1d5db'; // gray-300
    let radius = 14;

    if (point.rank !== null) {
        if (point.rank <= 3) {
            color = '#15803d'; // green-700
            fillColor = '#22c55e'; // green-500
            radius = 18;
        } else if (point.rank <= 10) {
            color = '#b45309'; // amber-700
            fillColor = '#f59e0b'; // amber-500
            radius = 16;
        } else {
            color = '#b91c1c'; // red-700
            fillColor = '#ef4444'; // red-500
        }
    } else if (point.hasData) {
        color = '#2563eb'; // blue-600
        fillColor = '#60a5fa'; // blue-400
        radius = 16;
    }

    if (point.draggable && onMove && point.id) {
        return (
            <Marker
                position={[point.lat, point.lng]}
                draggable={true}
                eventHandlers={{
                    dragend: (e) => {
                        const marker = e.target;
                        const position = marker.getLatLng();
                        onMove(point.id!, position.lat, position.lng);
                    },
                }}
            />
        );
    }

    return (
        <CircleMarker
            center={[point.lat, point.lng]}
            radius={radius}
            eventHandlers={{
                click: () => onClick?.(point),
            }}
            pathOptions={{
                color: color,
                weight: 2,
                fillColor: fillColor,
                fillOpacity: 1,
            }}
        >
            {!onClick && (
                <Popup className="font-sans">
                    <div className="text-center p-1">
                        <div className="font-bold text-lg mb-1 text-gray-900">
                            #{point.rank ?? '-'}
                        </div>
                        <div className="text-xs text-gray-500">
                            Lat: {point.lat.toFixed(4)}<br />
                            Lng: {point.lng.toFixed(4)}
                        </div>
                    </div>
                </Popup>
            )}
        </CircleMarker>
    );
};

export default function LeafletMap({
    center,
    zoom,
    points = [],
    onCenterChange,
    selectionMode = false,
    radius = 5,
    gridSize = 3,
    onPointClick
}: MapProps) {
    return (
        <div className="h-full w-full relative z-0 bg-gray-100">
            <MapContainer
                center={center}
                zoom={zoom}
                style={{ height: '100%', width: '100%', filter: 'contrast(1.05) saturate(1.1)' }}
                scrollWheelZoom={true}
                zoomControl={false}
            >
                <ZoomControl position="bottomright" />

                <TileLayer
                    attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
                    url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
                />
                <MapUpdater center={center} zoom={zoom} />

                {selectionMode && <SelectionHandler onCenterChange={onCenterChange} />}

                {/* Selection Mode Visuals: Circle and Grid Preview */}
                {selectionMode && (
                    <>
                        <Circle
                            center={center}
                            radius={radius * 1000}
                            pathOptions={{ color: '#2563eb', fillColor: '#2563eb', fillOpacity: 0.1, weight: 1, dashArray: '5, 5' }}
                        />
                        <CircleMarker
                            center={center}
                            radius={6}
                            pathOptions={{ color: '#1d4ed8', fillColor: '#1d4ed8', fillOpacity: 1 }}
                        />
                    </>
                )}

                {/* Ranking Points */}
                {points.map((point, i) => (
                    <RankMarker key={point.id || i} point={point} onClick={onPointClick} />
                ))}
            </MapContainer>

            {/* Floating Legend - Only in results mode */}
            {!selectionMode && points.length > 0 && (
                <div className="absolute top-4 right-4 bg-white/95 backdrop-blur border border-gray-200 p-3 rounded-lg shadow-lg z-[1000] text-xs font-medium space-y-2">
                    <div className="font-bold text-gray-900 mb-1 border-b border-gray-100 pb-1">Rank Legend</div>
                    <div className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-full bg-green-500 border border-green-700"></div>
                        <span className="text-gray-700">1 - 3</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-full bg-amber-500 border border-amber-700"></div>
                        <span className="text-gray-700">4 - 10</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-full bg-red-500 border border-red-700"></div>
                        <span className="text-gray-700">11+</span>
                    </div>
                </div>
            )}

            {selectionMode && (
                <div className="absolute top-4 left-4 bg-white/95 backdrop-blur border border-gray-200 p-3 rounded-lg shadow-lg z-[1000] text-xs font-medium">
                    <p className="text-blue-600 font-bold">Interactive Mode</p>
                    <p className="text-gray-500 mt-1">Click map to set center location.</p>
                </div>
            )}
        </div>
    );
}
