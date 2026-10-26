'use client';

import type { BBox, PinCollection, PinFeature } from '@timecapsule/shared';
import type { GeoJSONSource, Map as MlMap, MapLayerMouseEvent } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useTranslations } from 'next-intl';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { getPins } from '@/lib/api';
import type { Filters } from '@/lib/filters';
import { CATEGORY_COLORS } from '@/lib/format';
import { prefersReducedMotion } from '@/lib/use-reduced-motion';

const SOURCE = 'recordings';
const EMPTY: PinCollection = { type: 'FeatureCollection', features: [], truncated: false };

export interface PinsState {
  pins: PinFeature[];
  truncated: boolean;
  failed: boolean;
}

interface Props {
  styleUrl: string;
  workerUrl: string;
  filters: Filters;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onPins: (state: PinsState) => void;
}

/** Normalises the visible bounds (which can wrap past ±180°) for the API. */
export function viewportBBox(west: number, south: number, east: number, north: number): BBox {
  const wrap = (x: number) => ((((x + 180) % 360) + 360) % 360) - 180;
  const s = Math.max(-90, south);
  const n = Math.min(90, north);
  if (east - west >= 360) return { west: -180, south: s, east: 180, north: n };
  return { west: wrap(west), south: s, east: wrap(east), north: n };
}

/**
 * The map canvas. Pins are fetched for the current viewport (debounced) and
 * clustered client-side; the parent renders the accessible list of what's in
 * view, since individual pins on a canvas can't take keyboard focus.
 */
export function MapExplorer({ styleUrl, workerUrl, filters, selectedId, onSelect, onPins }: Props) {
  const t = useTranslations('map');
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const filtersRef = useRef(filters);
  const onSelectRef = useRef(onSelect);
  const onPinsRef = useRef(onPins);
  const pinsRef = useRef<PinFeature[]>([]);
  const refreshRef = useRef<() => void>(() => {});
  const [failed, setFailed] = useState(false);

  useLayoutEffect(() => {
    onSelectRef.current = onSelect;
    onPinsRef.current = onPins;
  }, [onSelect, onPins]);

  useEffect(() => {
    let disposed = false;
    let abort: AbortController | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;

    void (async () => {
      const maplibregl = await import('maplibre-gl');
      if (disposed || !container.current) return;
      maplibregl.setWorkerUrl(workerUrl);
      const reduced = prefersReducedMotion();

      let map: MlMap;
      try {
        map = new maplibregl.Map({
          container: container.current,
          style: styleUrl,
          // Fit the inhabited world, whatever the container size.
          bounds: [
            [-170, -50],
            [175, 70],
          ],
          attributionControl: false,
          fadeDuration: reduced ? 0 : 300,
        });
      } catch {
        setFailed(true); // e.g. WebGL unavailable
        return;
      }
      mapRef.current = map;
      // Bottom corners stay clear of the floating panels; attribution must stay visible.
      map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-left');
      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');
      map.getCanvas().setAttribute('aria-label', t('label'));

      const refresh = () => {
        clearTimeout(timer);
        timer = setTimeout(async () => {
          abort?.abort();
          abort = new AbortController();
          const b = map.getBounds();
          try {
            const res = await getPins(
              viewportBBox(b.getWest(), b.getSouth(), b.getEast(), b.getNorth()),
              filtersRef.current,
              abort.signal,
            );
            const data = res ?? EMPTY;
            (map.getSource(SOURCE) as GeoJSONSource | undefined)?.setData(data);
            pinsRef.current = data.features;
            onPinsRef.current({ pins: data.features, truncated: data.truncated, failed: false });
          } catch (err) {
            if ((err as Error).name !== 'AbortError') {
              onPinsRef.current({ pins: pinsRef.current, truncated: false, failed: true });
            }
          }
        }, 250);
      };
      refreshRef.current = refresh;

      map.on('load', () => {
        map.addSource(SOURCE, { type: 'geojson', data: EMPTY, cluster: true, clusterRadius: 48, clusterMaxZoom: 12 });
        // Soft halo behind clusters, then the cluster disc itself.
        map.addLayer({
          id: 'cluster-halo',
          type: 'circle',
          source: SOURCE,
          filter: ['has', 'point_count'],
          paint: {
            'circle-color': '#a4471f',
            'circle-opacity': 0.18,
            'circle-radius': ['step', ['get', 'point_count'], 24, 10, 30, 50, 38],
          },
        });
        map.addLayer({
          id: 'clusters',
          type: 'circle',
          source: SOURCE,
          filter: ['has', 'point_count'],
          paint: {
            'circle-color': '#121a2c',
            'circle-radius': ['step', ['get', 'point_count'], 15, 10, 19, 50, 25],
            'circle-stroke-color': '#ffffff',
            'circle-stroke-width': 2,
          },
        });
        if (map.getStyle().glyphs) {
          map.addLayer({
            id: 'cluster-count',
            type: 'symbol',
            source: SOURCE,
            filter: ['has', 'point_count'],
            layout: { 'text-field': ['get', 'point_count_abbreviated'], 'text-size': 12 },
            paint: { 'text-color': '#ffffff' },
          });
        }
        map.addLayer({
          id: 'selected-ring',
          type: 'circle',
          source: SOURCE,
          filter: ['==', ['get', 'id'], ''],
          paint: {
            'circle-radius': 16,
            'circle-color': 'rgba(232, 148, 106, 0.25)',
            'circle-stroke-color': '#a4471f',
            'circle-stroke-width': 2.5,
          },
        });
        map.addLayer({
          id: 'points',
          type: 'circle',
          source: SOURCE,
          filter: ['!', ['has', 'point_count']],
          paint: {
            'circle-color': ['match', ['get', 'category'], ...Object.entries(CATEGORY_COLORS).flat(), '#121a2c'] as never,
            'circle-radius': 8,
            'circle-stroke-color': '#ffffff',
            'circle-stroke-width': 2.5,
          },
        });
        refresh();
      });

      map.on('moveend', refresh);
      map.on('click', 'points', (e: MapLayerMouseEvent) => {
        const id = e.features?.[0]?.properties?.id;
        if (typeof id === 'string') onSelectRef.current(id);
      });
      map.on('click', 'clusters', async (e: MapLayerMouseEvent) => {
        const feature = e.features?.[0];
        const clusterId = feature?.properties?.cluster_id;
        if (!feature || typeof clusterId !== 'number') return;
        const zoom = await (map.getSource(SOURCE) as GeoJSONSource).getClusterExpansionZoom(clusterId);
        const center = (feature.geometry as { coordinates: [number, number] }).coordinates;
        // easeTo is skipped automatically under prefers-reduced-motion (non-essential animation).
        map.easeTo({ center, zoom, duration: 600 });
      });
      for (const layer of ['points', 'clusters']) {
        map.on('mouseenter', layer, () => (map.getCanvas().style.cursor = 'pointer'));
        map.on('mouseleave', layer, () => (map.getCanvas().style.cursor = ''));
      }
    })();

    return () => {
      disposed = true;
      clearTimeout(timer);
      abort?.abort();
      mapRef.current?.remove();
      mapRef.current = null;
    };
    // The map is created once; filters/selection flow in through refs and the effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [styleUrl, workerUrl]);

  // Re-query when filters change, without recreating the map.
  const filterKey = JSON.stringify(filters);
  useEffect(() => {
    filtersRef.current = filters;
    refreshRef.current();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterKey]);

  // Ring the selected pin and bring it into view if it's off-screen.
  useEffect(() => {
    const map = mapRef.current;
    if (!map?.getLayer('selected-ring')) return;
    map.setFilter('selected-ring', ['==', ['get', 'id'], selectedId ?? '']);
    const pin = pinsRef.current.find((p) => p.id === selectedId);
    if (pin && !map.getBounds().contains(pin.geometry.coordinates)) {
      map.easeTo({ center: pin.geometry.coordinates, duration: 600 });
    }
  }, [selectedId]);

  return (
    <div className="relative h-full w-full bg-[#e8e4dc]">
      {/* MapLibre's CSS forces position:relative on the map element (and unlayered CSS
          beats Tailwind's layered utilities), so positioning lives on a wrapper. */}
      <div className="absolute inset-0">
        <div ref={container} className="h-full w-full" role="region" aria-label={t('label')} />
      </div>
      {failed && (
        <p role="alert" className="absolute inset-0 grid place-items-center bg-paper p-6 text-center">
          {t('noMap')}
        </p>
      )}
    </div>
  );
}
