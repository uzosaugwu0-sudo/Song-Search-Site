import { isHeading, countSongs, MAX_SETLIST_SECTIONS, MAX_SECTION_NAME_LENGTH } from './sections.js';

export const MAX_SETLIST_SIZE = 50;
export const MAX_SETLIST_NAME_LENGTH = 100;

export function filterValidItems(items, validIds) {
  if (!Array.isArray(items)) return [];
  const seen = new Set();
  const result = [];
  for (const item of items) {
    if (isHeading(item)) {
      const section = item.section.trim();
      if (section.length > 0 && section.length <= MAX_SECTION_NAME_LENGTH) result.push({ section });
    } else if (typeof item === 'string' && validIds.has(item) && !seen.has(item)) {
      seen.add(item);
      result.push(item);
    }
  }
  return result;
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

export function buildSetlistValue(songIds, name, createdAt, updatedAt = new Date().toISOString()) {
  return JSON.stringify({ songIds, name, createdAt: createdAt ?? updatedAt, updatedAt });
}

export const SOFT_DELETE_TTL_SECONDS = 30 * 24 * 60 * 60;

export function buildSetlistMetadata(songIds, name, createdAt, updatedAt) {
  return { name, count: countSongs(songIds), createdAt, updatedAt };
}

// Writes the list plus the summary the public listing reads from kv.list().
// Pass createdAt (and updatedAt, to keep it unchanged) when rewriting an existing list.
export async function putSetlist(kv, id, songIds, name, { createdAt, updatedAt } = {}) {
  const value = buildSetlistValue(songIds, name, createdAt, updatedAt);
  const saved = JSON.parse(value);
  await kv.put(id, value, {
    metadata: buildSetlistMetadata(songIds, name, saved.createdAt, saved.updatedAt),
  });
  return value;
}

// Only lists saved before metadata existed need rewriting. Lists that merely lack
// createdAt already show their updatedAt as the date, and rewriting them from a
// possibly stale read could overwrite a fresh edit.
export function needsBackfill(key) {
  return !key.metadata;
}

// Returns the parsed list, or null if it doesn't exist or was soft-deleted.
export function parseLiveSetlist(raw) {
  if (raw === null) return null;
  const data = JSON.parse(raw);
  return data.deleted ? null : data;
}

export function markDeleted(raw) {
  return JSON.stringify({ ...JSON.parse(raw), deleted: true });
}

export function toListEntries(keys) {
  return keys
    .filter((k) => k.metadata && !k.metadata.deleted)
    .map((k) => ({ id: k.name, ...k.metadata, createdAt: k.metadata.createdAt ?? k.metadata.updatedAt }))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

// e.g. "Oct 12, 2026", in the viewer's timezone. Empty string if the input isn't a date.
export function formatListDate(iso) {
  const date = new Date(iso);
  if (!iso || Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

function localDayKey(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// Groups list entries by the local calendar day they were created: newest day first,
// newest list first within a day. Entries without a usable createdAt are skipped.
export function groupListsByDay(entries, now = new Date()) {
  const todayKey = localDayKey(now);
  const groups = new Map();
  for (const entry of entries) {
    const date = new Date(entry.createdAt);
    if (Number.isNaN(date.getTime())) continue;
    const key = localDayKey(date);
    if (!groups.has(key)) groups.set(key, { key, label: formatListDate(entry.createdAt), isToday: key === todayKey, lists: [] });
    groups.get(key).lists.push(entry);
  }
  return [...groups.values()]
    .sort((a, b) => b.key.localeCompare(a.key))
    .map((group) => ({ ...group, lists: group.lists.sort((a, b) => b.createdAt.localeCompare(a.createdAt)) }));
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

function checkItems(requested, validIds) {
  if (Array.isArray(requested)) {
    const badHeading = requested.find((item) => {
      if (!isHeading(item)) return false;
      const length = item.section.trim().length;
      return length < 1 || length > MAX_SECTION_NAME_LENGTH;
    });
    if (badHeading) {
      return { error: `A section name must be 1-${MAX_SECTION_NAME_LENGTH} characters` };
    }
  }
  const items = filterValidItems(requested, validIds);
  const songCount = countSongs(items);
  if (songCount > MAX_SETLIST_SIZE) {
    return { error: `A set list can hold at most ${MAX_SETLIST_SIZE} songs` };
  }
  if (items.length - songCount > MAX_SETLIST_SECTIONS) {
    return { error: `A set list can have at most ${MAX_SETLIST_SECTIONS} sections` };
  }
  return { items };
}

export function prepareSongIdsForCreate(requestedIds, validIds) {
  const result = checkItems(requestedIds, validIds);
  if (result.error) return result;
  if (countSongs(result.items) === 0) {
    return { error: 'A set list needs at least one song' };
  }
  return { songIds: result.items };
}

export function prepareSongIdsForUpdate(requestedIds, validIds) {
  const result = checkItems(requestedIds, validIds);
  if (result.error) return result;
  return { songIds: result.items };
}

export function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
