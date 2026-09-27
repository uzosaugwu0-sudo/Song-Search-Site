const DRAFT_KEY = 'songSearchSetDraft';
const LIVE_ID_KEY = 'songSearchSetId';

function readIds(key) {
  try { return JSON.parse(localStorage.getItem(key) || '[]'); }
  catch { return []; }
}

function writeIds(key, ids) {
  try { localStorage.setItem(key, JSON.stringify(ids)); } catch {}
}

// --- Explicit-ID API calls, used directly by the /set/[id]/ page ---

export async function fetchSetlist(id) {
  const response = await fetch(`/api/setlists/${id}`);
  if (!response.ok) return null;
  return response.json();
}

export async function updateSetlist(id, songIds) {
  const response = await fetch(`/api/setlists/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ songIds }),
  });
  if (!response.ok) throw new Error('Failed to update set list');
  return response.json();
}

export async function createSetlist(songIds) {
  const response = await fetch('/api/setlists', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ songIds }),
  });
  if (!response.ok) throw new Error('Failed to create set list');
  return response.json();
}

// --- Draft-vs-live helpers, used by the home page "My Set" tab and add-to-set buttons ---

export function getLiveSetId() {
  try { return localStorage.getItem(LIVE_ID_KEY); }
  catch { return null; }
}

export function getDraftIds() {
  return readIds(DRAFT_KEY);
}

export async function getCurrentSetIds() {
  const liveId = getLiveSetId();
  if (!liveId) return getDraftIds();
  const data = await fetchSetlist(liveId);
  return data ? data.songIds : [];
}

export async function addSongToSet(songId) {
  const liveId = getLiveSetId();
  if (!liveId) {
    const ids = getDraftIds();
    if (ids.includes(songId)) return ids;
    const next = [...ids, songId];
    writeIds(DRAFT_KEY, next);
    return next;
  }
  const current = await getCurrentSetIds();
  if (current.includes(songId)) return current;
  const result = await updateSetlist(liveId, [...current, songId]);
  return result.songIds;
}

export async function removeSongFromSet(songId) {
  const liveId = getLiveSetId();
  if (!liveId) {
    const next = getDraftIds().filter((id) => id !== songId);
    writeIds(DRAFT_KEY, next);
    return next;
  }
  const current = await getCurrentSetIds();
  const result = await updateSetlist(liveId, current.filter((id) => id !== songId));
  return result.songIds;
}

export async function reorderSongInSet(songId, direction) {
  const liveId = getLiveSetId();
  const ids = liveId ? await getCurrentSetIds() : getDraftIds();
  const index = ids.indexOf(songId);
  if (index === -1) return ids;
  const target = index + direction;
  if (target < 0 || target >= ids.length) return ids;
  const next = [...ids];
  [next[index], next[target]] = [next[target], next[index]];
  if (!liveId) {
    writeIds(DRAFT_KEY, next);
    return next;
  }
  const result = await updateSetlist(liveId, next);
  return result.songIds;
}

export async function shareSet() {
  const ids = getDraftIds();
  const data = await createSetlist(ids);
  try {
    localStorage.setItem(LIVE_ID_KEY, data.id);
    localStorage.removeItem(DRAFT_KEY);
  } catch {}
  return data.id;
}

export function startNewSet() {
  try { localStorage.removeItem(LIVE_ID_KEY); } catch {}
}
