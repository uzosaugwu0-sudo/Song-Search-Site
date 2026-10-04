const RECENT_KEY = 'songSearchRecent';
const VIEWS_KEY = 'songSearchViews';

export const RECENT_LIMIT = 20;
export const RECENT_RESET_AFTER_VIEWS = 50;

export function nextRecentState({ recent, views }, songId) {
  if (views >= RECENT_RESET_AFTER_VIEWS) return { recent: [songId], views: 1 };
  return {
    recent: [songId, ...recent.filter((id) => id !== songId)].slice(0, RECENT_LIMIT),
    views: views + 1,
  };
}

function readRecent(storage) {
  try {
    const parsed = JSON.parse(storage.getItem(RECENT_KEY) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function readViews(storage) {
  return parseInt(storage.getItem(VIEWS_KEY) || '0', 10) || 0;
}

export function recordView(songId, storage = localStorage) {
  try {
    const next = nextRecentState({ recent: readRecent(storage), views: readViews(storage) }, songId);
    storage.setItem(RECENT_KEY, JSON.stringify(next.recent));
    storage.setItem(VIEWS_KEY, String(next.views));
  } catch {}
}
