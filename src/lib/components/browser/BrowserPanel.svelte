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
	import BrowserHeader from './BrowserHeader.svelte';
	import BrowserContent from './BrowserContent.svelte';
	import { createMoveCoalescer, scalePoint } from './mirror-input.ts';
	import { persistId, resolveBrowserSession } from '$lib/services/panels/browser-session-resolver.js';

	let {
		/** The browser-session registry id; undefined = this panel OPENS the
		 *  session on mount (the singleton panel's cold shape). */
		browserSessionId = undefined,
		/** Owner-release callback (D8): fired AFTER /close answered ok. */
		onclose,
		/** Test seam: base URL for the API (e2e runs same-origin; default ''). */
		apiBase = ''
	}: {
		browserSessionId?: string | undefined;
		onclose?: () => void;
		apiBase?: string;
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
	/** Viewport-follow (ADR-0031 amendment 2): the glass box size IS the
	 *  page viewport — the frame comes back at panel size, so content
	 *  renders at native scale. Debounced; one POST per settle. */
	let viewportTimer: ReturnType<typeof setTimeout> | null = null;
	let lastViewport = { w: 0, h: 0 };
	function syncViewport(): void {
		if (!sessionId || !wrap) return;
		const w = wrap.clientWidth;
		const h = wrap.clientHeight;
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

	/** D8 owner-release: close the SERVER session first (kills the browser),
	 *  then report upward so the floor removes the panel. Exactly once —
	 *  the closing flag guards double-invocations (the single-close-post
	 *  unit contract). */
	async function closePanel(): Promise<void> {
		if (closing || !sessionId) return;
		closing = true;
		es?.close();
		try {
			await fetch(apiBase + '/api/browser/' + sessionId + '/close', { method: 'POST' });
		} catch {
			/* the registry close is the authority; a network blip must not
			   trap the panel — report upward regardless */
		}
		status = 'closed';
		onclose?.();
	}

	function draw(f: { jpeg: string; metadata: Record<string, unknown> }): void {
		const img = new Image();
		img.onload = () => {
			if (!canvas) return;
			canvas.width = img.width;
			canvas.height = img.height;
			// CDP screencast metadata carries NO viewport size — the frame IS
			// the viewport in device pixels; CSS size = frame ÷ dpr (D6 basis)
			viewport = { w: img.width / dpr, h: img.height / dpr };
			const ctx = canvas.getContext('2d');
			ctx?.drawImage(img, 0, 0);
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
					const r = await resolveBrowserSession(apiBase);
					sessionId = r.id;
					reBound = r.reBound;
					persistSeeded(sessionId);
					const p = await fetch(apiBase + '/api/browser/' + sessionId + '/page');
					if (p.ok) dpr = ((await p.json()) as { dpr?: number }).dpr ?? 1;
				}
				status = 'connecting';
				// fromSeq=0 forces the server to push its LATEST frame on attach
				es = new EventSource(apiBase + '/api/browser/' + sessionId + '/stream?fromSeq=0');
				console.log('GLASS es opened for', sessionId);
				es.addEventListener('frame', (ev) => {
					status = 'live';
					failReason = null;
					draw(JSON.parse((ev as MessageEvent).data as string));
					syncViewport();
				});
				es.onerror = () => {
					console.log('GLASS es error, readyState', es?.readyState);
					if (status !== 'closed') status = 'failed';
				};
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

	onDestroy(() => {
		// DETACH ONLY (ADR-0030 D1/D2): an unmount — hard reload, tab close,
		// floor teardown — releases the EventSource, never the session. The
		// browser, its profile, and the brain on the brain port survive; the
		// persisted id re-binds on the next mount. Owner-release stays where
		// ADR-0029 D8 put it: the explicit panel-close click (and the
		// server-side idle reaper as the safety net).
		es?.close();
	});
</script>

<div class="flex h-full flex-col bg-surface-elevated" data-testid="panel-browser">
	<BrowserHeader
		bind:this={header}
		{status}
		{reBound}
		{sessionId}
		{closing}
		busy={proxyBusy}
		{canBack}
		{canForward}
		onclose={() => void closePanel()}
		onnavigate={submitUrl}
		onreload={() => void proxy({ action: 'reload' })}
		onhistory={goHistory}
	/>
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
	/>
</div>