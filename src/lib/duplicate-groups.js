import { normalizeTitle } from './normalize.js';

export function findDuplicateGroups(songs) {
  const groups = new Map();
  for (const song of songs) {
    const key = normalizeTitle(song.title);
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(song);
  }
  return [...groups.values()]
    .filter((group) => group.length > 1)
    .sort((a, b) => a[0].title.localeCompare(b[0].title));
}
