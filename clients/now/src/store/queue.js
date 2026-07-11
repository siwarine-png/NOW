/**
 * Offline queue — ADHD users on flaky connections must never lose a check-in.
 * Done/Snooze events are written here first, synced when connectivity returns.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { postCheckin, postSnooze, postEquivalentCheckin, postFocusSession } from '../api/engine';

const KEY = 'engine_queue_v1';

export async function enqueue(item) {
  const raw = await AsyncStorage.getItem(KEY);
  const queue = raw ? JSON.parse(raw) : [];
  queue.push({ ...item, queued_at: Date.now(), synced: false });
  await AsyncStorage.setItem(KEY, JSON.stringify(queue));
}

export async function flushQueue() {
  const raw = await AsyncStorage.getItem(KEY);
  if (!raw) return { flushed: 0, failed: 0 };
  const queue = JSON.parse(raw);
  const pending = queue.filter(i => !i.synced);
  let flushed = 0, failed = 0;

  for (const item of pending) {
    try {
      if (item.type === 'checkin') {
        await postCheckin(item.commitment_id, item.result, item.energy, item.intervention_id);
      } else if (item.type === 'snooze') {
        await postSnooze(item.commitment_id, item.snooze_minutes, item.intervention_id);
      } else if (item.type === 'equivalent_checkin') {
        await postEquivalentCheckin(item.equivalent_id, item.result, item.energy);
      } else if (item.type === 'focus_session') {
        await postFocusSession(item.payload);
      }
      item.synced = true;
      flushed++;
    } catch {
      failed++;
    }
  }

  await AsyncStorage.setItem(KEY, JSON.stringify(queue));
  return { flushed, failed };
}

export async function pendingCount() {
  const raw = await AsyncStorage.getItem(KEY);
  if (!raw) return 0;
  return JSON.parse(raw).filter(i => !i.synced).length;
}
