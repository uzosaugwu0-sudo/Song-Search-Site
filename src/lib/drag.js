// Framework-free drag-and-drop built on Pointer Events, so mouse and touch
// are the same code path. A drop target is any element the caller marks
// with a `data-drop-zone="<id>"` attribute; this module finds the nearest
// one under the pointer on every move via document.elementFromPoint +
// closest('[data-drop-zone]').
//
// makeDraggable(sourceEl, { onDrop, dragThreshold = 6 })
//   onDrop(zoneId): called once, when the pointer is released over a valid
//     drop zone. Not called if released outside every zone — nothing is
//     mutated in that case, so there is nothing for the caller to undo.
//   dragThreshold: pixels of movement before a drag is recognized, so a
//     plain tap/click on sourceEl still reaches its own click handler.
//
// While a drag is in progress: sourceEl gets a `dragging` class; whichever
// zone is currently under the pointer gets a `drag-over` class (moved off
// the previous zone as the pointer moves). Both classes are the caller's
// hook for visual feedback via CSS — this module sets no inline styles.
export function makeDraggable(sourceEl, { onDrop, dragThreshold = 6 } = {}) {
  let startX = 0;
  let startY = 0;
  let dragging = false;
  let currentZone = null;

  sourceEl.addEventListener('pointerdown', (event) => {
    startX = event.clientX;
    startY = event.clientY;
    dragging = false;
    currentZone = null;
    sourceEl.setPointerCapture(event.pointerId);
  });

  sourceEl.addEventListener('pointermove', (event) => {
    if (!sourceEl.hasPointerCapture?.(event.pointerId)) return;
    if (!dragging) {
      const dx = event.clientX - startX;
      const dy = event.clientY - startY;
      if (Math.hypot(dx, dy) < dragThreshold) return;
      dragging = true;
      sourceEl.classList.add('dragging');
    }
    const zone = document.elementFromPoint(event.clientX, event.clientY)?.closest('[data-drop-zone]') ?? null;
    if (zone !== currentZone) {
      currentZone?.classList.remove('drag-over');
      zone?.classList.add('drag-over');
      currentZone = zone;
    }
  });

  sourceEl.addEventListener('pointerup', (event) => {
    if (dragging && currentZone) onDrop(currentZone.dataset.dropZone);
    sourceEl.releasePointerCapture?.(event.pointerId);
    sourceEl.classList.remove('dragging');
    currentZone?.classList.remove('drag-over');
    dragging = false;
    currentZone = null;
  });
}
