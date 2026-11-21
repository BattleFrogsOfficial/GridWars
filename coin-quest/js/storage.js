// On-device persistence. The whole save is one JSON document in IndexedDB (falls back to localStorage).
// Nothing ever leaves the device except a backup file the user chooses to download.

import { emptyState, normalizeState, APP_ID } from './state.js';
import { todayISO } from './dates.js';

const DB_NAME = APP_ID;
const STORE = 'kv';
const KEY = 'state';

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

let dbPromise = null;
function db() {
  if (!dbPromise) dbPromise = typeof indexedDB === 'undefined' ? Promise.reject(new Error('no idb')) : openDb();
  return dbPromise;
}

async function idbGet() {
  const d = await db();
  return new Promise((resolve, reject) => {
    const req = d.transaction(STORE).objectStore(STORE).get(KEY);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbPut(value) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const tx = d.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(value, KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function loadState() {
  let raw = null;
  try {
    raw = await idbGet();
  } catch {
    try {
      raw = JSON.parse(localStorage.getItem(DB_NAME) || 'null');
    } catch {
      raw = null;
    }
  }
  if (!raw) return emptyState();
  try {
    return normalizeState(typeof raw === 'string' ? JSON.parse(raw) : raw);
  } catch (err) {
    // Never let a later save overwrite data we couldn't read: keep a copy of it first.
    console.error('Save file could not be read; a copy was kept and the app started fresh', err);
    const copy = typeof raw === 'string' ? raw : JSON.stringify(raw);
    try {
      const d = await db();
      await new Promise((resolve, reject) => {
        const tx = d.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put(copy, `unreadable-${Date.now()}`);
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      });
    } catch {
      try {
        localStorage.setItem(`${DB_NAME}-unreadable`, copy);
      } catch {
        /* nothing more we can do */
      }
    }
    loadProblem = true;
    return emptyState();
  }
}

/** True if the last load found a save it could not read (a copy of it was kept). */
export let loadProblem = false;

export async function saveState(state) {
  const json = JSON.stringify(state);
  try {
    await idbPut(json);
  } catch {
    try {
      localStorage.setItem(DB_NAME, json);
    } catch (err) {
      console.error('Could not save', err);
      throw err;
    }
  }
}

/** Ask the browser not to evict our data (important on iOS). Returns true if storage is persistent. */
export async function requestPersistence() {
  try {
    if (!navigator.storage?.persist) return false;
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

export function downloadBackup(state) {
  const blob = new Blob([JSON.stringify(state, null, 1)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `coin-quest-backup-${todayISO()}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/** Read a backup file chosen by the user. Throws a readable error if the file is not valid. */
export async function readBackup(file) {
  if (file.size > 20 * 1024 * 1024) throw new Error('That file is too large to be a backup');
  let raw;
  try {
    raw = JSON.parse(await file.text());
  } catch {
    throw new Error('That file is not valid JSON');
  }
  return normalizeState(raw);
}
