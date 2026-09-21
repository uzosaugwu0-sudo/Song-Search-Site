export function slugify(title) {
  return title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function assignSlugs(songs) {
  const baseCounts = new Map();
  for (const song of songs) {
    const base = slugify(song.title) || 'song';
    baseCounts.set(base, (baseCounts.get(base) ?? 0) + 1);
  }

  return songs.map((song) => {
    const base = slugify(song.title) || 'song';
    const idPart = slugify(String(song.id)) || 'id';
    const slug = baseCounts.get(base) > 1 ? `${base}-${idPart}` : base;
    return { ...song, slug };
  });
}
