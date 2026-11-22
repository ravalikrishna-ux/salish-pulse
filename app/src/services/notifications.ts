import { Platform } from 'react-native';
import { AlertPreferences, PushRegistrationState } from '../types';
import { syncSubscriptionToBackend } from './api';
import { loadSubscriptionId, saveSubscriptionId } from './storage';

/**
 * Requests push notification permissions on iOS/Android (via expo-notifications)
 * or Web (via Browser Notification API) and syncs alert preferences to POST /api/subscriptions.
 */
export async function registerForPushAlerts(
  prefs: AlertPreferences
): Promise<PushRegistrationState> {
  const existingSubId = await loadSubscriptionId();

  if (Platform.OS === 'web') {
    let permission: PushRegistrationState['permission'] = 'unsupported';
    let token: string | null = null;

    if (typeof window !== 'undefined' && 'Notification' in window) {
      try {
        const result =
          window.Notification.permission === 'granted'
            ? 'granted'
            : await window.Notification.requestPermission();
        permission =
          result === 'granted' ? 'granted' : result === 'denied' ? 'denied' : 'undetermined';
        if (permission === 'granted') {
          token = `web-push-${existingSubId ?? Math.random().toString(36).slice(2, 12)}`;
        }
      } catch {
        permission = 'undetermined';
      }
    }

    const syncedId = await syncSubscriptionToBackend(prefs, {
      id: existingSubId ?? undefined,
      channel: 'web_push',
      token: token ?? `web-local-${Date.now()}`,
    });

    const finalId = syncedId ?? existingSubId;
    if (finalId) await saveSubscriptionId(finalId);

    return {
      permission,
      channel: 'web_push',
      token,
      subscriptionId: finalId,
      syncedAt: syncedId ? new Date().toISOString() : null,
    };
  }

  // Native iOS / Android via expo-notifications
  let permission: PushRegistrationState['permission'] = 'undetermined';
  let expoToken: string | null = null;

  try {
    const Notifications = await import('expo-notifications');
    const existing = await Notifications.getPermissionsAsync();
    let finalStatus = existing.status;

    if (finalStatus !== 'granted') {
      const requested = await Notifications.requestPermissionsAsync();
      finalStatus = requested.status;
    }

    permission =
      finalStatus === 'granted'
        ? 'granted'
        : finalStatus === 'denied'
          ? 'denied'
          : 'undetermined';

    if (permission === 'granted') {
      try {
        const tokenResp = await Notifications.getExpoPushTokenAsync();
        expoToken = tokenResp.data;
      } catch {
        // Running inside Expo Go without EAS projectId — use deterministic local device fallback
        expoToken = `ExponentPushToken[local-${existingSubId ?? 'device'}]`;
      }
    }
  } catch {
    permission = 'unsupported';
  }

  const syncedId = await syncSubscriptionToBackend(prefs, {
    id: existingSubId ?? undefined,
    channel: 'expo',
    token: expoToken ?? `ExponentPushToken[local-${Date.now()}]`,
  });

  const finalId = syncedId ?? existingSubId;
  if (finalId) await saveSubscriptionId(finalId);

  return {
    permission,
    channel: 'expo',
    token: expoToken,
    subscriptionId: finalId,
    syncedAt: syncedId ? new Date().toISOString() : null,
  };
}
