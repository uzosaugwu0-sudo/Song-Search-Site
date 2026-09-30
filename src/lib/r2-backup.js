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
