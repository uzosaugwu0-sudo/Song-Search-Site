const PLAYLISTS_KEY = 'songSearchPlaylists';

function readList(key) {
  try { return JSON.parse(localStorage.getItem(key) || '[]'); }
  catch { return []; }
}

function writeList(key, list) {
  try { localStorage.setItem(key, JSON.stringify(list)); } catch {}
}

// --- Set list API calls ---

async function sendJson(url, method, body, failureMessage) {
  const response = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new Error(data?.error || failureMessage);
  }
  return response.json();
}

export function updateSetlist(id, songIds, name) {
  const body = name === undefined ? { songIds } : { songIds, name };
  return sendJson(`/api/setlists/${id}`, 'PUT', body, 'Failed to update set list');
}

export function createSetlist(songIds, name) {
  return sendJson('/api/setlists', 'POST', { songIds, name }, 'Failed to create set list');
}

export async function listSetlists() {
  const response = await fetch('/api/setlists');
  if (!response.ok) throw new Error('Could not load the public service lists');
  return response.json();
}

export async function deleteSetlist(id) {
  const response = await fetch(`/api/setlists/${id}`, { method: 'DELETE' });
  if (!response.ok) throw new Error('Could not delete this service list');
}

// --- Library helpers: the local "My Playlists" list. Purely a per-browser
// bookmark list — it never affects the set list stored server-side. ---

export function getPlaylists() {
  return readList(PLAYLISTS_KEY);
}

export function isInLibrary(id) {
  return getPlaylists().some((p) => p.id === id);
}

export function addPlaylistToLibrary(id, name) {
  const playlists = getPlaylists();
  if (playlists.some((p) => p.id === id)) return playlists;
  const next = [{ id, name }, ...playlists];
  writeList(PLAYLISTS_KEY, next);
  return next;
}

export function removePlaylistFromLibrary(id) {
  const next = getPlaylists().filter((p) => p.id !== id);
  writeList(PLAYLISTS_KEY, next);
  return next;
}

export function updatePlaylistNameInLibrary(id, name) {
  const next = getPlaylists().map((p) => (p.id === id ? { ...p, name } : p));
  writeList(PLAYLISTS_KEY, next);
  return next;
}
