const DRAFT_KEY = 'songSearchSetDraft';
const PLAYLISTS_KEY = 'songSearchPlaylists';

function readIds(key) {
  try { return JSON.parse(localStorage.getItem(key) || '[]'); }
  catch { return []; }
}

function writeIds(key, ids) {
  try { localStorage.setItem(key, JSON.stringify(ids)); } catch {}
}

function readPlaylists() {
  try { return JSON.parse(localStorage.getItem(PLAYLISTS_KEY) || '[]'); }
  catch { return []; }
}

function writePlaylists(playlists) {
  try { localStorage.setItem(PLAYLISTS_KEY, JSON.stringify(playlists)); } catch {}
}

// --- Explicit-ID API calls, used directly by the /set/[id]/ page ---

export async function fetchSetlist(id) {
  const response = await fetch(`/api/setlists/${id}`);
  if (!response.ok) return null;
  return response.json();
}

export async function updateSetlist(id, songIds, name) {
  const body = name === undefined ? { songIds } : { songIds, name };
  const response = await fetch(`/api/setlists/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new Error(data?.error || 'Failed to update set list');
  }
  return response.json();
}

export async function createSetlist(songIds, name) {
  const response = await fetch('/api/setlists', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ songIds, name }),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new Error(data?.error || 'Failed to create set list');
  }
  return response.json();
}

// --- Draft helpers: the playlist currently being built. Always local-only
// (localStorage, no network), so there's no read-modify-write race to
// guard against — unlike the old "live set" model this replaces. ---

export function getDraftIds() {
  return readIds(DRAFT_KEY);
}

export function addToDraft(songId) {
  const ids = getDraftIds();
  if (ids.includes(songId)) return ids;
  const next = [...ids, songId];
  writeIds(DRAFT_KEY, next);
  return next;
}

export function removeFromDraft(songId) {
  const next = getDraftIds().filter((id) => id !== songId);
  writeIds(DRAFT_KEY, next);
  return next;
}

export function reorderInDraft(songId, direction) {
  const ids = getDraftIds();
  const index = ids.indexOf(songId);
  if (index === -1) return ids;
  const target = index + direction;
  if (target < 0 || target >= ids.length) return ids;
  const next = [...ids];
  [next[index], next[target]] = [next[target], next[index]];
  writeIds(DRAFT_KEY, next);
  return next;
}

// --- Library helpers: the local "My Playlists" list, keyed by playlist id.
// This is purely a per-browser bookmark list — it never affects the
// underlying set list stored server-side, which keeps existing and stays
// reachable by its link regardless of what's in anyone's local library. ---

export function getPlaylists() {
  return readPlaylists();
}

export function isInLibrary(id) {
  return readPlaylists().some((p) => p.id === id);
}

export function addPlaylistToLibrary(id, name) {
  const playlists = readPlaylists();
  if (playlists.some((p) => p.id === id)) return playlists;
  const next = [{ id, name }, ...playlists];
  writePlaylists(next);
  return next;
}

export function removePlaylistFromLibrary(id) {
  const next = readPlaylists().filter((p) => p.id !== id);
  writePlaylists(next);
  return next;
}

export function updatePlaylistNameInLibrary(id, name) {
  const next = readPlaylists().map((p) => (p.id === id ? { ...p, name } : p));
  writePlaylists(next);
  return next;
}

export async function saveDraftAsPlaylist(name) {
  const songIds = getDraftIds();
  const data = await createSetlist(songIds, name);
  addPlaylistToLibrary(data.id, name);
  writeIds(DRAFT_KEY, []);
  return data.id;
}
