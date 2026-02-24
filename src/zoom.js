/**
 * makeZoomable(img, overlay)
 * Adds scroll/pinch zoom + drag/swipe pan to an <img> inside a fullscreen overlay.
 * Returns a cleanup() function that removes all listeners and resets the state.
 */
export function makeZoomable(img, overlay) {
    const MIN = 1, MAX = 5;
    let scale = 1, tx = 0, ty = 0;
    let dragging = false, lastX = 0, lastY = 0;
    let lastPinchDist = 0;
    let tapTimer = null, lastTap = 0;

    function apply() {
        img.style.transform = `scale(${scale}) translate(${tx}px, ${ty}px)`;
        img.style.cursor = scale > 1 ? (dragging ? 'grabbing' : 'grab') : 'zoom-in';
    }

    function reset() {
        scale = 1; tx = 0; ty = 0;
        apply();
    }

    /* ── Wheel (desktop zoom) ── */
    function onWheel(e) {
        e.preventDefault();
        e.stopPropagation();
        const factor = e.deltaY < 0 ? 1.12 : 0.88;
        scale = Math.min(MAX, Math.max(MIN, scale * factor));
        apply();
    }

    /* ── Double click → reset ── */
    function onDblClick(e) {
        e.stopPropagation();
        if (scale > 1) reset();
        else { scale = 2; apply(); }
    }

    /* ── Mouse drag ── */
    function onMouseDown(e) {
        if (scale <= 1) return;
        e.stopPropagation();
        dragging = true;
        lastX = e.clientX; lastY = e.clientY;
        apply();
    }
    function onMouseMove(e) {
        if (!dragging) return;
        tx += (e.clientX - lastX) / scale;
        ty += (e.clientY - lastY) / scale;
        lastX = e.clientX; lastY = e.clientY;
        apply();
    }
    function onMouseUp() { dragging = false; apply(); }

    /* ── Touch (pinch + pan) ── */
    function onTouchStart(e) {
        e.stopPropagation();
        if (e.touches.length === 2) {
            lastPinchDist = Math.hypot(
                e.touches[0].clientX - e.touches[1].clientX,
                e.touches[0].clientY - e.touches[1].clientY
            );
        } else if (e.touches.length === 1) {
            // Double-tap detection
            const now = Date.now();
            if (now - lastTap < 280) {
                e.preventDefault();
                if (scale > 1) reset();
                else { scale = 2.5; apply(); }
            }
            lastTap = now;
            if (scale > 1) {
                dragging = true;
                lastX = e.touches[0].clientX;
                lastY = e.touches[0].clientY;
            }
        }
    }
    function onTouchMove(e) {
        e.preventDefault();
        e.stopPropagation();
        if (e.touches.length === 2) {
            const dist = Math.hypot(
                e.touches[0].clientX - e.touches[1].clientX,
                e.touches[0].clientY - e.touches[1].clientY
            );
            const delta = dist / (lastPinchDist || dist);
            scale = Math.min(MAX, Math.max(MIN, scale * delta));
            lastPinchDist = dist;
            apply();
        } else if (e.touches.length === 1 && dragging) {
            tx += (e.touches[0].clientX - lastX) / scale;
            ty += (e.touches[0].clientY - lastY) / scale;
            lastX = e.touches[0].clientX;
            lastY = e.touches[0].clientY;
            apply();
        }
    }
    function onTouchEnd() { dragging = false; }

    /* ── Register listeners ── */
    img.addEventListener('wheel', onWheel, { passive: false });
    img.addEventListener('dblclick', onDblClick);
    img.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    img.addEventListener('touchstart', onTouchStart, { passive: false });
    img.addEventListener('touchmove', onTouchMove, { passive: false });
    img.addEventListener('touchend', onTouchEnd);

    // Block all pointer events from leaking through the overlay to the background
    function blockEvent(e) { e.stopPropagation(); }
    overlay.addEventListener('wheel', blockEvent, { passive: false });
    overlay.addEventListener('touchmove', blockEvent, { passive: false });
    overlay.addEventListener('touchstart', blockEvent, { passive: false });

    apply();

    /* ── Cleanup ── */
    function cleanup() {
        reset();
        img.removeEventListener('wheel', onWheel);
        img.removeEventListener('dblclick', onDblClick);
        img.removeEventListener('mousedown', onMouseDown);
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);
        img.removeEventListener('touchstart', onTouchStart);
        img.removeEventListener('touchmove', onTouchMove);
        img.removeEventListener('touchend', onTouchEnd);
        overlay.removeEventListener('wheel', blockEvent);
        overlay.removeEventListener('touchmove', blockEvent);
        overlay.removeEventListener('touchstart', blockEvent);
    }

    return cleanup;
}
