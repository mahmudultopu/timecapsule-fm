'use client';

import { LOCATION_PRECISIONS, snapToPrecision, type LocationPrecision } from '@timecapsule/shared';
import type { GeoJSONSource, Map as MlMap } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useTranslations } from 'next-intl';
import { useEffect, useLayoutEffect, useRef } from 'react';
import { CheckboxField, NumberField } from './fields';

const RADIUS_M: Record<LocationPrecision, number> = { site_100m: 100, neighborhood_1km: 1000, city_10km: 10000 };

/** Rough circle polygon (good enough to show "about this area"). */
function circle(lat: number, lon: number, meters: number) {
  const points: [number, number][] = [];
  for (let i = 0; i <= 64; i++) {
    const a = (i / 64) * 2 * Math.PI;
    const dLat = (meters / 111_320) * Math.cos(a);
    const dLon = (meters / (111_320 * Math.cos((lat * Math.PI) / 180))) * Math.sin(a);
    points.push([lon + dLon, lat + dLat]);
  }
  return { type: 'Feature' as const, properties: {}, geometry: { type: 'Polygon' as const, coordinates: [points] } };
}

/**
 * Click the map (or type coordinates) to place the recording. The preview
 * shows the area that will actually be published: the point is snapped to
 * the chosen precision on the server and the exact click is never stored.
 */
export function LocationPicker({
  styleUrl,
  workerUrl,
  location,
  precision,
  publicPlace,
  disabled,
  onChange,
}: {
  styleUrl: string;
  workerUrl: string;
  location: { lat: number; lon: number } | null;
  precision: LocationPrecision | null;
  publicPlace: boolean;
  disabled: boolean;
  onChange: (patch: { location?: { lat: number; lon: number } | null; locationPrecision?: LocationPrecision; publicPlaceAttested?: boolean }) => void;
}) {
  const t = useTranslations('editor.location');
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const onChangeRef = useRef(onChange);
  const disabledRef = useRef(disabled);
  // Redraws the published-area overlay; set by the effect below, called once the map loads.
  const drawRef = useRef<() => void>(() => {});
  useLayoutEffect(() => {
    onChangeRef.current = onChange;
    disabledRef.current = disabled;
  }, [onChange, disabled]);

  const effective = precision ?? 'neighborhood_1km';
  const snapped = location ? snapToPrecision(location.lat, location.lon, effective) : null;

  useEffect(() => {
    let disposed = false;
    void (async () => {
      const maplibregl = await import('maplibre-gl');
      if (disposed || !container.current) return;
      maplibregl.setWorkerUrl(workerUrl);
      let map: MlMap;
      try {
        map = new maplibregl.Map({
          container: container.current,
          style: styleUrl,
          center: location ? [location.lon, location.lat] : [10, 30],
          zoom: location ? 11 : 1.3,
          attributionControl: { compact: true },
        });
      } catch {
        return; // No WebGL: the coordinate fields still work.
      }
      mapRef.current = map;
      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
      map.on('load', () => {
        map.addSource('area', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
        map.addLayer({ id: 'area-fill', type: 'fill', source: 'area', paint: { 'fill-color': '#a4471f', 'fill-opacity': 0.18 } });
        map.addLayer({ id: 'area-line', type: 'line', source: 'area', paint: { 'line-color': '#a4471f', 'line-width': 2 } });
        drawRef.current();
      });
      map.on('click', (e) => {
        if (disabledRef.current) return;
        onChangeRef.current({ location: { lat: Number(e.lngLat.lat.toFixed(6)), lon: Number(e.lngLat.lng.toFixed(6)) } });
      });
      map.getCanvas().style.cursor = 'crosshair';
    })();
    return () => {
      disposed = true;
      mapRef.current?.remove();
      mapRef.current = null;
    };
    // Created once; position updates flow through the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [styleUrl, workerUrl]);

  // Draw the published area whenever the point or precision changes.
  useEffect(() => {
    const map = mapRef.current;
    const draw = () => {
      const src = map?.getSource('area') as GeoJSONSource | undefined;
      if (!src) return;
      src.setData({
        type: 'FeatureCollection',
        features: snapped ? [circle(snapped.lat, snapped.lon, RADIUS_M[effective])] : [],
      });
    };
    drawRef.current = draw;
    draw();
  }, [snapped?.lat, snapped?.lon, effective]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="space-y-4">
      <div className="relative h-72 overflow-hidden rounded-2xl border border-line">
        <div className="absolute inset-0">
          <div ref={container} className="h-full w-full" role="application" aria-label={t('mapLabel')} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <NumberField
          label={t('lat')}
          value={location?.lat ?? null}
          min={-90}
          max={90}
          step={0.0001}
          disabled={disabled}
          onChange={(lat) => onChange({ location: lat === null ? null : { lat, lon: location?.lon ?? 0 } })}
        />
        <NumberField
          label={t('lon')}
          value={location?.lon ?? null}
          min={-180}
          max={180}
          step={0.0001}
          disabled={disabled}
          onChange={(lon) => onChange({ location: lon === null ? null : { lat: location?.lat ?? 0, lon } })}
        />
      </div>

      <fieldset>
        <legend className="label">{t('precision')}</legend>
        <div className="grid gap-2 sm:grid-cols-3">
          {LOCATION_PRECISIONS.map((p) => (
            <label
              key={p}
              className="flex cursor-pointer flex-col rounded-xl border border-line bg-white/60 p-3 text-sm transition-colors has-[:checked]:border-accent has-[:checked]:bg-accent-soft has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-focus"
            >
              <span className="flex items-center gap-2 font-semibold">
                <input
                  type="radio"
                  name="precision"
                  value={p}
                  checked={effective === p}
                  disabled={disabled}
                  onChange={() => onChange({ locationPrecision: p })}
                  className="accent-accent"
                />
                {t(`options.${p}.label`)}
              </span>
              <span className="mt-1 text-muted">{t(`options.${p}.help`)}</span>
            </label>
          ))}
        </div>
      </fieldset>

      {effective === 'site_100m' && (
        <CheckboxField
          label={t('publicPlace')}
          help={t('publicPlaceHelp')}
          checked={publicPlace}
          disabled={disabled}
          onChange={(v) => onChange({ publicPlaceAttested: v })}
        />
      )}
      <p className="text-xs text-muted">{snapped ? t('preview', { lat: snapped.lat, lon: snapped.lon }) : t('noPoint')}</p>
    </div>
  );
}
