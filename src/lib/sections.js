// Pure helpers for service lists that contain section headings.
// A list is an ordered array of items: a song id string, or a heading { section }.
// No imports on purpose: this file is used by both the Worker and the browser.

export const MAX_SETLIST_SECTIONS = 10;
export const MAX_SECTION_NAME_LENGTH = 60;

export function isHeading(item) {
  return item !== null && typeof item === 'object' && typeof item.section === 'string';
}

export function countSongs(items) {
  return items.filter((item) => typeof item === 'string').length;
}

export function addHeading(items, name) {
  return [...items, { section: name }];
}

export function renameHeading(items, index, name) {
  return items.map((item, i) => (i === index && isHeading(item) ? { section: name } : item));
}

export function removeAt(items, index) {
  return items.filter((_, i) => i !== index);
}

export function moveItem(items, index, direction) {
  const target = index + direction;
  if (target < 0 || target >= items.length || index < 0 || index >= items.length) return [...items];
  const next = [...items];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

// Splits a list into display groups: songs before the first heading (heading: null),
// then one group per heading. Entries keep their index in the original array so
// index-based controls (move, remove, rename) keep working.
export function groupBySection(items) {
  const groups = [{ heading: null, headingIndex: -1, entries: [] }];
  items.forEach((item, index) => {
    if (isHeading(item)) groups.push({ heading: item, headingIndex: index, entries: [] });
    else groups[groups.length - 1].entries.push({ item, index });
  });
  return groups;
}

// Trims and length-caps a typed section name; null if cancelled (null) or empty.
export function cleanSectionName(answer) {
  const name = answer === null ? '' : answer.trim().slice(0, MAX_SECTION_NAME_LENGTH);
  return name || null;
}

// Counts the songs before the first heading — the standing "Unsorted" holding
// area a tapped (not dragged) search result lands in.
export function countUnsorted(items) {
  return groupBySection(items)[0].entries.length;
}

// Moves songId to the end of the section targetHeading identifies (null = the
// Unsorted bucket before the first heading). Removes any existing occurrence
// first, so this also handles moving an already-placed song between sections.
// Falls back to appending at the very end if targetHeading isn't found.
export function placeInSection(items, songId, targetHeading) {
  const filtered = items.filter((item) => item !== songId);
  const startIndex = targetHeading === null ? 0 : filtered.indexOf(targetHeading);
  if (startIndex === -1) return [...filtered, songId];
  let insertAt = filtered.length;
  for (let i = startIndex + 1; i < filtered.length; i++) {
    if (isHeading(filtered[i])) { insertAt = i; break; }
  }
  const next = [...filtered];
  next.splice(insertAt, 0, songId);
  return next;
}

// Moves songId into the section immediately before/after the one it's
// currently in, landing at the end of that section's songs. No-op (a plain
// copy) if there's no section in that direction.
export function moveToAdjacentSection(items, songId, direction) {
  const groups = groupBySection(items);
  const groupIndex = groups.findIndex((g) => g.entries.some((e) => e.item === songId));
  const target = groups[groupIndex + direction];
  if (groupIndex === -1 || !target) return [...items];
  return placeInSection(items, songId, target.heading);
}
