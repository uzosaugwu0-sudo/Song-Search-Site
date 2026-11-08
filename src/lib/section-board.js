// The shared search box + draggable results + section drop-zones + Unsorted
// bucket, mounted by both the list-creation flow and an existing list's own
// page. UI glue; no automated test (see the plan's Global Constraints).
import { searchSongs } from './song-search.js';
import { makeDraggable } from './drag.js';
import { placeInSection, moveToAdjacentSection, groupBySection } from './sections.js';

// renderZones: false lets a page that already renders its own section/song
// rows (set/[id].astro, which carries its own Rename/Remove controls the
// board doesn't know about) reuse just the search box and draggable results,
// while still computing an up-to-date zoneMap each rerender() so drops onto
// that page's own data-drop-zone elements (using the same 'unsorted'/
// 'zone-<i>' scheme) resolve correctly.
export function mountSectionBoard(container, { songs, getItems, onChange, renderZones = true }) {
  container.replaceChildren();

  const searchInput = document.createElement('input');
  searchInput.type = 'search';
  searchInput.className = 'input';
  searchInput.placeholder = 'Search by title or lyrics...';
  container.appendChild(searchInput);

  const resultsList = document.createElement('ul');
  resultsList.className = 'section-board-results';
  container.appendChild(resultsList);

  const boardList = document.createElement('ul');
  boardList.className = 'section-board-zones';
  if (renderZones) container.appendChild(boardList);

  // zone id ("unsorted" / "zone-<i>") -> the real heading reference (or null
  // for Unsorted) for the CURRENT render, so a drop can resolve back to the
  // exact object placeInSection needs. Rebuilt at the top of every rerender().
  let zoneMap = new Map();

  function songById(id) {
    return songs.find((s) => s.id === id);
  }

  function buildSongRow(songId, groupIndex, groups) {
    const song = songById(songId);
    if (!song) return null;

    const li = document.createElement('li');
    li.className = 'row';

    const link = document.createElement('a');
    link.className = 'row-title';
    link.href = `/song/${song.slug}/`;
    // New tab: on the creation screen the list is only in memory until Create
    // is pressed, so navigating away in the same tab would lose it.
    link.target = '_blank';
    link.rel = 'noopener';
    link.textContent = song.title;
    li.appendChild(link);

    const controls = document.createElement('span');
    controls.className = 'row-controls';

    const upBtn = document.createElement('button');
    upBtn.type = 'button';
    upBtn.className = 'btn btn-sm';
    upBtn.textContent = '↑';
    upBtn.disabled = groupIndex - 1 < 0;
    upBtn.addEventListener('click', () => onChange(moveToAdjacentSection(getItems(), songId, -1)));
    controls.appendChild(upBtn);

    const downBtn = document.createElement('button');
    downBtn.type = 'button';
    downBtn.className = 'btn btn-sm';
    downBtn.textContent = '↓';
    downBtn.disabled = groupIndex + 1 >= groups.length;
    downBtn.addEventListener('click', () => onChange(moveToAdjacentSection(getItems(), songId, 1)));
    controls.appendChild(downBtn);

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'btn btn-sm btn-danger';
    removeBtn.textContent = 'Remove';
    removeBtn.addEventListener('click', () => onChange(getItems().filter((item) => item !== songId)));
    controls.appendChild(removeBtn);

    li.appendChild(controls);

    makeDraggable(li, {
      onDrop: (zoneId) => onChange(placeInSection(getItems(), songId, zoneMap.get(zoneId))),
    });

    return li;
  }

  function buildZone(group, index, groups) {
    const zoneId = group.heading === null ? 'unsorted' : `zone-${index}`;
    zoneMap.set(zoneId, group.heading);

    const li = document.createElement('li');
    li.className = 'section-board-zone';
    li.dataset.dropZone = zoneId;

    const label = document.createElement('div');
    label.className = 'section-label';
    label.textContent = group.heading === null ? 'Unsorted' : group.heading.section;
    li.appendChild(label);

    const songsList = document.createElement('ul');
    songsList.className = 'section-board-zone-songs';
    group.entries.forEach(({ item }) => {
      const row = buildSongRow(item, index, groups);
      if (row) songsList.appendChild(row);
    });
    li.appendChild(songsList);

    return li;
  }

  function renderResults(query) {
    resultsList.replaceChildren();
    if (!query) return;
    const items = getItems();
    // Capped the same way the old minimal add-a-song box was: this is a
    // small, space-constrained list, not a full search page, and an
    // unbounded list of full-width buttons pushes the drop zones (and any
    // actual drag target) off screen.
    const results = searchSongs(songs, query).filter(({ song }) => !items.includes(song.id)).slice(0, 8);
    for (const { song, snippet } of results) {
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn section-board-result';
      btn.textContent = snippet ? `${song.title} — ${snippet.before}${snippet.match}${snippet.after}` : song.title;
      btn.addEventListener('click', () => {
        onChange(placeInSection(getItems(), song.id, null));
      });
      makeDraggable(btn, {
        onDrop: (zoneId) => onChange(placeInSection(getItems(), song.id, zoneMap.get(zoneId))),
      });
      li.appendChild(btn);
      resultsList.appendChild(li);
    }
  }

  searchInput.addEventListener('input', (e) => renderResults(e.target.value.trim()));

  function rerender() {
    zoneMap = new Map();
    const groups = groupBySection(getItems());
    if (renderZones) {
      boardList.replaceChildren();
      groups.forEach((group, index) => boardList.appendChild(buildZone(group, index, groups)));
    } else {
      // Not rendering our own zones, but still need zoneId -> heading for
      // drops onto the caller's own elements using the same id scheme.
      groups.forEach((group, index) => zoneMap.set(group.heading === null ? 'unsorted' : `zone-${index}`, group.heading));
    }
    renderResults(searchInput.value.trim());
  }

  rerender();
  return { rerender };
}
