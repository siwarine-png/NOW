/**
 * Real Web Push for the web build -- same mechanism the older BECOME
 * prototype already proved out (VAPID + PushManager.subscribe), adapted to
 * go through the engine's PATCH /users/:id instead of a direct Supabase
 * write (this client never talks to Supabase directly, per the engine's
 * own "no direct DB access from clients" principle).
 */
import { updateUser } from './api/engine';

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(base64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

const VAPID_PUBLIC_KEY = process.env.EXPO_PUBLIC_VAPID_PUBLIC_KEY;

export function webPushSupported() {
  return typeof navigator !== 'undefined' && 'serviceWorker' in navigator
    && typeof window !== 'undefined' && 'PushManager' in window && !!VAPID_PUBLIC_KEY;
}

// navigator.serviceWorker.getRegistration() can return undefined for a
// beat after page load -- registration happens async, on the window 'load'
// event (see scripts/patch-web-build.js's injected script), so a component
// mounting around the same time can race it and read "no subscription" even
// when one genuinely exists. That false read is exactly what made the
// Settings toggle look like it "comes and goes" across app opens: the
// server-side web_push_subscription and the browser's actual subscription
// were both fine, only this status check was flaky. .ready waits
// indefinitely for an active worker instead of sampling registration state
// at an arbitrary moment, which subscribeToWebPush below already relied on.
export async function getWebPushSubscription() {
  if (!webPushSupported()) return null;
  try {
    const reg = await navigator.serviceWorker.ready;
    return reg.pushManager.getSubscription();
  } catch (e) {
    return null;
  }
}

export async function subscribeToWebPush(userId) {
  if (!webPushSupported()) throw new Error('Push not supported on this browser');
  const reg = await navigator.serviceWorker.ready;
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('Notification permission denied');

  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    });
  }
  const raw = sub.toJSON();
  await updateUser(userId, { web_push_subscription: { endpoint: raw.endpoint, keys: raw.keys } });
  return sub;
}

export async function unsubscribeFromWebPush(userId) {
  const sub = await getWebPushSubscription();
  if (!sub) return;
  await sub.unsubscribe();
  await updateUser(userId, { web_push_subscription: null });
}
