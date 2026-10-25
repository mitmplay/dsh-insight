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
	import * as m from '$lib/paraglide/messages';
	import { persistId } from '$lib/services/panels/browser-session-resolver.js';
	import BrowserHeader from './BrowserHeader.svelte';
	import BrowserContent from './BrowserContent.svelte';
	import BrowserTab from './BrowserTab.svelte';
	import { createMoveCoalescer, scalePoint } from './mirror-input.ts';
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
	let header: { clearInput(): void } | null = $state(null);
	const SEARCH_URL = 'https://www.google.com/search?q=';
	/** ADR-0040 D5: the tab strip — the registry's tab list mirrored here;
	 *  the SERVER stays the authority (activeTargetId), this is a view. */
	let tabs = $state<{ targetId: string; url: string; title: string; active: boolean }[]>([]);
	let switching = $state(false);

	async function refreshTabs(): Promise<void> {
		if (!sessionId) return;
		try {
			const res = await fetch(apiBase + '/api/browser/' + sessionId + '/tabs');
			if (res.ok) {
				// the strip is furniture — a malformed payload (proxy quirk, route
				// drift) degrades to 'no tabs', never a render throw on tabs.length
				const data = (await res.json().catch(() => null)) as { tabs?: typeof tabs } | null;
				tabs = Array.isArray(data?.tabs) ? data.tabs : [];
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
	 *  renders at native scale. Debounced; one POST per settle. */
	let viewportTimer: ReturnType<typeof setTimeout> | null = null;
	let lastViewport = { w: 0, h: 0 };
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
		if (viewportTimer) clearTimeout(viewportTimer);
		viewportTimer = setTimeout(() => {
			lastViewport = { w, h };
			void fetch(apiBase + '/api/browser/' + sessionId + '/viewport', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ width: w, height: h })
			}).catch(() => undefined);
		}, 250);
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
	async function ctxOpenTab(url: string): Promise<void> {
		ctxClose();
		if (!sessionId) return;
		try {
			const res = await fetch(apiBase + '/api/browser/' + sessionId + '/opentab', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ url })
			});
			if (!res.ok) return;
			const b = (await res.json()) as { seq: number; jpeg: string | null };
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
		if (action === 'open-image' && m.src) return void ctxOpenTab(m.src);
		if (action === 'copy-image' && m.src) return void ctxCopy(m.src);
		if (action === 'open-link' && m.href) return void ctxOpenTab(m.href);
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
	 *  anything else rides the search engine (ADR-0031 D2). */
	function toTarget(text: string): string {
		return /^https?:\/\/|^data:text\/html/.test(text) ? text : SEARCH_URL + encodeURIComponent(text);
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
	function submitUrl(text: string): void {
		void proxy({ url: toTarget(text) });
	}
	function goHistory(dir: 'back' | 'forward'): void {
		void proxy({ action: dir });
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
			const cw = Math.max(1, Math.round(wrap.clientWidth));
			const ch = Math.max(1, Math.round(wrap.clientHeight));
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
					body: JSON.stringify(birthW > 0 ? { width: birthW, height: birthH } : {})
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
		// strip can overflow — keep the ACTIVE tab scrolled into view on every
		// tab-set change so "missing" tabs are impossible to overlook
		if (!tabs.length) return;
		const el = document.querySelector('[data-testid="browser-tab"][data-active="true"]');
		el?.scrollIntoView({ inline: 'nearest', block: 'nearest' });
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
		if (tabsPoll) clearInterval(tabsPoll);
	});
</script>

<div class="relative flex h-full flex-col bg-surface-elevated" data-testid="panel-browser">
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
		onnavigate={submitUrl}
		onreload={() => void proxy({ action: 'reload' })}
		onhistory={goHistory}
	/>
	{#if openedBy}
		<!-- The lineage chip (ADR-0036 D3): who asked for this glass. The
		     title rides the spine merge the route resolved; a pruned opener
		     degrades to the raw session id. Depth tint like the transcript. -->
		<div
			class="browser-provenance flex items-center gap-1 border-b border-surface-border px-2 py-0.5 text-[10px] text-surface-muted"
			class:depth-tinted={depth > 0}
			data-testid="browser-provenance"
			title={openedBy}
		>
			<span class="opacity-70">⌥</span>
			<span class="truncate">{parentTitle ?? openedBy}</span>
			{#if depth > 0}<span class="opacity-60">·d{depth}</span>{/if}
		</div>
	{/if}
	{#if tabs.length >= 1}
		<!-- ADR-0040 D5: the tab strip — panel furniture fed by the registry;
		     a click is an activate, the boundary frame paints the answer -->
		<div class="flex items-center gap-1 overflow-x-auto border-b border-surface-border px-1 py-0.5 text-[11px]" data-testid="browser-tab-strip">
			{#each tabs as t (t.targetId)}
				<BrowserTab tab={t} disabled={switching} onactivate={(id) => void activateTab(id)} onclose={(id) => void ctxCloseTab(id)} />
			{/each}
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
	/* Depth tint, self-contained (ADR-0036 D3): the conversation surface's
	   depth-tint is scoped there; the chip carries its OWN tone. */
	.depth-tinted {
		background-color: color-mix(in srgb, var(--color-surface-active, transparent) 30%, transparent);
	}
</style>