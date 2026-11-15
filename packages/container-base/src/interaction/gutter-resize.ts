/**
 * Gutter resize — the SINGLE sidebar-style drag machine (SSC#2 extraction,
 * 2026-11-14): one width, snapshot on gutter mousedown, clamped delta per
 * window mousemove, settle on window mouseup. Both consumers DSI has run
 * byte-similar copies of this skeleton (route `startSidebarResize` +
 * playground page drag vars); this module is now its only home.
 *
 * The machine OWNS: the window-listener lifecycle (attached on a
 * successful start, released on settle), the delta arithmetic, the
 * candidate width (snapshot + delta), and the clamp pass. The host OWNS:
 * the bounds (clamp fn — DSI's are config-driven), the apply (write the
 * width wherever it lives), and the settle (persistence, afterglow).
 *
 * A mousedown that returns null from `onStart` arms nothing — a host with
 * collapsed/ignored states uses that instead of pre-gating the gutter.
 */
export interface GutterResizeMachine {
	/** Gutter mousedown — arms the machine and attaches the window
	 *  listeners when `onStart` returns a snapshot width (null = ignore). */
	start: (e: MouseEvent) => void;
	/** True while dragging (start succeeded, settle not yet fired). */
	readonly active: boolean;
	/** Release the window listeners without settling (page teardown). */
	destroy: () => void;
}

export function createGutterResize(handlers: {
	/** Gutter mousedown: return the SNAPSHOT width (the width the drag
	 *  moves away from), or null to ignore this gesture. */
	onStart: (e: MouseEvent) => number | null;
	/** The host's bounds — a pure width -> width clamp. */
	clamp: (width: number) => number;
	/** Apply the clamped width — called per window mousemove while armed. */
	onResize: (width: number, e: MouseEvent) => void;
	/** Settle on window mouseup: persist, arm afterglow, etc. The final
	 *  clamped width is the one the last resize produced. */
	onSettle?: (width: number) => void;
}): GutterResizeMachine {
	let armed = false;
	let snapshot = 0;
	let lastWidth = 0;

	function onMove(e: MouseEvent): void {
		if (!armed) return;
		lastWidth = handlers.clamp(snapshot + (e.clientX - lastStartX));
		handlers.onResize(lastWidth, e);
	}
	function onUp(e: MouseEvent): void {
		if (!armed) return;
		armed = false;
		window.removeEventListener('mousemove', onMove);
		window.removeEventListener('mouseup', onUp);
		handlers.onSettle?.(lastWidth);
	}
	let lastStartX = 0;
	return {
		start(e: MouseEvent): void {
			const snap = handlers.onStart(e);
			if (snap === null) return;
			snapshot = snap;
			lastStartX = e.clientX;
			lastWidth = handlers.clamp(snap);
			armed = true;
			window.addEventListener('mousemove', onMove);
			window.addEventListener('mouseup', onUp);
		},
		get active(): boolean {
			return armed;
		},
		destroy(): void {
			armed = false;
			window.removeEventListener('mousemove', onMove);
			window.removeEventListener('mouseup', onUp);
		}
	};
}
