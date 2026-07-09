/**
 * Session store — persists user_id, intervention cache, snooze state.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEYS = {
  USER: 'session_user_v1',
  INTERVENTION: 'session_intervention_v1',
  ONBOARDED: 'session_onboarded_v1',
};

export async function getUser() {
  const raw = await AsyncStorage.getItem(KEYS.USER);
  return raw ? JSON.parse(raw) : null;
}

export async function setUser(user) {
  await AsyncStorage.setItem(KEYS.USER, JSON.stringify(user));
}

export async function isOnboarded() {
  return !!(await AsyncStorage.getItem(KEYS.ONBOARDED));
}

export async function markOnboarded() {
  await AsyncStorage.setItem(KEYS.ONBOARDED, '1');
}

export async function cacheIntervention(data) {
  await AsyncStorage.setItem(KEYS.INTERVENTION, JSON.stringify({ data, cached_at: Date.now() }));
}

export async function getCachedIntervention() {
  const raw = await AsyncStorage.getItem(KEYS.INTERVENTION);
  if (!raw) return null;
  const { data, cached_at } = JSON.parse(raw);
  // Cache valid for 30 min
  if (Date.now() - cached_at > 30 * 60 * 1000) return null;
  return data;
}

export async function clearIntervention() {
  await AsyncStorage.removeItem(KEYS.INTERVENTION);
}

export async function clearAll() {
  await AsyncStorage.multiRemove(Object.values(KEYS));
}
