/**
 * Registers this device for the daily check-in reminder. Called on every
 * launch (cheap no-op if already registered/denied) rather than only once at
 * onboarding, so a user who grants permission later still gets picked up.
 */
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { updateUser } from './api/engine';
import { showAlert } from './utils/alert';

// `surfaceErrors`: a release build gives no way to see console.error output,
// so Settings' manual "retry" call passes true here to Alert the real
// failure reason instead of failing silently like the on-launch auto-call.
export async function registerPushToken(userId, surfaceErrors = false) {
  if (!userId) return;
  try {
    const existing = await Notifications.getPermissionsAsync();
    let status = existing.status;
    if (status !== 'granted') {
      const requested = await Notifications.requestPermissionsAsync();
      status = requested.status;
    }
    if (status !== 'granted') {
      if (surfaceErrors) showAlert('Not enabled', 'Notification permission was not granted.');
      return;
    }

    const projectId = Constants.expoConfig?.extra?.eas?.projectId;
    if (!projectId && surfaceErrors) showAlert('Push debug', 'No EAS projectId found in Constants.expoConfig.');
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
    if (!token && surfaceErrors) showAlert('Push debug', 'getExpoPushTokenAsync returned no token.');
    await updateUser(userId, { push_token: token });
    if (surfaceErrors) showAlert('Registered', 'Push token saved.');
  } catch (e) {
    console.error('[push] registration failed', e.message);
    if (surfaceErrors) showAlert('Push registration failed', e.message || String(e));
  }
}
