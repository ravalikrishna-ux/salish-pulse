import React, { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { palette, radii, spacing } from '../theme';
import { HydrophoneNode, Sighting, SpotWithEta } from '../types';
import { loadMapMode, saveMapMode } from '../services/storage';
import { directionToDegrees } from '../utils/geo';
import { PugetSoundMap } from './PugetSoundMap';
import type { InteractiveMapProps } from './InteractiveMap';

const OPENFREEMAP_STYLE = 'https://tiles.openfreemap.org/styles/liberty';
const SRKW_BUFFER_METERS = 914.4; // WA State 2025+ mandatory 1,000-yard buffer

function createGeodesicCircle(lat: number, lng: number, radiusMeters: number, steps = 40) {
  const coords: Array<[number, number]> = [];
  const earthRadius = 6371000;
  const latRad = (lat * Math.PI) / 180;
  const lngRad = (lng * Math.PI) / 180;
  const angularDist = radiusMeters / earthRadius;

  for (let i = 0; i <= steps; i++) {
    const bearing = (2 * Math.PI * i) / steps;
    const sinLat2 =
      Math.sin(latRad) * Math.cos(angularDist) +
      Math.cos(latRad) * Math.sin(angularDist) * Math.cos(bearing);
    const lat2 = Math.asin(sinLat2);
    const lng2 =
      lngRad +
      Math.atan2(
        Math.sin(bearing) * Math.sin(angularDist) * Math.cos(latRad),
        Math.cos(angularDist) - Math.sin(latRad) * sinLat2
      );
    coords.push([(lng2 * 180) / Math.PI, (lat2 * 180) / Math.PI]);
  }
  return coords;
}

function projectArrowEndpoint(lat: number, lng: number, deg: number, distanceKm = 2.6): [number, number] {
  const rad = (deg * Math.PI) / 180;
  const dLat = (distanceKm / 111.32) * Math.cos(rad);
  const dLng = (distanceKm / (111.32 * Math.cos((lat * Math.PI) / 180))) * Math.sin(rad);
  return [lng + dLng, lat + dLat];
}

export const InteractiveMap: React.FC<InteractiveMapProps> = (props) => {
  const {
    sightings,
    spots,
    hydrophones,
    selectedSightingId,
    selectedSpotId,
    onSelectSighting,
    onSelectSpot,
    height = 520,
  } = props;

  const [mode, setMode] = useState<'maplibre' | 'chart'>('maplibre');
  const [webglFailed, setWebglFailed] = useState(false);
  const [showSrkwBuffer, setShowSrkwBuffer] = useState(true);
  const [showBeaches, setShowBeaches] = useState(true);
  const [showHydrophones, setShowHydrophones] = useState(true);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<maplibregl.Marker[]>([]);
  const [mapReady, setMapReady] = useState(false);

  useEffect(() => {
    loadMapMode().then((saved) => {
      if (saved) setMode(saved);
    });
  }, []);

  const switchMode = (next: 'maplibre' | 'chart') => {
    setMode(next);
    saveMapMode(next);
  };

  // Initialize MapLibre GL map instance when in maplibre mode
  useEffect(() => {
    if (mode !== 'maplibre' || webglFailed || !containerRef.current) return;

    let map: maplibregl.Map;
    try {
      map = new maplibregl.Map({
        container: containerRef.current,
        style: OPENFREEMAP_STYLE,
        center: [-122.42, 47.60], // Central Puget Sound / Seattle Waterfront
        zoom: 10.1,
        attributionControl: { compact: true },
      });
      map.addControl(new maplibregl.NavigationControl({ showCompass: true }), 'top-right');
      mapRef.current = map;

      map.on('load', () => {
        setMapReady(true);
      });

      map.on('error', () => {
        // If offline and base style cannot load at all on initial load, degrade cleanly to SVG chart
        if (!map.loaded()) {
          setWebglFailed(true);
        }
      });
    } catch {
      setWebglFailed(true);
      return;
    }

    return () => {
      markersRef.current.forEach((m) => m.remove());
      markersRef.current = [];
      setMapReady(false);
      map.remove();
      mapRef.current = null;
    };
  }, [mode, webglFailed]);

  // Update GeoJSON layers (1,000-yd SRKW buffer polygons + directional vectors) & interactive DOM markers
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || mode !== 'maplibre') return;

    // 1. Update SRKW 1,000-yard buffer polygons
    const srkwFeatures = showSrkwBuffer
      ? sightings
          .filter((s) => s.ecotype === 'SRKW')
          .map((s) => {
            const lat = s.displayLat ?? s.lat;
            const lng = s.displayLng ?? s.lng;
            return {
              type: 'Feature' as const,
              properties: { id: s.id },
              geometry: {
                type: 'Polygon' as const,
                coordinates: [createGeodesicCircle(lat, lng, SRKW_BUFFER_METERS)],
              },
            };
          })
      : [];

    const bufferData = { type: 'FeatureCollection' as const, features: srkwFeatures };
    const existingBuf = map.getSource('srkw-buffers') as maplibregl.GeoJSONSource | undefined;
    if (existingBuf) {
      existingBuf.setData(bufferData);
    } else {
      map.addSource('srkw-buffers', { type: 'geojson', data: bufferData });
      map.addLayer({
        id: 'srkw-buffers-fill',
        type: 'fill',
        source: 'srkw-buffers',
        paint: { 'fill-color': '#D1493E', 'fill-opacity': 0.14 },
      });
      map.addLayer({
        id: 'srkw-buffers-outline',
        type: 'line',
        source: 'srkw-buffers',
        paint: {
          'line-color': '#D1493E',
          'line-width': 1.8,
          'line-dasharray': [2, 2],
        },
      });
    }

    // 2. Update directional travel heading lines
    const vectorFeatures = sightings
      .map((s) => {
        const deg = directionToDegrees(s.direction);
        if (deg === null) return null;
        const lat = s.displayLat ?? s.lat;
        const lng = s.displayLng ?? s.lng;
        return {
          type: 'Feature' as const,
          properties: {
            color: s.confidence === 'acoustic' ? '#0284C7' : s.ecotype === 'SRKW' ? '#D1493E' : '#0E7C72',
          },
          geometry: {
            type: 'LineString' as const,
            coordinates: [
              [lng, lat],
              projectArrowEndpoint(lat, lng, deg, 2.4),
            ],
          },
        };
      })
      .filter((f): f is NonNullable<typeof f> => f !== null);

    const vectorData = { type: 'FeatureCollection' as const, features: vectorFeatures };
    const existingVec = map.getSource('pod-vectors') as maplibregl.GeoJSONSource | undefined;
    if (existingVec) {
      existingVec.setData(vectorData);
    } else {
      map.addSource('pod-vectors', { type: 'geojson', data: vectorData });
      map.addLayer({
        id: 'pod-vectors-line',
        type: 'line',
        source: 'pod-vectors',
        paint: {
          'line-color': ['get', 'color'],
          'line-width': 3,
          'line-opacity': 0.9,
        },
        layout: { 'line-cap': 'round' },
      });
    }

    // 3. Rebuild lightweight DOM markers
    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];

    if (showHydrophones) {
      for (const h of hydrophones) {
        const el = document.createElement('div');
        const detecting = h.status === 'detecting';
        el.style.width = '14px';
        el.style.height = '14px';
        el.style.borderRadius = '999px';
        el.style.background = detecting ? '#38BDF8' : '#0284C7';
        el.style.border = '2px solid #FFFFFF';
        el.style.boxShadow = detecting
          ? '0 0 0 6px rgba(56, 189, 248, 0.32)'
          : '0 1px 4px rgba(0,0,0,0.35)';
        el.title = `Orcasound Hydrophone: ${h.name} (${detecting ? 'CALLS DETECTED' : 'Listening'})`;
        markersRef.current.push(
          new maplibregl.Marker({ element: el }).setLngLat([h.lng, h.lat]).addTo(map)
        );
      }
    }

    if (showBeaches) {
      for (const sp of spots) {
        const wrap = document.createElement('div');
        wrap.style.display = 'flex';
        wrap.style.alignItems = 'center';
        wrap.style.gap = '4px';
        wrap.style.cursor = 'pointer';

        const dot = document.createElement('div');
        const hot = sp.likelihood === 'high';
        const sel = sp.id === selectedSpotId;
        dot.style.width = sel ? '13px' : '10px';
        dot.style.height = sel ? '13px' : '10px';
        dot.style.borderRadius = '999px';
        dot.style.background = hot ? '#0E7C72' : sp.etaMinutes !== null ? '#D97706' : '#64748B';
        dot.style.border = '2px solid #FFFFFF';
        dot.style.boxShadow = '0 1px 4px rgba(0,0,0,0.35)';
        wrap.appendChild(dot);

        if (sp.etaMinutes !== null) {
          const pill = document.createElement('span');
          pill.textContent = sp.etaMinutes <= 3 ? 'NOW!' : `ETA ${sp.etaMinutes}m`;
          pill.style.background = 'rgba(11, 31, 46, 0.9)';
          pill.style.color = '#FFFFFF';
          pill.style.fontSize = '10px';
          pill.style.fontWeight = '700';
          pill.style.padding = '2px 6px';
          pill.style.borderRadius = '999px';
          pill.style.whiteSpace = 'nowrap';
          wrap.appendChild(pill);
        }

        wrap.title = `${sp.name} (${sp.area})`;
        wrap.addEventListener('click', () => onSelectSpot(sp));
        markersRef.current.push(
          new maplibregl.Marker({ element: wrap, anchor: 'left' })
            .setLngLat([sp.lng, sp.lat])
            .addTo(map)
        );
      }
    }

    for (const s of sightings) {
      const lat = s.displayLat ?? s.lat;
      const lng = s.displayLng ?? s.lng;
      const sel = s.id === selectedSightingId;
      const bg =
        s.confidence === 'acoustic'
          ? '#0284C7'
          : s.ecotype === 'SRKW'
            ? '#D1493E'
            : '#0E7C72';

      const el = document.createElement('div');
      el.textContent = String(s.estimatedCount);
      el.style.width = sel ? '28px' : '24px';
      el.style.height = sel ? '28px' : '24px';
      el.style.borderRadius = '999px';
      el.style.background = bg;
      el.style.color = '#FFFFFF';
      el.style.display = 'flex';
      el.style.alignItems = 'center';
      el.style.justifyContent = 'center';
      el.style.fontSize = '11px';
      el.style.fontWeight = '800';
      el.style.cursor = 'pointer';
      el.style.border = sel ? '3px solid #0B1F2E' : '2px solid #FFFFFF';
      el.style.boxShadow = '0 2px 8px rgba(11,31,46,0.45)';
      el.title = `${s.title}${s.isCoarsened ? ' (~750m SRKW privacy buffer)' : ''}`;
      el.addEventListener('click', () => onSelectSighting(s));

      markersRef.current.push(
        new maplibregl.Marker({ element: el }).setLngLat([lng, lat]).addTo(map)
      );
    }
  }, [
    sightings,
    spots,
    hydrophones,
    selectedSightingId,
    selectedSpotId,
    showSrkwBuffer,
    showBeaches,
    showHydrophones,
    mapReady,
    mode,
    onSelectSighting,
    onSelectSpot,
  ]);

  const flyToPreset = (preset: 'seattle' | 'full' | 'south') => {
    const map = mapRef.current;
    if (!map) return;
    const targets = {
      seattle: { center: [-122.42, 47.60] as [number, number], zoom: 10.2 },
      full: { center: [-122.48, 47.72] as [number, number], zoom: 8.6 },
      south: { center: [-122.42, 47.42] as [number, number], zoom: 10.4 },
    };
    map.flyTo({ ...targets[preset], duration: 750 });
  };

  if (mode === 'chart' || webglFailed) {
    return (
      <View style={styles.wrapper}>
        {!webglFailed && (
          <View style={styles.modeSwitchBar}>
            <Text style={styles.modeLabel}>Offline Puget Sound Chart</Text>
            <Pressable onPress={() => switchMode('maplibre')} style={styles.switchBtn}>
              <Text style={styles.switchBtnText}>Switch to Live Vector Map</Text>
            </Pressable>
          </View>
        )}
        <PugetSoundMap {...props} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.topBar}>
        <View style={styles.group}>
          <Pressable onPress={() => flyToPreset('seattle')} style={styles.chip}>
            <Text style={styles.chipText}>Seattle Core</Text>
          </Pressable>
          <Pressable onPress={() => flyToPreset('full')} style={styles.chip}>
            <Text style={styles.chipText}>Full Sound</Text>
          </Pressable>
          <Pressable onPress={() => flyToPreset('south')} style={styles.chip}>
            <Text style={styles.chipText}>Vashon &amp; South</Text>
          </Pressable>
        </View>

        <View style={styles.group}>
          <Pressable
            onPress={() => setShowBeaches((v) => !v)}
            style={[styles.layerBtn, showBeaches && styles.layerBtnOn]}
          >
            <Text style={styles.layerBtnText}>Beaches</Text>
          </Pressable>
          <Pressable
            onPress={() => setShowHydrophones((v) => !v)}
            style={[styles.layerBtn, showHydrophones && styles.layerBtnOn]}
          >
            <Text style={styles.layerBtnText}>Hydrophones</Text>
          </Pressable>
          <Pressable
            onPress={() => setShowSrkwBuffer((v) => !v)}
            style={[styles.layerBtn, showSrkwBuffer && styles.layerBtnWarn]}
          >
            <Text style={styles.layerBtnText}>1000yd SRKW</Text>
          </Pressable>
          <Pressable onPress={() => switchMode('chart')} style={styles.switchBtnDark}>
            <Text style={styles.switchBtnDarkText}>Offline Chart</Text>
          </Pressable>
        </View>
      </View>

      <div ref={containerRef} style={{ width: '100%', height }} />

      <View style={styles.legendBar}>
        <View style={styles.legendItem}>
          <View style={[styles.dot, { backgroundColor: '#D1493E' }]} />
          <Text style={styles.legendText}>SRKW (~750m coarsened + 1,000yd zone)</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.dot, { backgroundColor: '#0E7C72' }]} />
          <Text style={styles.legendText}>Bigg&apos;s / Hot Beach</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.dot, { backgroundColor: '#38BDF8' }]} />
          <Text style={styles.legendText}>Orcasound Hydrophone</Text>
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  wrapper: {
    gap: spacing.xs,
  },
  modeSwitchBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: palette.bgSurface,
    paddingHorizontal: spacing.md,
    paddingVertical: 7,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: palette.border,
  },
  modeLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: palette.inkSecondary,
  },
  switchBtn: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radii.pill,
    backgroundColor: palette.tealSoft,
  },
  switchBtnText: {
    fontSize: 11.5,
    fontWeight: '700',
    color: palette.tealPrimary,
  },
  container: {
    borderRadius: radii.lg,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.bgMapWaterDeep,
  },
  topBar: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: palette.bgHeader,
  },
  group: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    alignItems: 'center',
  },
  chip: {
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: radii.pill,
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  chipText: {
    color: '#E2EFF6',
    fontSize: 11.5,
    fontWeight: '600',
  },
  layerBtn: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: 'rgba(148, 197, 224, 0.25)',
  },
  layerBtnOn: {
    backgroundColor: 'rgba(14, 124, 114, 0.42)',
    borderColor: '#2DD4BF',
  },
  layerBtnWarn: {
    backgroundColor: 'rgba(209, 73, 62, 0.35)',
    borderColor: '#F26457',
  },
  layerBtnText: {
    color: '#E2EFF6',
    fontSize: 11,
    fontWeight: '600',
  },
  switchBtnDark: {
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: radii.sm,
    backgroundColor: 'rgba(255,255,255,0.14)',
  },
  switchBtnDarkText: {
    color: '#5EEAD4',
    fontSize: 11,
    fontWeight: '700',
  },
  legendBar: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: palette.bgHeader,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  dot: {
    width: 9,
    height: 9,
    borderRadius: 99,
  },
  legendText: {
    color: '#B8D0DE',
    fontSize: 11.5,
    fontWeight: '500',
  },
});
