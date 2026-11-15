export function createGutterResize(handlers) {
    let armed = false;
    let snapshot = 0;
    let lastWidth = 0;
    function onMove(e) {
        if (!armed)
            return;
        lastWidth = handlers.clamp(snapshot + (e.clientX - lastStartX));
        handlers.onResize(lastWidth, e);
    }
    function onUp(e) {
        if (!armed)
            return;
        armed = false;
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        handlers.onSettle?.(lastWidth);
    }
    let lastStartX = 0;
    return {
        start(e) {
            const snap = handlers.onStart(e);
            if (snap === null)
                return;
            snapshot = snap;
            lastStartX = e.clientX;
            lastWidth = handlers.clamp(snap);
            armed = true;
            window.addEventListener('mousemove', onMove);
            window.addEventListener('mouseup', onUp);
        },
        get active() {
            return armed;
        },
        destroy() {
            armed = false;
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
        }
    };
}
