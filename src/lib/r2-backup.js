export function formatBackupTimestamp(date = new Date()) {
  return date.toISOString().slice(0, 19).replace(/:/g, '-');
}

export function backupPrefix(timestamp) {
  return `backups/${timestamp}/`;
}

export function backupTimestampsFromListing(objectKeys) {
  const timestamps = new Set();
  for (const key of objectKeys) {
    const match = key.match(/^backups\/([^/]+)\//);
    if (match) timestamps.add(match[1]);
  }
  return [...timestamps].sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
}

export function formatBackupLabel(timestamp) {
  const [datePart, timePart] = timestamp.split('T');
  return `${datePart} ${timePart.replace(/-/g, ':')}`;
}

export async function backupCurrentPair(r2, now = new Date()) {
  const songs = await r2.get('current/Songs.db');
  const words = await r2.get('current/SongWords.db');
  if (!songs || !words) return null;

  const timestamp = formatBackupTimestamp(now);
  const prefix = backupPrefix(timestamp);
  await r2.put(`${prefix}Songs.db`, await songs.arrayBuffer());
  await r2.put(`${prefix}SongWords.db`, await words.arrayBuffer());
  return timestamp;
}

const BACKUP_TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}$/;

// Guards backupPrefix() against being fed anything but the expected timestamp shape.
export function isValidBackupTimestamp(timestamp) {
  return typeof timestamp === 'string' && BACKUP_TIMESTAMP_RE.test(timestamp);
}
