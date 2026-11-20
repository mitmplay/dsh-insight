/**
 * stick-to-bottom — the reusable follow-the-live-end behavior for ANY
 * scrollable element (extracted 2026-08-26 from ConversationScrollArea's
 * inline scroll-stick block, whose semantics are preserved exactly):
 *
 *   - content grows while the reader sits at the bottom → the element
 *     stays glued to the live end
 *   - the reader scrolls away → the pin releases (growth never yanks)
 *   - the reader returns to the bottom → the pin re-engages
 *   - a manual engage (a toggle) JUMPS to the bottom — the control never
 *     lies about what "follow" means
 *
 * How it watches for growth: a MutationObserver on the element's
 * subtree (childList + characterData). That is what makes it generic —
 * the transcript needed its caller to re-run an effect on every entries
 * mutation; any element whose CONTENT changes in the DOM (streaming
 * markdown, appended rows, growing text) just works, no data props.
 *
 * Second consumer (the extraction's trigger): the think popup — a
 * streaming reasoning body whose popup scrolls; opening it mid-stream
 * lands on the live tail, scrolling up releases, returning re-engages.
 *
 * Svelte 5 runes module: create() in a component's script (or another
 * runes file), read `.stick` reactively, attach via attachTo in a
 * $effect, flip via setStick from a toggle (StickToBottomToggle's
 * contract).
 */

import { untrack } from 'svelte';

export interface StickToBottomOptions {
	/** Near-bottom distance in px. Default 48 (the transcript's
	 *  historical NEAR_BOTTOM_PX). Smaller boxes may tighten it. */
	thresholdPx?: number;
	/** Scroll-driven flips reported upward — a host that mirrors the
	 *  state into a bindable prop (ConversationScrollArea's stick)
	 *  bridges here. */
	onstickchange?: (next: boolean) => void;
}

/** Per-attach tuning (the element is known by then). */
export interface StickToBottomAttachOptions {
	/** Jump to the bottom right after attaching. Default false — the
	 *  think popup sets it to `streaming` so opening a FINISHED think
	 *  starts at the top (read from the beginning) while opening a
	 *  LIVE one lands on the tail. */
	jumpToBottom?: boolean;
	/** Stick state at attach. Default true (fresh engage — each open
	 *  of a popup is a new session). Pass false to start released. */
	stick?: boolean;
}

export interface StickToBottom {
	/** Live pin state — reactive (read in templates/deriveds). */
	readonly stick: boolean;
	/**
	 * Attach to a scrollable element; returns the detach cleanup (a
	 * $effect may return it directly). Re-attaching to a new element
	 * detaches the previous one first.
	 */
	attachTo(el: HTMLElement, options?: StickToBottomAttachOptions): () => void;
	/** Manual flip (toggle verb): engaging jumps so the button never
	 *  lies; releasing just stops following. */
	setStick(next: boolean): void;
}

export function createStickToBottom(options: StickToBottomOptions = {}): StickToBottom {
	const thresholdPx = options.thresholdPx ?? 48;

	// Runes state in a .svelte.ts module — reactive for every consumer.
	let stuck = $state(true);

	let node: HTMLElement | null = null;
	let observer: MutationObserver | null = null;
	let detachCurrent: (() => void) | null = null;

	function atBottom(el: HTMLElement): boolean {
		return el.scrollTop + el.clientHeight >= el.scrollHeight - thresholdPx;
	}

	function scrollToBottom(): void {
		if (node) node.scrollTop = node.scrollHeight;
	}

	/** Scroll events keep the pin honest BOTH ways: leaving the bottom
	 *  releases it, arriving re-engages it. Programmatic jumps land at
	 *  the bottom, so they self-verify as stuck — no special-casing. */
	let lastTop = 0;

	function handleScroll(): void {
		if (!node) return;
		const goingDown = node.scrollTop > lastTop;
		lastTop = node.scrollTop;
		const next = atBottom(node);
		// Re-engage ONLY on downward travel: an upward wheel tick landing
		// inside the threshold zone must not re-arm the pin that the
		// wheel release just dropped (2026-11-21 — the zone kept
		// re-engaging under small-delta gestures).
		if (next && !stuck && goingDown) {
			stuck = true;
			options.onstickchange?.(stuck);
		} else if (!next && stuck) {
			stuck = false;
			options.onstickchange?.(stuck);
		}
	}

	function attachTo(el: HTMLElement, attach: StickToBottomAttachOptions = {}): () => void {
		// untrack is LOAD-BEARING: attachTo reads `stuck` (the jump guard)
		// and element geometry — without untrack those reads subscribe the
		// CALLER's $effect to this state, so every scroll-driven flip
		// re-runs the attach (resetting stuck to engaged and jumping) in
		// an infinite ping-pong. Attaching is a one-shot side effect; its
		// decisions are snapshots, never dependencies.
		return untrack(() => {
			detachCurrent?.();
			node = el;
			lastTop = el.scrollTop;
			stuck = attach.stick ?? true;
			el.addEventListener('scroll', handleScroll, { passive: true });
			// Wheel-up intent releases the pin IMMEDIATELY (2026-11-21): the
			// scroll-event path needs the viewport >thresholdPx from the bottom
			// to release, but a real wheel/trackpad gesture arrives as a stream
			// of small deltas — under streaming mutations each delta was yanked
			// back to the bottom before any scroll event cleared the threshold,
			// making scroll-up impossible while content grew. Upward wheel
			// intent is deterministic; the scroll path still re-engages at the
			// bottom. Keyboard/scrollbar scrolling keeps the distance semantics.
			// childList covers appended rows / re-rendered markdown nodes;
			// characterData covers in-place streaming text deltas.
			observer = new MutationObserver(() => {
				if (stuck) scrollToBottom();
			});
			observer.observe(el, { childList: true, subtree: true, characterData: true });
			if (attach.jumpToBottom && stuck) scrollToBottom();
			const releaseOnWheel = (e: WheelEvent): void => {
				if (e.deltaY < 0 && stuck) {
					stuck = false;
					lastTop = el.scrollTop; // keep the travel ledger honest for handleScroll
					options.onstickchange?.(stuck);
				}
			};
			el.addEventListener('wheel', releaseOnWheel, { passive: true });
			const cleanup = () => {
				el.removeEventListener('scroll', handleScroll);
				el.removeEventListener('wheel', releaseOnWheel);
				observer?.disconnect();
				observer = null;
				if (node === el) node = null;
				// A stale cleanup (a host kept it past a re-attach) must not
				// unset the CURRENT registration.
				if (detachCurrent === cleanup) detachCurrent = null;
			};
			detachCurrent = cleanup;
			return cleanup;
		});
	}

	function setStick(next: boolean): void {
		if (next === stuck) return;
		stuck = next;
		if (next) scrollToBottom();
		options.onstickchange?.(stuck);
	}

	return {
		get stick() {
			return stuck;
		},
		attachTo,
		setStick
	};
}
