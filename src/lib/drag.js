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
  let pointerId = null;
  let dragging = false;
  let currentZone = null;

  // A link or button inside the row has its own default drag behaviour
  // (dragging a link starts the browser's own link-drag). Disable it on
  // every descendant so only this module's pointer-based drag can start.
  sourceEl.querySelectorAll('a, button').forEach((el) => { el.draggable = false; });

  function cleanup() {
    if (pointerId !== null) sourceEl.releasePointerCapture?.(pointerId);
    sourceEl.classList.remove('dragging');
    currentZone?.classList.remove('drag-over');
    dragging = false;
    currentZone = null;
    pointerId = null;
  }

  sourceEl.addEventListener('pointerdown', (event) => {
    startX = event.clientX;
    startY = event.clientY;
    pointerId = event.pointerId;
    dragging = false;
    currentZone = null;
    // Pointer capture is NOT taken here: capturing immediately would route
    // every later pointerup (and so every click) on a button or link inside
    // this row back to sourceEl instead, breaking those controls. It's
    // taken once the drag is actually recognized, in pointermove below.
  });

  sourceEl.addEventListener('pointermove', (event) => {
    if (event.pointerId !== pointerId) return;
    if (!dragging) {
      const dx = event.clientX - startX;
      const dy = event.clientY - startY;
      if (Math.hypot(dx, dy) < dragThreshold) return;
      dragging = true;
      sourceEl.classList.add('dragging');
      sourceEl.setPointerCapture(event.pointerId);
    }
    const zone = document.elementFromPoint(event.clientX, event.clientY)?.closest('[data-drop-zone]') ?? null;
    if (zone !== currentZone) {
      currentZone?.classList.remove('drag-over');
      zone?.classList.add('drag-over');
      currentZone = zone;
    }
  });

  sourceEl.addEventListener('pointerup', (event) => {
    if (event.pointerId !== pointerId) return;
    if (dragging && currentZone) onDrop(currentZone.dataset.dropZone);
    cleanup();
  });

  // The browser can cancel a pointer sequence mid-drag (a touch becomes a
  // scroll gesture, a link's own native drag takes over). Without this, the
  // row would be stuck at half-opacity with a zone stuck highlighted.
  sourceEl.addEventListener('pointercancel', (event) => {
    if (event.pointerId !== pointerId) return;
    cleanup();
  });
}
