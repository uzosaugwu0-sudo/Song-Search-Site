import { normalizeTitle } from './normalize.js';

function levenshtein(a, b) {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const dist = Array.from({ length: rows }, (_, i) => [i, ...Array(cols - 1).fill(0)]);
  for (let j = 0; j < cols; j++) dist[0][j] = j;
  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dist[i][j] = Math.min(
        dist[i - 1][j] + 1,
        dist[i][j - 1] + 1,
        dist[i - 1][j - 1] + cost,
      );
    }
  }
  return dist[rows - 1][cols - 1];
}

function fuzzyThreshold(len) {
  if (len <= 4) return 1;
  if (len <= 8) return 2;
  return Math.floor(len * 0.3);
}

export function fuzzyTitleMatches(songs, query) {
  const nq = normalizeTitle(query);
  if (nq.length < 3) return [];
  const singleWord = !nq.includes(' ');
  const scored = [];
  for (const song of songs) {
    const nt = normalizeTitle(song.title);
    let best = levenshtein(nq, nt);
    if (singleWord) {
      for (const word of nt.split(' ')) {
        const d = levenshtein(nq, word);
        if (d < best) best = d;
      }
    }
    if (best <= fuzzyThreshold(Math.min(nq.length, nt.length))) {
      scored.push({ song, dist: best });
    }
  }
  scored.sort((a, b) => a.dist - b.dist);
  return scored.slice(0, 8).map((s) => s.song);
}

export function snippetParts(lyrics, q) {
  const idx = lyrics.toLowerCase().indexOf(q);
  if (idx === -1) return null;
  const start = Math.max(0, idx - 30);
  const end = Math.min(lyrics.length, idx + q.length + 50);
  return {
    before: (start > 0 ? '…' : '') + lyrics.slice(start, idx).replace(/\s+/g, ' '),
    match: lyrics.slice(idx, idx + q.length),
    after: lyrics.slice(idx + q.length, end).replace(/\s+/g, ' ') + (end < lyrics.length ? '…' : ''),
  };
}

// The real site-wide search: title/lyrics substring match first, falling
// back to a fuzzy title match when nothing matches exactly.
export function searchSongs(songs, query) {
  const q = query.toLowerCase();
  const matches = songs.filter((song) => song.title.toLowerCase().includes(q) || song.lyrics.toLowerCase().includes(q));
  if (matches.length > 0) {
    return matches.map((song) => ({ song, snippet: snippetParts(song.lyrics, q) }));
  }
  return fuzzyTitleMatches(songs, query).map((song) => ({ song, snippet: null }));
}
