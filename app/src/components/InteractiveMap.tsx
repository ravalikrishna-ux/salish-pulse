import React from 'react';
import { HydrophoneNode, Sighting, SpotWithEta } from '../types';
import { PugetSoundMap } from './PugetSoundMap';

export interface InteractiveMapProps {
  sightings: Sighting[];
  spots: SpotWithEta[];
  hydrophones: HydrophoneNode[];
  selectedSightingId: string | null;
  selectedSpotId: string | null;
  onSelectSighting: (s: Sighting) => void;
  onSelectSpot: (spot: SpotWithEta) => void;
  height?: number;
}

/**
 * Native iOS & Android InteractiveMap wrapper.
 * Renders the zero-dependency offline-capable PugetSoundMap SVG marine chart in Expo Go,
 * while web uses InteractiveMap.web.tsx (MapLibre GL + SVG fallback).
 */
export const InteractiveMap: React.FC<InteractiveMapProps> = (props) => {
  return <PugetSoundMap {...props} />;
};
