import AsyncStorage from '@react-native-async-storage/async-storage';
import { AlertPreferences, Sighting } from '../types';

const KEYS = {
  SIGHTINGS: 'salishpulse:v1:sightings',
  ALERT_PREFS: 'salishpulse:v1:alertPrefs',
  SUBSCRIPTION_ID: 'salishpulse:v1:subscriptionId',
  MAP_MODE: 'salishpulse:v1:mapMode',
} as const;

export async function loadCachedSightings(): Promise<Sighting[] | null> {
  try {
    const raw = await AsyncStorage.getItem(KEYS.SIGHTINGS);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length > 0 ? (parsed as Sighting[]) : null;
  } catch {
    return null;
  }
}

export async function saveCachedSightings(sightings: Sighting[]): Promise<void> {
  try {
    // Keep most recent 40 sightings to ensure instant cold-start hydration
    await AsyncStorage.setItem(KEYS.SIGHTINGS, JSON.stringify(sightings.slice(0, 40)));
  } catch {
    // Storage quota or private browsing mode — fail silently
  }
}

export async function loadAlertPreferences(): Promise<AlertPreferences | null> {
  try {
    const raw = await AsyncStorage.getItem(KEYS.ALERT_PREFS);
    if (!raw) return null;
    return JSON.parse(raw) as AlertPreferences;
  } catch {
    return null;
  }
}

export async function saveAlertPreferences(prefs: AlertPreferences): Promise<void> {
  try {
    await AsyncStorage.setItem(KEYS.ALERT_PREFS, JSON.stringify(prefs));
  } catch {
    // Fail silently if storage unavailable
  }
}

export async function loadSubscriptionId(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(KEYS.SUBSCRIPTION_ID);
  } catch {
    return null;
  }
}

export async function saveSubscriptionId(id: string | null): Promise<void> {
  try {
    if (id) {
      await AsyncStorage.setItem(KEYS.SUBSCRIPTION_ID, id);
    } else {
      await AsyncStorage.removeItem(KEYS.SUBSCRIPTION_ID);
    }
  } catch {
    // Ignore storage errors
  }
}

export async function loadMapMode(): Promise<'maplibre' | 'chart' | null> {
  try {
    const val = await AsyncStorage.getItem(KEYS.MAP_MODE);
    return val === 'maplibre' || val === 'chart' ? val : null;
  } catch {
    return null;
  }
}

export async function saveMapMode(mode: 'maplibre' | 'chart'): Promise<void> {
  try {
    await AsyncStorage.setItem(KEYS.MAP_MODE, mode);
  } catch {
    // Ignore
  }
}
