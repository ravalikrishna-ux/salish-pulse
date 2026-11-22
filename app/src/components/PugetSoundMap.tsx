import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, {
  Circle,
  Defs,
  G,
  Line,
  LinearGradient,
  Path,
  Polygon,
  Rect,
  Stop,
  Text as SvgText,
} from 'react-native-svg';
import { palette, radii, spacing } from '../theme';
import { HydrophoneNode, Sighting, SpotWithEta } from '../types';
import { directionToDegrees } from '../utils/geo';

export type MapViewportPreset = 'seattle' | 'full' | 'south';

interface ViewportBounds {
  label: string;
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}

const VIEWPORTS: Record<MapViewportPreset, ViewportBounds> = {
  seattle: {
    label: 'Seattle Core',
    minLat: 47.46,
    maxLat: 47.86,
    minLng: -122.58,
    maxLng: -122.26,
  },
  full: {
    label: 'Puget Sound',
    minLat: 47.26,
    maxLat: 48.16,
    minLng: -122.79,
    maxLng: -122.20,
  },
  south: {
    label: 'Vashon & South',
    minLat: 47.27,
    maxLat: 47.61,
    minLng: -122.58,
    maxLng: -122.26,
  },
};

// Simplified accurate geographic outlines [lat, lng] for Puget Sound landmasses
const EAST_SHORE_SEATTLE: Array<[number, number]> = [
  [48.20, -122.15],
  [48.20, -122.36],
  [48.03, -122.29], // Everett / Mukilteo north
  [47.95, -122.30], // Mukilteo Lighthouse
  [47.86, -122.33], // Picnic Point / Sunset Bay
  [47.81, -122.38], // Edmonds Brackett's
  [47.75, -122.39], // Richmond Beach
  [47.69, -122.40], // Golden Gardens
  [47.66, -122.435], // West Point / Discovery Park
  [47.62, -122.36], // Magnolia / Pier 91
  [47.60, -122.335], // Downtown Seattle Waterfront
  [47.58, -122.35], // Harbor Island
  [47.59, -122.39], // Duwamish Head
  [47.576, -122.42], // Alki Point
  [47.568, -122.41], // Constellation
  [47.530, -122.394], // Lincoln Park
  [47.49, -122.38], // Seahurst
  [47.40, -122.33], // Des Moines
  [47.349, -122.325], // Redondo / MaST
  [47.30, -122.39], // Browns Point
  [47.27, -122.44], // Tacoma Tideflats
  [47.31, -122.53], // Point Defiance
  [47.24, -122.55], // Tacoma Narrows east
  [47.24, -122.15],
];

const KITSAP_PENINSULA: Array<[number, number]> = [
  [48.18, -122.84],
  [48.13, -122.76], // Port Townsend
  [48.02, -122.69], // Marrowstone
  [47.92, -122.63], // Point No Point
  [47.80, -122.50], // Kingston
  [47.72, -122.53], // Suquamish
  [47.64, -122.59], // Agate Pass / Poulsbo
  [47.55, -122.54], // Manchester
  [47.51, -122.50], // Southworth
  [47.44, -122.52], // Olalla
  [47.34, -122.56], // Gig Harbor
  [47.24, -122.60],
  [47.24, -122.84],
];

const BAINBRIDGE_ISLAND: Array<[number, number]> = [
  [47.71, -122.52],
  [47.68, -122.49],
  [47.62, -122.48], // Wing Point
  [47.58, -122.50], // Restoration Point
  [47.575, -122.525], // Fort Ward
  [47.62, -122.57],
  [47.68, -122.56],
];

const VASHON_ISLAND: Array<[number, number]> = [
  [47.51, -122.46], // Vashon Ferry Dock
  [47.47, -122.43],
  [47.40, -122.42],
  [47.388, -122.374], // Point Robinson (Maury)
  [47.34, -122.41], // Maury south
  [47.33, -122.49], // Tahlequah
  [47.39, -122.50], // Colvos Passage east
  [47.47, -122.49],
];

const WHIDBEY_ISLAND: Array<[number, number]> = [
  [48.20, -122.68],
  [48.20, -122.52],
  [48.03, -122.40], // Langley
  [47.92, -122.35], // Clinton / Possession Point
  [47.91, -122.42],
  [47.97, -122.55],
  [48.032, -122.607], // Bush Point
  [48.12, -122.67], // Fort Casey
];

const BLAKE_ISLAND: Array<[number, number]> = [
  [47.546, -122.487],
  [47.542, -122.474],
  [47.532, -122.481],
  [47.537, -122.495],
];

const WATERWAY_LABELS: Array<{ label: string; lat: number; lng: number }> = [
  { label: 'ADMIRALTY INLET', lat: 48.05, lng: -122.66 },
  { label: 'POSSESSION SOUND', lat: 47.93, lng: -122.33 },
  { label: 'MAIN BASIN', lat: 47.72, lng: -122.46 },
  { label: 'ELLIOTT BAY', lat: 47.605, lng: -122.39 },
  { label: 'EAST PASSAGE', lat: 47.43, lng: -122.37 },
  { label: 'COLVOS PASSAGE', lat: 47.42, lng: -122.505 },
];

const CITY_LABELS: Array<{ label: string; lat: number; lng: number }> = [
  { label: 'SEATTLE', lat: 47.615, lng: -122.305 },
  { label: 'WEST SEATTLE', lat: 47.552, lng: -122.36 },
  { label: 'EDMONDS', lat: 47.812, lng: -122.335 },
  { label: 'BAINBRIDGE', lat: 47.645, lng: -122.528 },
  { label: 'VASHON', lat: 47.445, lng: -122.46 },
  { label: 'TACOMA', lat: 47.285, lng: -122.46 },
];

interface Props {
  sightings: Sighting[];
  spots: SpotWithEta[];
  hydrophones: HydrophoneNode[];
  selectedSightingId: string | null;
  selectedSpotId: string | null;
  onSelectSighting: (s: Sighting) => void;
  onSelectSpot: (spot: SpotWithEta) => void;
  height?: number;
}

export const PugetSoundMap: React.FC<Props> = ({
  sightings,
  spots,
  hydrophones,
  selectedSightingId,
  selectedSpotId,
  onSelectSighting,
  onSelectSpot,
  height = 420,
}) => {
  const [preset, setPreset] = useState<MapViewportPreset>('seattle');
  const [showBeaches, setShowBeaches] = useState(true);
  const [showHydrophones, setShowHydrophones] = useState(true);
  const [showSrkwBuffer, setShowSrkwBuffer] = useState(true);

  const bounds = VIEWPORTS[preset];
  const W = 560;
  const H = 640;

  const project = useMemo(() => {
    const cosMid = Math.cos((((bounds.minLat + bounds.maxLat) / 2) * Math.PI) / 180);
    const lngSpan = (bounds.maxLng - bounds.minLng) * cosMid;
    const latSpan = bounds.maxLat - bounds.minLat;

    return (lat: number, lng: number) => {
      const x = (((lng - bounds.minLng) * cosMid) / lngSpan) * W;
      const y = ((bounds.maxLat - lat) / latSpan) * H;
      return { x, y };
    };
  }, [bounds]);

  const toPoints = (coords: Array<[number, number]>) =>
    coords
      .map(([lat, lng]) => {
        const p = project(lat, lng);
        return `${p.x.toFixed(1)},${p.y.toFixed(1)}`;
      })
      .join(' ');

  // Connect recent J-Pod track line if both West Point & Alki sightings exist
  const srkwTrackPath = useMemo(() => {
    const srkws = sightings
      .filter((s) => s.ecotype === 'SRKW' && s.confidence !== 'acoustic')
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    if (srkws.length < 2) return '';
    return srkws
      .map((s, idx) => {
        const p = project(s.lat, s.lng);
        return `${idx === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`;
      })
      .join(' ');
  }, [sightings, project]);

  const getEcotypeColor = (ecotype: Sighting['ecotype'], confidence: Sighting['confidence']) => {
    if (confidence === 'acoustic') return '#38BDF8';
    if (ecotype === 'SRKW') return '#F26457';
    if (ecotype === 'BIGGS') return '#2DD4BF';
    return '#94A3B8';
  };

  return (
    <View style={[styles.container, { minHeight: height }]}>
      {/* Map Controls Top Overlay */}
      <View style={styles.topBar}>
        <View style={styles.presetGroup}>
          {(Object.keys(VIEWPORTS) as MapViewportPreset[]).map((key) => {
            const active = preset === key;
            return (
              <Pressable
                key={key}
                onPress={() => setPreset(key)}
                style={[styles.chip, active && styles.chipActive]}
              >
                <Text style={[styles.chipText, active && styles.chipTextActive]}>
                  {VIEWPORTS[key].label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <View style={styles.layerGroup}>
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
            style={[styles.layerBtn, showSrkwBuffer && styles.layerBtnOnWarn]}
          >
            <Text style={styles.layerBtnText}>1000yd SRKW</Text>
          </Pressable>
        </View>
      </View>

      {/* Interactive SVG Marine Chart */}
      <View style={styles.svgWrapper}>
        <Svg
          viewBox={`0 0 ${W} ${H}`}
          width="100%"
          height={height}
          preserveAspectRatio="xMidYMid slice"
        >
          <Defs>
            <LinearGradient id="salishWater" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0%" stopColor="#0C263B" />
              <Stop offset="55%" stopColor="#0A1F31" />
              <Stop offset="100%" stopColor="#081827" />
            </LinearGradient>
          </Defs>

          {/* Ocean Base */}
          <Rect x={0} y={0} width={W} height={H} fill="url(#salishWater)" />

          {/* Subtle nautical latitude/longitude graticule */}
          {[47.3, 47.4, 47.5, 47.6, 47.7, 47.8, 47.9, 48.0, 48.1].map((lat) => {
            const p = project(lat, bounds.minLng);
            return (
              <Line
                key={`lat-${lat}`}
                x1={0}
                y1={p.y}
                x2={W}
                y2={p.y}
                stroke="rgba(148, 197, 224, 0.08)"
                strokeDasharray="4,6"
                strokeWidth={1}
              />
            );
          })}

          {/* Puget Sound Landmasses */}
          <Polygon
            points={toPoints(EAST_SHORE_SEATTLE)}
            fill={palette.bgMapLand}
            stroke={palette.bgMapLandStroke}
            strokeWidth={1.6}
          />
          <Polygon
            points={toPoints(KITSAP_PENINSULA)}
            fill={palette.bgMapLand}
            stroke={palette.bgMapLandStroke}
            strokeWidth={1.6}
          />
          <Polygon
            points={toPoints(BAINBRIDGE_ISLAND)}
            fill={palette.bgMapLand}
            stroke={palette.bgMapLandStroke}
            strokeWidth={1.6}
          />
          <Polygon
            points={toPoints(VASHON_ISLAND)}
            fill={palette.bgMapLand}
            stroke={palette.bgMapLandStroke}
            strokeWidth={1.6}
          />
          <Polygon
            points={toPoints(WHIDBEY_ISLAND)}
            fill={palette.bgMapLand}
            stroke={palette.bgMapLandStroke}
            strokeWidth={1.6}
          />
          <Polygon
            points={toPoints(BLAKE_ISLAND)}
            fill={palette.bgMapLand}
            stroke={palette.bgMapLandStroke}
            strokeWidth={1.4}
          />

          {/* Waterway Labels */}
          {WATERWAY_LABELS.map((item) => {
            const p = project(item.lat, item.lng);
            return (
              <SvgText
                key={item.label}
                x={p.x}
                y={p.y}
                fill="rgba(148, 197, 224, 0.34)"
                fontSize={10}
                fontWeight="700"
                letterSpacing={1.4}
                textAnchor="middle"
              >
                {item.label}
              </SvgText>
            );
          })}

          {/* City Land Labels */}
          {CITY_LABELS.map((item) => {
            const p = project(item.lat, item.lng);
            return (
              <SvgText
                key={item.label}
                x={p.x}
                y={p.y}
                fill="rgba(214, 232, 240, 0.56)"
                fontSize={10.5}
                fontWeight="700"
                letterSpacing={1}
                textAnchor="middle"
              >
                {item.label}
              </SvgText>
            );
          })}

          {/* Recent SRKW Corridor Track */}
          {srkwTrackPath ? (
            <Path
              d={srkwTrackPath}
              fill="none"
              stroke="rgba(242, 100, 87, 0.52)"
              strokeWidth={2.5}
              strokeDasharray="6,6"
            />
          ) : null}

          {/* Hydrophone Stations */}
          {showHydrophones &&
            hydrophones.map((node) => {
              const p = project(node.lat, node.lng);
              const detecting = node.status === 'detecting';
              return (
                <G key={node.id}>
                  {detecting && (
                    <Circle
                      cx={p.x}
                      cy={p.y}
                      r={18}
                      fill="rgba(56, 189, 248, 0.16)"
                      stroke="rgba(56, 189, 248, 0.65)"
                      strokeWidth={1.5}
                    />
                  )}
                  <Circle
                    cx={p.x}
                    cy={p.y}
                    r={6}
                    fill={detecting ? '#38BDF8' : '#0284C7'}
                    stroke="#E0F2FE"
                    strokeWidth={1.5}
                  />
                </G>
              );
            })}

          {/* Shore Viewing Spots */}
          {showBeaches &&
            spots.map((spot) => {
              const p = project(spot.lat, spot.lng);
              const isSelected = spot.id === selectedSpotId;
              const isHot = spot.likelihood === 'high';
              const isWarm = spot.likelihood === 'medium';
              return (
                <G key={spot.id} onPress={() => onSelectSpot(spot)}>
                  {(isHot || isSelected) && (
                    <Circle
                      cx={p.x}
                      cy={p.y}
                      r={isSelected ? 14 : 11}
                      fill={isHot ? 'rgba(45, 212, 191, 0.24)' : 'rgba(255,255,255,0.16)'}
                    />
                  )}
                  <Circle
                    cx={p.x}
                    cy={p.y}
                    r={isSelected ? 6.5 : 5}
                    fill={isHot ? '#2DD4BF' : isWarm ? '#FBBF24' : '#CBD5E1'}
                    stroke="#0B1F2E"
                    strokeWidth={1.6}
                  />
                  {spot.etaMinutes !== null && (
                    <G>
                      <Rect
                        x={p.x + 8}
                        y={p.y - 10}
                        rx={5}
                        ry={5}
                        width={62}
                        height={18}
                        fill="rgba(11, 31, 46, 0.88)"
                        stroke={isHot ? '#2DD4BF' : '#FBBF24'}
                        strokeWidth={1}
                      />
                      <SvgText
                        x={p.x + 39}
                        y={p.y + 2}
                        fill="#F8FAFC"
                        fontSize={9.5}
                        fontWeight="700"
                        textAnchor="middle"
                      >
                        {spot.etaMinutes <= 3 ? 'NOW!' : `ETA ${spot.etaMinutes}m`}
                      </SvgText>
                    </G>
                  )}
                </G>
              );
            })}

          {/* Active Sightings with Travel Vector + Optional 1,000yd SRKW Conservation Zone */}
          {sightings.map((s) => {
            const p = project(s.displayLat ?? s.lat, s.displayLng ?? s.lng);
            const color = getEcotypeColor(s.ecotype, s.confidence);
            const selected = s.id === selectedSightingId;
            const deg = directionToDegrees(s.direction);
            const ageMin = (Date.now() - new Date(s.timestamp).getTime()) / 60_000;
            const isFresh = ageMin <= 25;

            let arrowEndX = p.x;
            let arrowEndY = p.y;
            if (deg !== null) {
              const rad = ((deg - 90) * Math.PI) / 180;
              arrowEndX = p.x + Math.cos(rad) * 26;
              arrowEndY = p.y + Math.sin(rad) * 26;
            }

            return (
              <G key={s.id} onPress={() => onSelectSighting(s)}>
                {/* WA 1,000-yard SRKW mandatory exclusion zone visual indicator */}
                {showSrkwBuffer && s.ecotype === 'SRKW' && isFresh && (
                  <Circle
                    cx={p.x}
                    cy={p.y}
                    r={24}
                    fill="rgba(242, 100, 87, 0.13)"
                    stroke="rgba(242, 100, 87, 0.55)"
                    strokeDasharray="3,3"
                    strokeWidth={1.3}
                  />
                )}

                {/* Travel heading vector */}
                {deg !== null && (
                  <Line
                    x1={p.x}
                    y1={p.y}
                    x2={arrowEndX}
                    y2={arrowEndY}
                    stroke={color}
                    strokeWidth={2.6}
                    strokeLinecap="round"
                  />
                )}

                {/* Selection ring */}
                {selected && (
                  <Circle
                    cx={p.x}
                    cy={p.y}
                    r={16}
                    fill="none"
                    stroke="#FFFFFF"
                    strokeWidth={2.2}
                  />
                )}

                {/* Core Orca Sighting Dot */}
                <Circle
                  cx={p.x}
                  cy={p.y}
                  r={isFresh ? 9.5 : 7.5}
                  fill={color}
                  stroke="#FFFFFF"
                  strokeWidth={2}
                />

                {/* Whale count inside dot */}
                <SvgText
                  x={p.x}
                  y={p.y + 3.5}
                  fill="#FFFFFF"
                  fontSize={9.5}
                  fontWeight="800"
                  textAnchor="middle"
                >
                  {s.estimatedCount}
                </SvgText>
              </G>
            );
          })}
        </Svg>
      </View>

      {/* Bottom Legend Bar */}
      <View style={styles.legendBar}>
        <View style={styles.legendItem}>
          <View style={[styles.dot, { backgroundColor: '#F26457' }]} />
          <Text style={styles.legendText}>Southern Resident (1000yd)</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.dot, { backgroundColor: '#2DD4BF' }]} />
          <Text style={styles.legendText}>Bigg&apos;s / Hot Beach</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.dot, { backgroundColor: '#38BDF8' }]} />
          <Text style={styles.legendText}>Hydrophone AI</Text>
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: palette.bgMapWaterDeep,
    borderRadius: radii.lg,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#1E3C50',
  },
  topBar: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: 'rgba(9, 25, 39, 0.92)',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(148, 197, 224, 0.14)',
  },
  presetGroup: {
    flexDirection: 'row',
    gap: 6,
  },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radii.pill,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  chipActive: {
    backgroundColor: palette.tealPrimary,
  },
  chipText: {
    color: '#B8D0DE',
    fontSize: 12,
    fontWeight: '600',
  },
  chipTextActive: {
    color: '#FFFFFF',
  },
  layerGroup: {
    flexDirection: 'row',
    gap: 6,
  },
  layerBtn: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: 'rgba(148, 197, 224, 0.25)',
  },
  layerBtnOn: {
    backgroundColor: 'rgba(14, 124, 114, 0.35)',
    borderColor: '#2DD4BF',
  },
  layerBtnOnWarn: {
    backgroundColor: 'rgba(209, 73, 62, 0.32)',
    borderColor: '#F26457',
  },
  layerBtnText: {
    color: '#E2EFF6',
    fontSize: 11,
    fontWeight: '600',
  },
  svgWrapper: {
    width: '100%',
    backgroundColor: palette.bgMapWater,
  },
  legendBar: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: 'rgba(9, 25, 39, 0.95)',
    borderTopWidth: 1,
    borderTopColor: 'rgba(148, 197, 224, 0.14)',
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
