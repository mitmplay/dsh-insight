<!--
	BrowserPanel — the glass (The Glass Browser spec Wave 2, task 2.1;
	ADR-0029 D1/D3/D6/D8). A dumb canvas over the session's CDP screencast:
	frames arrive on SSE (/api/browser/[id]/stream), operator input is
	scaled (displayed ÷ viewport, D6), coalesced per animation frame, and
	POSTed to /api/browser/[id]/input. panel-close is the OWNER-RELEASE
	(D8): it POSTs /api/browser/[id]/close — killing the browser — then
	reports upward so the floor removes the panel. Terminal-transport
	parody by design (EventSource + POST, the Terminal KB shape).
-->
<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { t } from '$lib/services/locale/locale-state.svelte';
	import * as m from '$lib/paraglide/messages';
	import { harnessSessionKey, persistId } from '$lib/services/panels/browser-session-resolver.js';
	import BrowserHeader from './BrowserHeader.svelte';
	import BrowserContent from './BrowserContent.svelte';
	import BrowserTab from './BrowserTab.svelte';
	import BrowserNew from './buttons/BrowserNew.svelte';
	import BrowserProvenance from './BrowserProvenance.svelte';
	import { createMoveCoalescer, scalePoint } from './mirror-input.ts';
	// glass-tab-ids Task 4: the omnibox speaks the SAME grammar as the wire
	// door — one parser, two doors (src/lib/browser/tab-grammar.ts).
	import { parseTabCommand } from '$lib/browser/tab-grammar.js';
	import { pagePrefs } from '$lib/services/workspace/page-prefs.svelte';

	let {
		/** The browser-session registry id; undefined = this panel OPENS the
		 *  session on mount (the singleton panel's cold shape). */
		browserSessionId = undefined,
		/** Fold callback (ADR-0037 D1): the header ✕ — removePanel only. */
		onclose,
		/** The death notice (Glass Close Ladder ADR 2026-10-24 D4): a touch
		 *  answered 409 CLOSED — the session is gone. The panel never kills
		 *  and never prunes; it only reports so the route can prune. */
		onclosed,
		/** Test seam: base URL for the API (e2e runs same-origin; default ''). */
		apiBase = '',
		/** Provenance (ADR-0036 D3): the opener session's id, its live spine
		 *  title, and the opener's lineage depth — the lineage chip's facts.
		 *  openedBy absent (ControlBar open) means NO chip, honestly. */
		openedBy = undefined,
		parentTitle = null,
		depth = 0,
		onsession,
	}: {
		browserSessionId?: string | undefined;
		onclose?: () => void;
		onclosed?: () => void;
		apiBase?: string;
		openedBy?: string | undefined;
		parentTitle?: string | null;
		depth?: number;
		onsession?: (id: string) => void;
	} = $props();

	let sessionId = $state<string | null>(null);
	/** True when mount re-bound to a surviving session (ADR-0030 D1) —
	 *  surfaced in the status strip for the operator. */
	let reBound = $state(false);
	let status = $state<'opening' | 'connecting' | 'live' | 'failed' | 'closed'>('opening');
	let failReason = $state<string | null>(null);
	let canvas: HTMLCanvasElement | null = $state(null);
	let wrap: HTMLDivElement | null = $state(null);
	/** Viewport size from the latest frame metadata — the scale DIVISOR (D6). */
	let viewport = $state<{ w: number; h: number }>({ w: 0, h: 0 });
	let closing = $state(false);
	/** Proxy verbs (ADR-0031 D1/D2): the panel ACTS on the header's
	 *  intent — one in-flight guard for the whole proxy row, history
	 *  bounds from the last navigate answer (the documented give-up). */
	let proxyBusy = $state(false);
	let canBack = $state(false);
	let canForward = $state(false);
	let header: { clearInput(): void; setOmniboxValue(v: string): void } | null = $state(null);
	const SEARCH_URL = 'https://www.google.com/search?q=';
	/** glass-tab-ids Task 4: the focused tab's URL IS the omnibox hint, but
	 *  a 2000-char SPA URL would eat the strip — truncate the hint at 64. */
	const OMNIBOX_PLACEHOLDER_MAX = 64;
	/** The omnibox placeholder: the ACTIVE tab's URL (64-char truncated) when
	 *  one is active; the localized "Search or type a URL" when none is.
	 *  Empty OR about:blank (any case, optional fragment suffix like
	 *  'about:blank#blocked') is NO URL — a fresh tab must show the
	 *  original placeholder, not the blank URL. */
	// Focus polish round 2 (operator live report): a FRESH tab's birth page is
	// a data: URL (the registry's 'Glass Browser — waiting' page), so the whole
	// data: family counts as NO URL — the placeholder falls back to 'Search or
	// type a URL', and the copy-URL icon stays disabled.
	function isNoUrl(u: string): boolean {
		const s = u.toLowerCase();
		return !s || s === 'about:blank' || s.startsWith('about:blank#') || s.startsWith('data:');
	}
	const omniboxPlaceholder = $derived.by(() => {
		const act = tabs.find((tb) => tb.active);
		const url = act?.url ?? '';
		if (isNoUrl(url)) return t(m.browserUrlPlaceholder);
		return url.length > OMNIBOX_PLACEHOLDER_MAX ? url.slice(0, OMNIBOX_PLACEHOLDER_MAX) : url;
	});
	/** ADR-0040 D5: the tab strip — the registry's tab list mirrored here;
	 *  the SERVER stays the authority (activeTargetId), this is a view. */
	let tabs = $state<{ targetId: string; tabId: number; url: string; title: string; active: boolean }[]>([]);
	/** The tab strip's overflow container — bound for STRIP-LOCAL reveal
	 *  scrolls (2026-10-28): scrollIntoView's ancestor walk reached the
	 *  floor's panels-viewport and stole the operator's selection-follow. */
	let stripEl = $state<HTMLElement | undefined>(undefined);
	let switching = $state(false);
	/** Focus polish 2026-10-28: the FOCUSED tab's facts for the header's
	 *  prefix copy-URL icon (null = no real URL — the isNoUrl guard, so an
	 *  empty/about:blank tab disables the copy) and the info line's
	 *  '{sessionTitle} | {tab title}' suffix (FULL text; CSS truncates). */
	const focusedTab = $derived(tabs.find((tb) => tb.active) ?? null);
	const focusedTitle = $derived(focusedTab?.title ?? '');
	const focusedUrl = $derived(focusedTab && !isNoUrl(focusedTab.url) ? focusedTab.url : null);
	/** The last active tab the strip poll saw — an EXTERNAL activate (the
	 *  brain's, D5 amendment 2026-10-27) must re-attach the SSE or the mirror
	 *  keeps painting the old face while the strip highlights the new one. */
	let lastSeenActive: string | null = null;

	// Live zoom slider (2026-10-28, operator-approved): the session's content
	// zoom, right-aligned in the provenance row. null = unknown/not fetched —
	// the slider stays hidden until GET /zoom proves the config knob is on.
	let zoom = $state<number | null>(null);
	let zoomKnobEnabled = $state(false);
	let zoomTimer: ReturnType<typeof setTimeout> | null = null;

	async function fetchZoom(): Promise<void> {
		if (!sessionId) return;
		try {
			const res = await fetch(apiBase + '/api/browser/' + sessionId + '/zoom');
			if (!res.ok) return;
			const d = (await res.json()) as { zoom?: number; knobEnabled?: boolean };
			zoom = typeof d.zoom === 'number' ? d.zoom : null;
			zoomKnobEnabled = d.knobEnabled === true;
		} catch {
			// endpoint unreachable — keep the slider hidden, never break the panel
		}
	}

	/** The LIVE effect: debounced (~100ms) POST — the registry stores the
	 *  per-session zoom and evaluates every attached tab instantly. Fix
	 *  round 1: a refused/failed POST (400, network) rolls the optimistic
	 *  local value back — the slider never lies about the session. */
	function pushZoom(v: number): void {
		const prev = zoom;
		zoom = v;
		if (zoomTimer) clearTimeout(zoomTimer);
		zoomTimer = setTimeout(() => {
			zoomTimer = null;
			if (!sessionId) return;
			void fetch(apiBase + '/api/browser/' + sessionId + '/zoom', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ zoom })
			})
				.then((res) => {
					if (!res.ok && prev !== null) zoom = prev;
				})
				.catch(() => {
					if (prev !== null) zoom = prev;
				});
		}, 100);
	}

	/** Ghost Glass Fix 2 (RCA 2026-10-31): a 'died' SSE event is the server's
	 *  death announcement — the panel flips to the closed lamp instantly (no
	 *  2s poll wait, no ghost strip). Same handshake as the tabs 404 arm. */
	function watchDeath(source: EventSource): void {
		source.addEventListener('died', (ev) => {
			status = 'closed';
			tabs = [];
			source.close();
		});
	}

	async function refreshTabs(): Promise<void> {
		if (!sessionId) return;
		try {
			const res = await fetch(apiBase + '/api/browser/' + sessionId + '/tabs');
			if (res.ok) {
				// the strip is furniture — a malformed payload (proxy quirk, route
				// drift) degrades to 'no tabs', never a render throw on tabs.length
				const data = (await res.json().catch(() => null)) as { tabs?: typeof tabs } | null;
				tabs = Array.isArray(data?.tabs) ? data.tabs : [];
				const act = tabs.find((t) => t.active)?.targetId ?? null;
				if (act && act !== lastSeenActive) {
					const firstRead = lastSeenActive === null;
					lastSeenActive = act;
					// the panel's OWN activateTab re-attaches itself (switching guard);
					// this arm catches a REGISTRY-SIDE activate — brain tab creation
					// (D5 amendment) — so the mirror follows without a page reload
					if (!firstRead && !switching) attachStream(0);
				}
			} else if (res.status === 404 || res.status === 409) {
				// Ghost Glass Fix 1 (RCA 2026-10-31): a DEFINITIVE not-found for a
				// session this panel is DISPLAYING is the DEATH handshake — the
				// registry holds no such glass and never will again. Flip to the
				// closed lamp, empty the strip, tell the operator once. Genuine
				// network blips still fall through to the transient catch below.
				status = 'closed';
				tabs = [];
				es?.close();
			}
		} catch {
			/* transient — the strip refetches on the next switch */
		}
	}

	/** ADR-0040 D4: activate paints the BOUNDARY frame from the response —
	 *  the panel never waits on a blank paint — then re-attaches the SSE at
	 *  the carried seq so the stream resumes on the new relay's ring. */
	async function activateTab(targetId: string): Promise<void> {
		if (!sessionId || switching || tabs.find((t) => t.targetId === targetId)?.active) return;
		switching = true;
		try {
			const res = await fetch(apiBase + '/api/browser/' + sessionId + '/activate', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ targetId })
			});
			if (res.status === 409) {
				status = 'closed';
				es?.close();
				onclosed?.();
				return;
			}
			if (!res.ok) return;
			const boundary = (await res.json()) as { seq: number; jpeg: string | null; url: string };
			if (boundary.jpeg) draw({ jpeg: boundary.jpeg, metadata: { boundary: true } });
			const p = await fetch(apiBase + '/api/browser/' + sessionId + '/page?targetId=' + encodeURIComponent(targetId));
			if (p.ok) dpr = ((await p.json()) as { dpr?: number }).dpr ?? 1;
			es?.close();
			es = new EventSource(apiBase + '/api/browser/' + sessionId + '/stream?fromSeq=' + boundary.seq);
			watchDeath(es);
			es.addEventListener('frame', (ev) => {
				status = 'live';
				failReason = null;
				draw(JSON.parse((ev as MessageEvent).data as string));
				if (wrap && viewport.w > 0 && Math.abs(viewport.w - measureWrap().w) > 8) lastViewport = { w: 0, h: 0 };
				syncViewport();
				maybeRefreshTabs();
			});
			es.onerror = () => {
				if (status !== 'closed') status = 'failed';
			};
			void refreshTabs();
		} catch {
			/* transient — the strip keeps the old face */
		} finally {
			switching = false;
		}
	}
	/** Viewport-follow (ADR-0031 amendment 2): the glass box size IS the
	 *  page viewport — the frame comes back at panel size, so content
	 *  renders at native scale. ADR-0048 D1: a SETTLE GATE (180ms quiet
	 *  window) replaces the 2026-10-26 trailing throttle — a continuous
	 *  gesture (slider zoom, gutter) re-arms the window on every REAL box
	 *  change and exactly ONE POST fires after the hand stops. The
	 *  ±2px dead-band check runs BEFORE the re-arm, so a frame stream
	 *  over an UNCHANGED box early-returns and can never starve the gate
	 *  (the trap that broke the pre-2026-10-26 clear-and-rearm debounce:
	 *  that version re-armed per CALL, this one re-arms per CHANGE). */
	const SETTLE_MS = 180;
	let viewportTimer: ReturnType<typeof setTimeout> | null = null;
	let lastViewport = { w: 0, h: 0 };
	/** The last SEEN box — the settle detector's reference. The posted
	 *  viewport (lastViewport) only moves when the POST fires, so re-arm
	 *  decisions keyed on it would starve (every pre-settle call would
	 *  look "changed"). A call whose box equals the pending box must let
	 *  the pending timer be. */
	let lastSeen = { w: 0, h: 0 };
	/** ADR-0041 D1: the eye's ruler — the transform-true rect (visual px).
	 *  The floor zoom is a transform (PanelsZoom), which clientWidth cannot
	 *  see; the rect is what the operator actually sees, and what the
	 *  Playwright window must match. Same pixel space as the coord mapper. */
	function measureWrap(): { w: number; h: number } {
		if (!wrap) return { w: 0, h: 0 };
		const r = wrap.getBoundingClientRect();
		return { w: Math.round(r.width), h: Math.round(r.height) };
	}
	function syncViewport(): void {
		if (!sessionId || !wrap) return;
		const { w, h } = measureWrap();
		if (w < 100 || h < 80) return; // collapsed/hidden — nothing honest to send
		if (Math.abs(w - lastViewport.w) < 2 && Math.abs(h - lastViewport.h) < 2) return;
		// ADR-0048 D1: re-arm only on a change vs the last SEEN box — a call
		// reporting the box already pending settles with the pending timer
		// (per-SEEN-change re-arming is the gesture semantics; per-CALL
		// re-arming is what starved the 2026-10-26 debounce). A stale POST
		// stays harmless (idempotent setViewport); a starved one letterboxed
		// forever.
		if (Math.abs(w - lastSeen.w) < 2 && Math.abs(h - lastSeen.h) < 2) return;
		lastSeen = { w, h };
		if (viewportTimer) clearTimeout(viewportTimer);
		viewportTimer = setTimeout(() => {
			viewportTimer = null;
			if (!sessionId || !wrap) return;
			const m = measureWrap();
			if (m.w < 100 || m.h < 80) return;
			if (Math.abs(m.w - lastViewport.w) < 2 && Math.abs(m.h - lastViewport.h) < 2) return;
			lastViewport = { w: m.w, h: m.h };
			void fetch(apiBase + '/api/browser/' + sessionId + '/viewport', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ width: m.w, height: m.h })
			}).catch(() => undefined);
		}, SETTLE_MS);
	}
	const moves = createMoveCoalescer((cb) => requestAnimationFrame(cb), (x, y) => void post({ kind: 'mouse', type: 'mouseMoved', x, y }));

	/** A prop-seeded session is persisted too, so the NEXT reload re-binds
	 *  to it instead of opening a twin (ADR-0030 D1). */
	function persistSeeded(id: string): void {
		persistId(id);
	}

	let es: EventSource | null = null;
	/** One place owns the SSE lifecycle — mount, strip-activate, context-menu
	 *  open/close all re-attach through here (round-5 bugfix: a server-side
	 *  switch left the panel subscribed to the OLD, paused relay = frozen). */
	function attachStream(fromSeq: number): void {
		if (!sessionId) return;
		es?.close();
		es = new EventSource(apiBase + '/api/browser/' + sessionId + '/stream?fromSeq=' + fromSeq);
		watchDeath(es);
		es.addEventListener('frame', (ev) => {
			status = 'live';
			failReason = null;
			draw(JSON.parse((ev as MessageEvent).data as string));
			syncViewport();
			maybeRefreshTabs();
		});
		es.onerror = () => {
			if (status !== 'closed') status = 'failed';
		};
	}
	/** The mirrored page's devicePixelRatio — frame images arrive in DEVICE
	 *  pixels; input coords must be CSS px (D6). Read once per session via
	 *  the /page route. */
	let dpr = 1;

	async function post(input: unknown): Promise<void> {
		if (!sessionId) return;
		try {
			const res = await fetch(apiBase + '/api/browser/' + sessionId + '/input', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(input)
			});
			if (res.status === 409) {
				status = 'closed';
				es?.close();
				onclosed?.(); // the death notice rides upward (Ladder D4)
			}
		} catch {
			/* transient — the status strip shows liveness via frames anyway */
		}
	}

	function toViewportCx(e: MouseEvent): { x: number; y: number } | null {
		if (!wrap) return null;
		const r = wrap.getBoundingClientRect();
		// letterbox-aware: maps against the CONTAINED image rect, and returns
		// null on the letterbox bars (no phantom clicks off-page)
		return scalePoint(e.clientX, e.clientY, r.left, r.top, r.width, r.height, viewport.w, viewport.h);
	}

	function onPointerDown(e: MouseEvent): void {
		if (e.button !== 0) return;
		const p = toViewportCx(e);
		if (p) void post({ kind: 'mouse', type: 'mousePressed', x: p.x, y: p.y, button: 'left', clickCount: 1 });
	}
	function onPointerUp(e: MouseEvent): void {
		if (e.button !== 0) return;
		const p = toViewportCx(e);
		if (p) void post({ kind: 'mouse', type: 'mouseReleased', x: p.x, y: p.y, button: 'left', clickCount: 1 });
	}
	function onPointerMove(e: MouseEvent): void {
		const p = toViewportCx(e);
		if (p) moves.push(p.x, p.y);
	}
	/** BUGFIX 2026-10-25 (operator: YouTube's right-click menu never appears
	 *  in the glass): only the LEFT button was dispatched. Right-click must
	 *  reach the page as a right mousePressed/Released pair — Chrome paints
	 *  its OWN context menu and the screencast mirrors it. preventDefault
	 *  stops the DSI page's menu from covering the glass. */
	/** BUGFIX 2026-10-25 round 2: Chrome's NATIVE right-click menu is browser
	 *  UI — it never renders in the page, so the screencast can never show it
	 *  (only in-page custom menus like YouTube's player menu can mirror). So
	 *  DSI supplies its OWN menu: what the right-click landed on comes from
	 *  the /element data pass; actions ride the wire (opentab/clipboard/the
	 *  page's own menu via a dispatched right-click). */
	let ctxMenu = $state<{ px: number; py: number; href: string | null; src: string | null } | null>(null);
	let ctxPoint: { x: number; y: number } | null = null;

	function onContextMenu(e: MouseEvent): void {
		e.preventDefault();
		const p = toViewportCx(e);
		ctxPoint = p;
		// wrap-LOCAL coords: the menu renders inside the glass wrap (position
		// fixed is unreliable here — a floor ancestor transform becomes the
		// containing block for fixed elements and misplaced the menu)
		const rect = wrap?.getBoundingClientRect();
		const menuW = 190, menuH = 210;
		const px = rect ? Math.min(e.clientX - rect.left, rect.width - menuW - 6) : e.clientX;
		const py = rect ? Math.min(e.clientY - rect.top, rect.height - menuH - 6) : e.clientY;
		ctxMenu = { px: Math.max(6, px), py: Math.max(6, py), href: null, src: null };
		if (!sessionId) return;
		void (async () => {
			try {
				const res = await fetch(apiBase + '/api/browser/' + sessionId + '/element', {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ x: p?.x ?? 0, y: p?.y ?? 0 })
				});
				if (res.ok && ctxMenu) {
					const el = (await res.json()) as { href: string | null; src: string | null };
					ctxMenu = { ...(ctxMenu as { px: number; py: number }), href: el.href, src: el.src };
				}
			} catch {
				/* menu still shows the wire-independent items */
			}
		})();
	}
	function ctxClose(): void {
		ctxMenu = null;
	}
	function ctxSendRightClick(): void {
		const p = ctxPoint;
		ctxClose();
		if (!p) return;
		void post({ kind: 'mouse', type: 'mousePressed', x: p.x, y: p.y, button: 'right', clickCount: 1 });
		void post({ kind: 'mouse', type: 'mouseReleased', x: p.x, y: p.y, button: 'right', clickCount: 1 });
	}
	/** ADR-0042 D3: ONE client choreography for tab creation — the context
	 *  menu's open-link/image (url present) and the strip's + chip (url
	 *  empty = BLANK, the birth state again). Empty body per D1: absence is
	 *  the blank signal, never a literal about:blank. Callers own their own
	 *  ctxClose(). */
	async function openTab(url: string): Promise<void> {
		if (!sessionId) return;
		try {
			const res = await fetch(apiBase + '/api/browser/' + sessionId + '/opentab', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(url ? { url } : {})
			});
			if (!res.ok) return;
			const b = (await res.json()) as { targetId: string; seq: number; jpeg: string | null };
			if (b.jpeg) draw({ jpeg: b.jpeg, metadata: { boundary: true } });
			const p2 = await fetch(apiBase + '/api/browser/' + sessionId + '/page?targetId=' + encodeURIComponent(b.targetId));
			if (p2.ok) dpr = ((await p2.json()) as { dpr?: number }).dpr ?? 1;
			attachStream(b.seq);
			void refreshTabs();
		} catch {
			/* transient */
		}
	}
	async function ctxCloseTab(targetId: string): Promise<void> {
		ctxClose();
		if (!sessionId) return;
		try {
			await fetch(apiBase + '/api/browser/' + sessionId + '/closetab', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ targetId })
			});
			// the survivor may be a NEW active face — resync from the top
			attachStream(0);
			void refreshTabs();
		} catch {
			/* transient */
		}
	}
	function ctxAct(action: string): void {
		const m = ctxMenu;
		ctxClose();
		if (!m) return;
		if (action === 'open-image' && m.src) return void openTab(m.src);
		if (action === 'copy-image' && m.src) return void ctxCopy(m.src);
		if (action === 'open-link' && m.href) return void openTab(m.href);
		if (action === 'copy-link' && m.href) return void ctxCopy(m.href);
		if (action === 'reload') return void proxy({ action: 'reload' });
		if (action === 'send-right-click') return ctxSendRightClick();
	}
	async function ctxCopy(text: string): Promise<void> {
		ctxClose();
		try {
			await navigator.clipboard.writeText(text);
		} catch {
			/* clipboard permission denied — nothing honest to show */
		}
	}
	function onWheel(e: WheelEvent): void {
		const p = toViewportCx(e);
		if (!p) return;
		e.preventDefault();
		void post({ kind: 'mouse', type: 'mouseWheel', x: p.x, y: p.y, deltaX: e.deltaX, deltaY: e.deltaY });
	}
	// Alt+N tab focus (glass-tab-ids, fix round 1): WINDOW-level owner via
	// <svelte:window> — keyboard events reach the canvas onKey only while the
	// mirror canvas holds focus, and operators' focus lives on the strip/UI,
	// so the panel shortcut must bind wherever focus is (chrome semantics).
	// Panel shortcut ALWAYS wins while the panel is mounted; the combo is
	// never forwarded to the glass page. The canvas onKey path deliberately
	// carries NO Alt-digit arm — single owner prevents double activation.
	// Match on event.code (Digit1..Digit9), NOT event.key: macOS Option-key
	// char remapping would break key matching. N is strip POSITION; Alt+0
	// arms the LAST tab; an empty slot is a no-op.
	function onWindowKey(e: KeyboardEvent): void {
		if (!e.altKey) return;
		const m = /^Digit([0-9])$/.exec(e.code);
		if (!m) return;
		e.preventDefault();
		e.stopPropagation();
		const n = Number(m[1]);
		const target = n === 0 ? tabs.at(-1)?.targetId : tabs[n - 1]?.targetId;
		if (target) {
			void activateTab(target);
		}
		// always consumed — never forwarded to the page
	}
	function onKey(e: KeyboardEvent): void {
		// printable keyDowns MUST carry text — CDP inserts characters only
		// from the text field (raw key events without it move no caret)
		void post({
			kind: 'key',
			type: e.type === 'keydown' ? 'keyDown' : 'keyUp',
			key: e.key,
			code: e.code,
			windowsVirtualKeyCode: e.keyCode,
			text: e.type === 'keydown' && e.key.length === 1 ? e.key : undefined
		});
	}

	/** A URL/search phrase is a URL when the route would take it verbatim;
	 *  anything else rides the search engine (ADR-0031 D2). glass-tab-ids
	 *  Task 4 adds the dotted-host arm: "example.com" navigates, it does not
	 *  search (the same shape the tab-grammar parser accepts after "glass"). */
	function toTarget(text: string): string {
		return /^[a-z][a-z0-9+.-]*:\/\/|^data:text\/html/.test(text) || /^([^\s/]+\.[^\s/]{2,})$/.test(text)
			? text
			: SEARCH_URL + encodeURIComponent(text);
	}

	/** glass-tab-ids Task 4: the omnibox speaks tab grammar. A parsed command
	 *  acts (open/focus/close/query-active); anything the parser passes over
	 *  falls through to the classic URL-or-search split in the ACTIVE tab.
	 *  tabId→targetId resolution is PANEL-LOCAL — read off the tabs payload
	 *  the strip poll already holds; no server round-trip resolves it. */
	async function handleOmniboxSubmit(text: string): Promise<void> {
		const cmd = parseTabCommand(text);
		if (cmd.kind === 'open') {
			// "glass <url>" opens verbatim; "glass <text>" opens the engine.
			await openTab(cmd.url ?? SEARCH_URL + encodeURIComponent(cmd.text ?? ''));
			return;
		}
		if (cmd.kind === 'focus') {
			const target = tabs.find((tb) => tb.tabId === cmd.tabId)?.targetId;
			if (!target) {
				console.warn('[browser-panel] omnibox: no tab tab:' + cmd.tabId);
				return; // never navigate on an unknown ordinal
			}
			await activateTab(target);
			// "reuse tab:N <url>": navigate AFTER the focus lands (proxy acts
			// on the session's active target, which the activate just set).
			if (cmd.url) await proxy({ url: toTarget(cmd.url) });
			return;
		}
		if (cmd.kind === 'close') {
			const target =
				cmd.tabId === 'active'
					? tabs.find((tb) => tb.active)?.targetId
					: tabs.find((tb) => tb.tabId === cmd.tabId)?.targetId;
			if (!target) {
				console.warn('[browser-panel] omnibox: close resolved to no tab', cmd.tabId);
				return;
			}
			await ctxCloseTab(target);
			return;
		}
		if (cmd.kind === 'query-active') {
			// "active" → echo "tab:N <url>" into the box; DO NOT navigate.
			const act = tabs.find((tb) => tb.active);
			if (act) header?.setOmniboxValue('tab:' + act.tabId + ' ' + act.url);
			return;
		}
		if (cmd.kind === 'error') {
			console.warn('[browser-panel] omnibox:', cmd.error);
			return; // surface = console + no-op; a bad grammar never navigates
		}
		// url-or-search: URL-shaped rides verbatim, a phrase rides the engine.
		void proxy({ url: toTarget(text) });
	}

	/** One POST for every proxy verb; the ANSWER (success or refusal)
	 *  clears the input and refreshes the history bounds. A dead session
	 *  surfaces as the closed status, never a crash (404/409). */
	async function proxy(body: unknown): Promise<void> {
		if (!sessionId || proxyBusy) return;
		proxyBusy = true;
		try {
			const res = await fetch(apiBase + '/api/browser/' + sessionId + '/navigate', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(body)
			});
			if (res.ok) {
				const info = (await res.json()) as { currentIndex?: number; entryCount?: number };
				const idx = info.currentIndex ?? 0;
				const count = info.entryCount ?? 1;
				canBack = idx > 0;
				canForward = idx < count - 1;
				header?.clearInput();
			} else if (res.status === 404 || res.status === 409) {
				if (res.status === 409) onclosed?.(); // death notice (Ladder D4)
				status = 'closed';
				es?.close();
			}
		} catch {
			/* transient — the status strip shows liveness via frames anyway */
		} finally {
			proxyBusy = false;
		}
	}
	function goHistory(dir: 'back' | 'forward'): void {
		void proxy({ action: dir });
	}

	/** Long-press history dropdown (operator-approved 2026-10-28): the
	 *  header reports the picked list index; the panel performs the TRUE
	 *  travel POST (Page.navigateToHistoryEntry — no new history entry)
	 *  and the answer refreshes the bounds exactly like a proxy verb. */
	async function goHistoryTo(index: number): Promise<void> {
		if (!sessionId || proxyBusy) return;
		proxyBusy = true;
		try {
			const res = await fetch(apiBase + '/api/browser/' + sessionId + '/history', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ targetId: focusedTab?.targetId, index })
			});
			if (res.ok) {
				const info = (await res.json()) as { currentIndex?: number; entryCount?: number };
				const idx = info.currentIndex ?? 0;
				const count = info.entryCount ?? 1;
				canBack = idx > 0;
				canForward = idx < count - 1;
				header?.clearInput();
			} else if (res.status === 409) {
				status = 'closed';
				es?.close();
				onclosed?.();
			}
		} catch {
			/* transient — the mirror keeps painting whatever face is live */
		} finally {
			proxyBusy = false;
		}
	}

	/** The FOLD (ADR-0037 D1): the header close button only reports
	 *  upward - the route's onclose is removePanel, the panel leaves the
	 *  floor, and the SERVER SESSION STAYS ALIVE (the reaper is the
	 *  bound; the slot entry keeps the re-bind facts). The old
	 *  owner-release kill (POST /close on this click, ADR-0029 D8) is
	 *  retired from this surface: kills belong to the reaper and
	 *  cascade close now. */
	function fold(): void {
		onclose?.();
	}

	function draw(f: { jpeg: string; metadata: Record<string, unknown> }): void {
		const img = new Image();
		img.onload = () => {
			if (!canvas || !wrap) return;
			// BUGFIX round 8b (operator: switching tabs shrinks again): the frame
			// size can relapse to the launch default (1920x993 observed) when
			// something re-applies emulation behind our back. So the canvas bitmap
			// is ALWAYS the wrap box (CSS 1:1, no object-fit dependence) and the
			// frame is contain-fit into it with manual letterboxing — any frame
			// size renders identically, native scale when sizes match.
			// BUGFIX 2026-10-26 (operator: black bands at floor zoom 0.853): the
			// bitmap ruler must be the SAME transform-true rect the viewport POST
			// uses (ADR-0041 D1). clientWidth is layout px — at zoom z the bitmap
			// was 1/z bigger than the (visual-sized) frame, and contain-fit
			// letterboxed it: black bands left/right AND top/bottom.
			const box = measureWrap();
			const cw = Math.max(1, box.w);
			const ch = Math.max(1, box.h);
			if (canvas.width !== cw || canvas.height !== ch) {
				canvas.width = cw;
				canvas.height = ch;
			}
			viewport = { w: img.width / dpr, h: img.height / dpr };
			const ctx = canvas.getContext('2d');
			if (!ctx) return;
			ctx.fillStyle = '#000';
			ctx.fillRect(0, 0, canvas.width, canvas.height);
			const scale = Math.min(canvas.width / img.width, canvas.height / img.height);
			const dw = img.width * scale, dh = img.height * scale;
			ctx.drawImage(img, (canvas.width - dw) / 2, (canvas.height - dh) / 2, dw, dh);
		};
		img.src = 'data:image/jpeg;base64,' + f.jpeg;
	}

	onMount(() => {
		(async () => {
			try {
				// cold shape: the prop is the seed, read ONCE here (mount-time
				// intent) — the panel never hot-swaps sessions. No prop: the
				// resolver re-binds the persisted live id or opens fresh
				// (ADR-0030 D1/D4) — a hard reload lands HERE, not in a kill.
				sessionId ??= browserSessionId ?? null;
				if (!sessionId) {
					// Amendment 3: a chip-spawned glass OPENS FRESH — the global
					// persisted id is another glass's session, and re-binding to it
					// would share one profile across glasses (the reported bug:
					// both glasses showing the same session id). Re-bind rides the
					// ENTRY's browserSessionId (the slot's per-glass sessionId).
					// BUGFIX round 11 (operator design): measure THIS panel's glass box
				// BEFORE opening — the glass is born at the size of its panel.
				// ADR-0041 D1: the rect (visual px), so a glass born on a zoomed
				// floor starts at the size the operator SEES, not the layout box.
				const birth = measureWrap();
				const birthW = Math.max(200, birth.w);
				const birthH = Math.max(120, birth.h);
				const res = await fetch(apiBase + '/api/browser', {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					// ADR-0045 amendment 3 D7 (corrected by RCA 2026-10-30): the
					// OWNER is this glass's OPENER — openedBy is the conversation
					// panel's own session id, wired by the chip at +page.svelte
					// (openBrowserPanel(..., p.sessionId)). PANEL-SCOPED fact:
					// a page hosts many conversations, so any page-global capture
					// (URL param, shared blob) forges the map — v1/v2 of this fix
					// both died on that. harnessSessionKey() only backs the
					// keyless ControlBar singleton.
					body: JSON.stringify({
						...(birthW > 0 ? { width: birthW, height: birthH } : {}),
						...((openedBy ?? harnessSessionKey()) ? { ownerSessionId: (openedBy ?? harnessSessionKey())! } : {})
					})
				});
					if (!res.ok) throw new Error('open failed: ' + res.status);
					const info = (await res.json()) as { id: string };
					sessionId = info.id;
					reBound = false;
					// Amendment 3: report the session up — the slot list carries one
					// sessionId per glass so the boot restore re-binds each glass
					// to its OWN session.
					onsession?.(sessionId);
					persistSeeded(sessionId);
					const p = await fetch(apiBase + '/api/browser/' + sessionId + '/page');
					if (p.ok) dpr = ((await p.json()) as { dpr?: number }).dpr ?? 1;
				}
				status = 'connecting';
				// ADR-0040 D5: the strip mirrors the registry's tab list
				void refreshTabs();
				// zoom slider: learn the session's starting zoom + knob state
				void fetchZoom();
				// fromSeq=0 forces the server to push its LATEST frame on attach
				attachStream(0);
			} catch (e) {
				status = 'failed';
				failReason = (e as Error).message;
			}
		})();
	});

	$effect(() => {
		// wrap binds late (the status gate renders it) — observe the real
		// element, re-armed whenever the binding lands
		const el = wrap;
		if (!el) return;
		const ro = new ResizeObserver(() => syncViewport());
		ro.observe(el);
		return () => ro.disconnect();
	});

	$effect(() => {
		// ADR-0041 D2: a zoom-only change moves the VISUAL box without a
		// layout resize — the ResizeObserver above is transform-blind. The
		// floor zoom (page-prefs, the single authority) is the reactive
		// input; the debounce and ±2px gates collapse drags into one POST.
		void pagePrefs.zoom;
		syncViewport();
	});

	$effect(() => {
		// the context menu closes on any pointerdown OUTSIDE it (capture, so a
		// glass click never both dismisses and acts)
		if (!ctxMenu) return;
		const onPD = (e: PointerEvent) => {
			const t = e.target as HTMLElement | null;
			if (t && t.closest('[data-testid="browser-ctxmenu"]')) return;
			ctxClose();
		};
		window.addEventListener('pointerdown', onPD, { capture: true });
		return () => window.removeEventListener('pointerdown', onPD, { capture: true });
	});

	$effect(() => {
		// BUGFIX round 3 (operator: third tab invisible): in a narrow panel the
		// strip can overflow — keep the ACTIVE tab visible. Trigger is the
		// ACTIVE TAB IDENTITY, not the tabs array: the poll refreshes the array
		// every 2s and a fresh identity must not re-fire a no-change reveal
		// (2026-10-28 operator: the reveal fought PanelsZoom's selection-follow
		// on the floor). The scroll is STRIP-LOCAL by hand — scrollIntoView
		// walks every scrollable ancestor and yanked the floor's panels-viewport
		// too, dragging the operator's focused session out of view (the traced
		// second actor: BrowserPanel scrollIntoView 1.3s after the reveal).
		// Component-local ref: document.querySelector would grab the FIRST
		// panel's strip when several Glass panels share a floor.
		const activeId = tabs.find((tb) => tb.active)?.targetId ?? null;
		void activeId;
		const strip = stripEl;
		if (!activeId || !strip) return;
		const el = strip.querySelector<HTMLElement>('[data-testid="browser-tab"][data-active="true"]');
		if (!el) return;
		const s = strip.getBoundingClientRect();
		const c = el.getBoundingClientRect();
		let target = strip.scrollLeft;
		if (c.left < s.left) target -= s.left - c.left;
		else if (c.right > s.right) target += c.right - s.right;
		else return; // chip fully visible — hands off
		strip.scrollLeft = Math.max(0, Math.min(target, strip.scrollWidth - strip.clientWidth));
	});

	// BUGFIX 2026-10-24: the strip used to fetch ONCE at mount, so a tab the
	// brain opened AFTER mount never appeared (the reported bug: two tabs on
	// the wire, one in the glass). Poll while live — Target.getTargets is one
	// cheap CDP read; the SERVER stays the authority (ADR-0040 D2).
	let tabsPoll: ReturnType<typeof setInterval> | null = null;
	let lastTabFetch = 0;
	/** BUGFIX round 2 (operator: a third brain tab was missed between ticks):
	 *  poll every 2s AND refresh on SSE activity when the last fetch is stale
	 *  — a video page frames constantly, so the strip tracks the brain at
	 *  ~2s granularity without hammering Target.getTargets. */
	function maybeRefreshTabs(): void {
		if (Date.now() - lastTabFetch < 2000) return;
		lastTabFetch = Date.now();
		void refreshTabs();
	}
	$effect(() => {
		if (status !== 'live' || !sessionId) {
			if (tabsPoll) {
				clearInterval(tabsPoll);
				tabsPoll = null;
			}
			return;
		}
		if (!tabsPoll) {
			tabsPoll = setInterval(() => maybeRefreshTabs(), 2000);
		}
		return () => {
			if (tabsPoll) {
				clearInterval(tabsPoll);
				tabsPoll = null;
			}
		};
	});

	onDestroy(() => {
		// DETACH ONLY (ADR-0030 D1/D2): an unmount — hard reload, tab close,
		// floor teardown — releases the EventSource, never the session. The
		// browser, its profile, and the brain on the brain port survive; the
		// persisted id re-binds on the next mount. Kills live with the
		// reaper and cascade close now (ADR-0037 D2) - the header fold is
		// just an unmount.
		es?.close();
		if (zoomTimer) clearTimeout(zoomTimer); // fix round 1: no post-unmount zoom POST
		if (tabsPoll) clearInterval(tabsPoll);
	});
</script>

<svelte:window onkeydown={onWindowKey} />
<div class="glass-browser-icons relative flex h-full flex-col bg-surface-elevated" data-testid="panel-browser">
	<BrowserHeader
		bind:this={header}
		{status}
		{reBound}
		{sessionId}
		{closing}
		busy={proxyBusy}
		{canBack}
		{canForward}
		onclose={() => fold()}
		onnavigate={handleOmniboxSubmit}
		placeholder={omniboxPlaceholder}
		onreload={() => void proxy({ action: 'reload' })}
		onhistory={goHistory}
		focusTargetId={focusedTab?.targetId ?? null}
		onhistoryto={(i) => void goHistoryTo(i)}
		copyUrl={focusedUrl}
	/>
	{#if openedBy}
		<BrowserProvenance
			{openedBy}
			{parentTitle}
			{focusedTitle}
			{depth}
			{zoomKnobEnabled}
			{zoom}
			zoomLabel={t(m.browserZoom)}
			onzoom={(fraction) => pushZoom(fraction)}
		/>
	{/if}
	{#if tabs.length >= 1}
		<!-- ADR-0040 D5: the tab strip — panel furniture fed by the registry;
		     a click is an activate, the boundary frame paints the answer.
		     ADR-0042 D3: the + chip at the strip's END is the operator's tab
		     CREATE — an absent-URL opentab (the birth state again); the panel
		     performs it exactly like activate: boundary paint, dpr, SSE
		     re-attach, immediate refresh. No address-bar focus grab (D3). -->
		<div bind:this={stripEl} class="flex items-center gap-1 overflow-x-auto border-b border-surface-border px-1 py-0.5 text-[11px]" data-testid="browser-tab-strip">
			{#each tabs as t, i (t.targetId)}
				<BrowserTab tab={t} position={i + 1} disabled={switching} onactivate={(id) => void activateTab(id)} onclose={(id) => void ctxCloseTab(id)} />
			{/each}
			<BrowserNew
				class="flex h-5 w-5 shrink-0 items-center justify-center rounded border border-accent-blue/20 bg-accent-blue/10 text-text-secondary hover:bg-accent-blue/20 disabled:opacity-40"
				label={t(m.browserNewTab)}
				testid="browser-tab-new"
				disabled={switching || status !== 'live'}
				onclick={() => void openTab('')}
			/>
		</div>
	{/if}
	<BrowserContent
		{status}
		{failReason}
		bind:wrap
		bind:canvas
		ondown={onPointerDown}
		onup={onPointerUp}
		onmove={onPointerMove}
		onwheel={onWheel}
		onkey={onKey}
		{ctxMenu}
		onctxaction={ctxAct}
		onctxclose={ctxClose}
		oncontextmenu={onContextMenu}
	/>
</div>
<style>
	/* One icon color grammar (glass-tab-ids, 2026-10-28 operator-approved):
	   every svg icon inside the panel reads accent purple. Scoped to the
	   panel root — never a global bare svg rule. State semantics (disabled,
	   active chip, hover) keep their own colors. */
	.glass-browser-icons :global(svg) {
		color: var(--color-accent-purple);
	}
	/* Fix round 1 (2026-10-28): the text-glyph controls (←/→/⟳, tab ✕)
	   join the same grammar. The destructive close keeps its white-on-red
	   hover affordance; the trash-bin (session delete) stays red — both
	   carve-outs are deliberate destructive-action affordances. */
	.glass-browser-icons :global(.browser-glyph) {
		color: var(--color-accent-purple);
	}
	.glass-browser-icons :global(.browser-glyph-destructive:hover) {
		color: #fff;
	}
	.glass-browser-icons :global(.browser-icon-trash) {
		color: red;
	}
</style>
