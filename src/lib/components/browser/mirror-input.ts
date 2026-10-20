/**
 * mirror-input — the glass's pure input math (The Glass Browser spec W2,
 * task 2.1; ADR-0029 D6). Extracted from BrowserPanel so the scale and the
 * rAF coalescing are unit-testable without a DOM.
 */

/** Displayed ÷ viewport — the raw D6 scale factor. */
export function scaleFor(displayedWidth: number, viewportWidth: number): number | null {
	if (displayedWidth <= 0 || viewportWidth <= 0) return null;
	return displayedWidth / viewportWidth;
}

/** The on-screen rect of the PAGE image inside its wrapper. The frame is
 *  drawn aspect-true (canvas object-contain): when the frame is wider or
 *  taller than the panel the image LETTERBOXES — clicks must map against
 *  this contained rect, not the wrapper (bug 2026-10-19: width-only
 *  scaling zoomed the cursor whenever the frame aspect ≠ panel aspect). */
export function containedRect(
	boundsLeft: number,
	boundsTop: number,
	boundsWidth: number,
	boundsHeight: number,
	viewportWidth: number,
	viewportHeight: number
): { left: number; top: number; width: number; height: number; scale: number } | null {
	if (boundsWidth <= 0 || boundsHeight <= 0 || viewportWidth <= 0 || viewportHeight <= 0) return null;
	const scale = Math.min(boundsWidth / viewportWidth, boundsHeight / viewportHeight);
	const width = viewportWidth * scale;
	const height = viewportHeight * scale;
	return {
		left: boundsLeft + (boundsWidth - width) / 2,
		top: boundsTop + (boundsHeight - height) / 2,
		width,
		height,
		scale
	};
}

/** Map a click on the GLASS to viewport CSS pixels. Coordinates outside the
 *  contained image return null — the panel must not dispatch clicks that
 *  land on letterbox bars (they would miss the page). */
export function scalePoint(
	clientX: number,
	clientY: number,
	boundsLeft: number,
	boundsTop: number,
	boundsWidth: number,
	boundsHeight: number,
	viewportWidth: number,
	viewportHeight: number
): { x: number; y: number } | null {
	const rect = containedRect(boundsLeft, boundsTop, boundsWidth, boundsHeight, viewportWidth, viewportHeight);
	if (rect === null) return null;
	if (clientX < rect.left || clientX > rect.left + rect.width) return null;
	if (clientY < rect.top || clientY > rect.top + rect.height) return null;
	return {
		x: Math.round((clientX - rect.left) / rect.scale),
		y: Math.round((clientY - rect.top) / rect.scale)
	};
}

export interface MoveCoalescer {
	push(x: number, y: number): void;
}

/** At most ONE mouseMoved dispatch per animation frame — the flood guard.
 *  The LAST move in a frame wins (the pointer's true position). */
export function createMoveCoalescer(
	raf: (cb: () => void) => number,
	fire: (x: number, y: number) => void
): MoveCoalescer {
	let pending: { x: number; y: number } | null = null;
	let scheduled = false;
	return {
		push(x, y) {
			pending = { x, y };
			if (scheduled) return;
			scheduled = true;
			raf(() => {
				scheduled = false;
				const m = pending;
				pending = null;
				if (m) fire(m.x, m.y);
			});
		}
	};
}