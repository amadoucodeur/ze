"use client";

import { useEffect, useRef } from "react";
import type {
  Circle,
  Map as LeafletMap,
  Marker,
  Tooltip,
} from "leaflet";

type LeafletModule = typeof import("leaflet");

type MapValues = {
  latitude: number;
  longitude: number;
  radius: number;
};

export function LocationRadiusMap({
  latitude,
  longitude,
  radius,
}: MapValues) {
  const elementRef = useRef<HTMLDivElement>(null);
  const leafletRef = useRef<LeafletModule | null>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const markerRef = useRef<Marker | null>(null);
  const circleRef = useRef<Circle | null>(null);
  const tooltipRef = useRef<Tooltip | null>(null);
  const valuesRef = useRef<MapValues>({ latitude, longitude, radius });
  const previousCenterRef = useRef<[number, number] | null>(null);

  function applyValues(values: MapValues, initial = false) {
    const leaflet = leafletRef.current;
    const map = mapRef.current;
    const marker = markerRef.current;
    const circle = circleRef.current;
    const tooltip = tooltipRef.current;
    if (!leaflet || !map || !marker || !circle) return;

    const center = leaflet.latLng(values.latitude, values.longitude);
    const previousCenter = previousCenterRef.current;
    const centerChanged =
      !previousCenter ||
      previousCenter[0] !== values.latitude ||
      previousCenter[1] !== values.longitude;

    marker.setLatLng(center);
    circle.setLatLng(center);
    circle.setRadius(values.radius);
    const zoneBounds = center.toBounds(values.radius * 2);
    tooltip?.setContent(
      `${new Intl.NumberFormat("fr-FR").format(Math.round(values.radius))} m`,
    );

    if (initial) {
      map.fitBounds(zoneBounds, {
        padding: [52, 52],
        maxZoom: 19,
        animate: false,
      });
      // Keep visual breathing room so ordinary radius adjustments visibly
      // grow or shrink the circle without immediately changing the zoom.
      map.setZoom(Math.max(map.getMinZoom(), map.getZoom() - 1), {
        animate: false,
      });
    } else if (centerChanged) {
      map.setView(center, map.getZoom(), { animate: false });
    }

    // Keep the current zoom while the radius changes so the circle visibly
    // grows or shrinks. Zoom out only when the enlarged zone no longer fits.
    if (
      !initial &&
      !map.getBounds().pad(-0.12).contains(zoneBounds)
    ) {
      map.fitBounds(zoneBounds, {
        padding: [52, 52],
        maxZoom: map.getZoom(),
        animate: false,
      });
    }

    previousCenterRef.current = [values.latitude, values.longitude];
  }

  useEffect(() => {
    let active = true;
    let resizeObserver: ResizeObserver | null = null;

    async function initialize() {
      const element = elementRef.current;
      if (!element || mapRef.current) return;

      const leaflet = await import("leaflet");
      if (!active || !elementRef.current) return;

      leafletRef.current = leaflet;
      const values = valuesRef.current;
      const center = leaflet.latLng(values.latitude, values.longitude);
      const map = leaflet.map(element, {
        zoomControl: true,
        attributionControl: true,
        scrollWheelZoom: false,
      });
      leaflet
        .tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
          attribution: "&copy; OpenStreetMap",
          maxZoom: 19,
        })
        .addTo(map);

      const marker = leaflet
        .marker(center, {
          interactive: false,
          icon: leaflet.divIcon({
            className: "location-leaflet-center-marker",
            html: "<span></span>",
            iconSize: [24, 24],
            iconAnchor: [12, 12],
          }),
        })
        .addTo(map);
      const circle = leaflet
        .circle(center, {
          radius: values.radius,
          color: "#087f78",
          weight: 2,
          opacity: 1,
          fillColor: "#20bfb2",
          fillOpacity: 0.2,
          interactive: false,
        })
        .addTo(map);
      const tooltip = circle
        .bindTooltip("", {
          permanent: true,
          direction: "top",
          className: "location-leaflet-radius-label",
          opacity: 1,
          offset: [0, -8],
        })
        .openTooltip()
        .getTooltip();

      mapRef.current = map;
      markerRef.current = marker;
      circleRef.current = circle;
      tooltipRef.current = tooltip ?? null;
      applyValues(values, true);

      resizeObserver = new ResizeObserver(() => {
        map.invalidateSize({ animate: false });
      });
      resizeObserver.observe(elementRef.current);
    }

    void initialize();
    return () => {
      active = false;
      resizeObserver?.disconnect();
      mapRef.current?.remove();
      mapRef.current = null;
      markerRef.current = null;
      circleRef.current = null;
      tooltipRef.current = null;
      leafletRef.current = null;
      previousCenterRef.current = null;
    };
  }, []);

  useEffect(() => {
    const values = { latitude, longitude, radius };
    valuesRef.current = values;
    applyValues(values);
  }, [latitude, longitude, radius]);

  return (
    <div
      ref={elementRef}
      className="location-leaflet-map"
      role="img"
      aria-label={`Carte de la zone de pointage, rayon autorisé ${Math.round(radius)} mètres`}
    />
  );
}
