export async function loadSongs(kv) {
  const raw = await kv.get('songs');
  if (raw === null) return [];
  return JSON.parse(raw);
}
