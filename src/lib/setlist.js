export const MAX_SETLIST_SIZE = 50;
export const MAX_SETLIST_NAME_LENGTH = 100;

export function filterValidSongIds(songIds, validIds) {
  if (!Array.isArray(songIds)) return [];
  return songIds.filter((id) => typeof id === 'string' && validIds.has(id));
}

export function generateSetlistId() {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = new Uint8Array(10);
  crypto.getRandomValues(bytes);
  let id = '';
  for (const byte of bytes) {
    id += alphabet[byte % alphabet.length];
  }
  return id;
}

export function buildSetlistValue(songIds, name) {
  return JSON.stringify({ songIds, name, updatedAt: new Date().toISOString() });
}

export function prepareSetlistName(requestedName) {
  const name = typeof requestedName === 'string' ? requestedName.trim() : '';
  if (name.length === 0) {
    return { error: 'A set list needs a name' };
  }
  if (name.length > MAX_SETLIST_NAME_LENGTH) {
    return { error: `A set list name can be at most ${MAX_SETLIST_NAME_LENGTH} characters` };
  }
  return { name };
}

export function prepareSongIdsForCreate(requestedIds, validIds) {
  const songIds = filterValidSongIds(requestedIds, validIds);
  if (songIds.length === 0) {
    return { error: 'A set list needs at least one song' };
  }
  if (songIds.length > MAX_SETLIST_SIZE) {
    return { error: `A set list can hold at most ${MAX_SETLIST_SIZE} songs` };
  }
  return { songIds };
}

export function prepareSongIdsForUpdate(requestedIds, validIds) {
  const songIds = filterValidSongIds(requestedIds, validIds);
  if (songIds.length > MAX_SETLIST_SIZE) {
    return { error: `A set list can hold at most ${MAX_SETLIST_SIZE} songs` };
  }
  return { songIds };
}

export function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
