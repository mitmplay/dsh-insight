<!--
	CanvasCopyButton — capture a DOM element as PNG: click copies to clipboard,
	Shift+Click saves as file (OCI port, 2026-08-22).

	OCI's tiling logic verbatim: tall elements render in vertical tiles at
	full 2× (staying under html-to-image's 16,384 clamp) then composite onto
	one canvas sized to the browser's probed real limit; normal elements do
	one skipAutoScale pass. State machine idle → busy → done mirrors
	CopyButton feedback.

	Color contract (The Opaque Backing ADR, 2026-09-07): every capture paints
	the opaque CAPTURE_BACKING floor under the content, so the exported PNG
	owns its colors on any paste target; the element's translucent skin
	(computed oklab tints) stays in the SVG overlay.
-->
<script lang="ts">
	import { CameraIcon as CaptureIcon, Check, Loader2 } from '@lucide/svelte';
	import { toBlob, toCanvas } from 'html-to-image';

	let {
		container,
		title = 'Copy canvas as image (Shift+Click to save)',
		size = 12,
		class: className = '',
		mode = 'full'
	}: {
		container: HTMLElement | null | undefined;
		title?: string;
		size?: number;
		class?: string;
		/** 'full' (default) — the whole scrollable content (the historic
		 *  contract). 'visible' — ONLY what is on screen: the scroll
		 *  origin is compensated with a translateY(-scrollTop) clone and
		 *  the render is cropped to the container's client box
		 *  (PromptManagerToolbar, 2026-09-19). */
		mode?: 'full' | 'visible';
	} = $props();

	let state = $state<'idle' | 'busy' | 'done'>('idle');

	const DESIRED_RATIO = 2;
	// Each vertical tile covers this many element-px.
	// At DESIRED_RATIO = 2 → 16,000 canvas px per tile, staying under
	// html-to-image's internal 16,384 checkCanvasDimensions limit.
	const TILE_HEIGHT = 7900;

	/**
	 * The capture's floor color — mirrors --color-surface (app.css:14),
	 * the color the operator sees behind a bubble. html-to-image fillRects
	 * this over the WHOLE canvas before drawing, so a translucent computed
	 * background here shipped a mostly-transparent PNG whose colors were
	 * decided by the paste target (The Opaque Backing ADR, 2026-09-07).
	 */
	const CAPTURE_BACKING = '#f8f9fa';

	let _maxCanvasSide: number | null = null;

	/**
	 * Neutralize the capture ROOT's positioning for the clone (2026-10-07,
	 * PromptsManagerDialog bug). The manager modal is position:fixed,
	 * centered by top/left:50% + translate(-50%,-50%), and sized width:90%
	 * — all of which resolve against the VIEWPORT. html-to-image re-renders
	 * the clone inside a foreignObject sized to the element itself, so
	 * those percentages re-resolve against the clone's own box: the modal
	 * shrinks to 90% of itself and re-centers inside it — captured content
	 * lands offset-right with a blank band (the clone root keeps its
	 * computed styles). Pinning static/auto/none on the clone root makes
	 * the foreignObject the clone's containing block; capture targets that
	 * are already static (every panel column) are unaffected.
	 */
	const UNFIX_ROOT: Partial<CSSStyleDeclaration> = {
		position: 'static',
		top: 'auto',
		left: 'auto',
		right: 'auto',
		bottom: 'auto',
		transform: 'none',
		margin: '0'
	};

	/**
	 * Nested-scroll compensation for FULL-mode captures (2026-10-06).
	 *
	 * html-to-image clones content at every scroller's ORIGIN — a table
	 * scrolled right, a code block scrolled down, any overflow pane inside
	 * the capture renders its top-left corner, not what the operator sees
	 * (the WorkspaceFilePanel KB-page flaw: the capture always "scrolls to
	 * the top first"). renderVisible already compensates its own scrollers;
	 * full mode never did.
	 *
	 * During the render, every child of every scroller inside the capture
	 * shifts by that scroller's live scrollTop/scrollLeft (transforms don't
	 * affect layout), then everything is restored. Returns the undo fn.
	 */
	function compensateNestedScrollers(root: HTMLElement): () => void {
		const CLIPPING = new Set(['auto', 'scroll', 'hidden', 'clip']);
		const moved: { el: HTMLElement; prev: string }[] = [];
		const candidates = [root, ...root.querySelectorAll<HTMLElement>('*')];
		for (const el of candidates) {
			const st = el.scrollTop;
			const sl = el.scrollLeft;
			if (st === 0 && sl === 0) continue;
			const cs = getComputedStyle(el);
			const clipsY = CLIPPING.has(cs.overflowY) && st !== 0;
			const clipsX = CLIPPING.has(cs.overflowX) && sl !== 0;
			if (!clipsY && !clipsX) continue;
			for (const child of el.children) {
				if (!(child instanceof HTMLElement)) continue;
				moved.push({ el: child, prev: child.style.transform });
				const prev = child.style.transform;
				child.style.transform = `translate(${-sl}px, ${-st}px)` + (prev ? ` ${prev}` : '');
			}
		}
		return () => {
			for (const m of moved) m.el.style.transform = m.prev;
		};
	}


	/**
	 * Probe the browser's true max canvas dimension via binary search.
	 * Chrome ≈ 32,767 · Safari ≈ 16,384 · Firefox ≈ 32,767.
	 * Cached after first call.
	 */
	function getMaxCanvasSide(): number {
		if (_maxCanvasSide != null) return _maxCanvasSide;
		try {
			let lo = 4096;
			let hi = 65535;
			while (lo < hi) {
				const mid = Math.ceil((lo + hi + 1) / 2);
				const c = document.createElement('canvas');
				c.width = mid;
				c.height = 1;
				if (c.getContext('2d')) lo = mid;
				else hi = mid - 1;
			}
			_maxCanvasSide = lo;
		} catch {
			_maxCanvasSide = 16384;
		}
		return _maxCanvasSide;
	}

	/**
	 * Render an element to a PNG Blob. For tall elements, renders in
	 * vertical tiles at full 2× quality, then composites onto one canvas.
	 *
	 * Why: html-to-image creates a single SVG <foreignObject> for the
	 * entire element, and its internal checkCanvasDimensions() clamps at
	 * a hardcoded 16,384. Browsers also degrade SVG rasterisation quality
	 * for very large images. Tiling keeps each render small and high-fidelity;
	 * the composite canvas is sized to the browser's real limit (probed
	 * at runtime, not hardcoded).
	 */
	async function renderElement(el: HTMLElement): Promise<Blob> {
		// Full mode renders the WHOLE content, so the outer scroller's own
		// position is irrelevant — but nested overflow panes inside the
		// content must show their live scroll offset, not their origin
		// (2026-10-06 WorkspaceFilePanel flaw). Compensated for the render,
		// restored after.
		const restoreScrollers = compensateNestedScrollers(el);
		try {
			return await renderElementInner(el);
		} finally {
			restoreScrollers();
		}
	}

	/** The historic tiling renderer — body unchanged, now wrapped by
	 *  renderElement for nested-scroll compensation. */
	async function renderElementInner(el: HTMLElement): Promise<Blob> {
		// LAYOUT size, not getBoundingClientRect: PanelsZoom scales the
		// panel row with transform: scale(zoom) (transform-true rect), but
		// html-to-image's clone renders at the element's layout size —
		// pinning the clone to the scaled rect cut the right side off the
		// Plugin Rack capture (2026-10-07). offsetWidth/offsetHeight are
		// transform-blind, so the canvas matches the clone's geometry.
		const w = el.offsetWidth;
		const h = el.offsetHeight;

		// Composite canvas ratio: as close to 2× as the browser allows
		const maxSide = getMaxCanvasSide();
		const ratio = Math.min(DESIRED_RATIO, maxSide / Math.max(w, 1), maxSide / Math.max(h, 1));

		const tileCount = Math.ceil(h / TILE_HEIGHT);

		// Normal-sized element: single pass, skipAutoScale to avoid
		// library's conservative 16384 clamp. The style pin keeps the clone
		// at its live border-box width: Chrome keeps a percentage max-width
		// (max-w-[80%]) UNRESOLVED in the copied computed style, and the
		// foreignObject re-resolves it against the clone's own width — the
		// border box shrank to 80% of the artifact (The Opaque Backing ADR
		// addendum, 2026-09-08).
		if (tileCount <= 1) {
			const blob = await toBlob(el, {
				pixelRatio: ratio,
				backgroundColor: CAPTURE_BACKING,
				skipAutoScale: true,
				style: { width: `${w}px`, maxWidth: 'none', ...UNFIX_ROOT }
			});
			if (!blob) throw new Error('toBlob returned null');
			return blob;
		}

		// Tall element: tile → composite
		const outW = Math.ceil(w * ratio);
		const outH = Math.ceil(h * ratio);

		const canvas = document.createElement('canvas');
		canvas.width = outW;
		canvas.height = outH;
		const ctx = canvas.getContext('2d');
		if (!ctx) throw new Error('Canvas 2D context unavailable');

		ctx.fillStyle = CAPTURE_BACKING;
		ctx.fillRect(0, 0, outW, outH);

		for (let i = 0; i < tileCount; i++) {
			const yOff = i * TILE_HEIGHT;
			const tH = Math.min(TILE_HEIGHT, h - yOff);

			// Render this slice at full 2× — SVG stays small, quality stays high
			// skipAutoScale prevents library's 16384 clamp on the tile canvas
			const tile = await toCanvas(el, {
				pixelRatio: DESIRED_RATIO,
				width: w,
				height: tH,
				style: { ...UNFIX_ROOT, transform: `translateY(-${yOff}px)`, maxWidth: 'none' },
				backgroundColor: CAPTURE_BACKING,
				skipAutoScale: true
			});

			// Draw tile onto the composite at the correct position
			ctx.drawImage(tile, 0, Math.round(yOff * ratio), outW, Math.ceil(tH * ratio));
		}

		return new Promise<Blob>((resolve, reject) => {
			canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('canvas.toBlob failed'))), 'image/png');
		});
	}

	function getCaptureTarget(): HTMLElement | null {
		if (!container) return null;
		// Capture the full scrollable content, not just the visible viewport —
		// but only when the container actually CLIPS (a real scroll container).
		// A visible-overflow box reports content extent as scrollHeight without
		// hiding anything; hijacking to the first child there captured the
		// unstyled inner div and lost the skin entirely (The Opaque Backing
		// ADR, 2026-09-07 — Wave 2 finding on the real app).
		if (
			container.scrollHeight > container.clientHeight &&
			container.firstElementChild instanceof HTMLElement
		) {
			// Whitelist the clipping values — an unset/visible box never hides
			// content, and empty computed values must not read as clipping.
			const CLIPPING = new Set(['auto', 'scroll', 'hidden', 'clip']);
			const cs = getComputedStyle(container);
			if (CLIPPING.has(cs.overflowY) || CLIPPING.has(cs.overflowX)) {
				return container.firstElementChild as HTMLElement;
			}
		}
		return container;
	}

	/**
	 * Visible-mode render: the CONTAINER ITSELF, cropped to its own
	 * visible box — with every descendant scroll container's content
	 * translated UP by its live scrollTop during the clone, so nested
	 * scrollers (the manager's PromptManagerContainer) show what the
	 * operator actually sees, not their scroll origin. html-to-image
	 * clones start at scroll origin and know nothing about scrollTop,
	 * hence the manual compensation. Transforms are applied to the LIVE
	 * DOM for the duration of the render and restored in `finally`.
	 * Single pass — a visible region is never taller than TILE_HEIGHT.
	 */
	async function renderVisible(): Promise<Blob> {
		if (!container) throw new Error('no container');
		const CLIPPING = new Set(['auto', 'scroll', 'hidden', 'clip']);
		const scrollers = [container, ...container.querySelectorAll<HTMLElement>('*')].filter(
			(el) => el.scrollHeight > el.clientHeight + 1 && CLIPPING.has(getComputedStyle(el).overflowY)
		);
		/** Inline-style mutations to undo in finally — prop name + the
		 *  value it held before the render pinned it. */
		const pinned: { el: HTMLElement; prop: string; prev: string }[] = [];
		const moved: { el: HTMLElement; prev: string }[] = [];
		/** Overlays pinned onto scrolled panes during the render (the fake
		 *  track+thumb below); removed in finally. */
		const overlays: HTMLElement[] = [];
		const rootCS = getComputedStyle(document.documentElement);
		const TRACK_BG = rootCS.getPropertyValue('--color-surface').trim() || '#f8f9fa';
		const THUMB_BG = rootCS.getPropertyValue('--color-surface-border').trim() || 'rgba(0,0,0,0.25)';
		for (const el of scrollers) {
			if (el.scrollTop === 0) continue;
			// ALL element children shift, not just the first: scrollers like
			// SidebarSessionList's .group-rows are multi-child flex columns
			// (one child per row + gap) — moving only the first child shifts
			// one row and leaves the rest at their scroll origin (2026-09-19
			// sidebar bug). Transforms don't affect layout, so every child
			// moving by the same offset shifts the whole content wholesale.
			for (const child of el.children) {
				if (!(child instanceof HTMLElement)) continue;
				moved.push({ el: child, prev: child.style.transform });
				child.style.transform = `translateY(-${el.scrollTop}px)`;
			}
			// ── Scrollbar fidelity (2026-09-19 "the thumb lied" bug) ──────
			// html-to-image's clone resets scrollTop to 0, and the browser
			// paints the styled ::-webkit-scrollbar (app.css:95-104, 6px)
			// from the CLONE's scroll position — so a pane scrolled to the
			// bottom captured its thumb at the TOP. The child translation
			// above fixed the content, the thumb stayed at origin.
			// Fix: hide the native bar during the render (compensating its
			// 6px width with padding so nothing reflows) and overlay a fake
			// track+thumb at the LIVE scroll geometry — inline styles and
			// appended nodes survive cloneNode, so the artifact shows the
			// thumb exactly where the operator sees it.
			const cs = getComputedStyle(el);
			const BAR_W = 6; // app.css ::-webkit-scrollbar width
			pinned.push({ el, prop: 'overflowY', prev: el.style.overflowY });
			pinned.push({ el, prop: 'paddingRight', prev: el.style.paddingRight });
			pinned.push({ el, prop: 'position', prev: el.style.position });
			el.style.overflowY = 'hidden';
			el.style.paddingRight = `${parseFloat(cs.paddingRight) + BAR_W}px`;
			if (cs.position === 'static') el.style.position = 'relative';
			const track = document.createElement('div');
			track.style.cssText =
				`position:absolute;top:0;right:0;bottom:0;width:${BAR_W}px;pointer-events:none;background:${TRACK_BG};`;
			const thumb = document.createElement('div');
			const trackH = el.clientHeight;
			const thumbH = Math.max((trackH / el.scrollHeight) * trackH, 24);
			const thumbY = (el.scrollTop / el.scrollHeight) * trackH;
			thumb.style.cssText =
				`position:absolute;right:0;width:${BAR_W}px;border-radius:3px;pointer-events:none;background:${THUMB_BG};top:${thumbY}px;height:${thumbH}px;`;
			track.appendChild(thumb);
			el.appendChild(track);
			overlays.push(track);
		}
		try {
			// Layout size for the same transform-scale reason as full mode
			// (PanelsZoom zoomed the visible box while the clone renders
			// unscaled — 2026-10-07 Plugin Rack capture bug).
			const w = container.offsetWidth;
			const h = container.offsetHeight;
			const blob = await toBlob(container, {
				pixelRatio: DESIRED_RATIO,
				backgroundColor: CAPTURE_BACKING,
				skipAutoScale: true,
				width: w,
				height: h,
				style: { width: `${w}px`, maxWidth: 'none', ...UNFIX_ROOT }
			});
			if (!blob) throw new Error('toBlob returned null');
			return blob;
		} finally {
			for (const m of moved) m.el.style.transform = m.prev;
			for (const p of pinned) (p.el.style as any)[p.prop] = p.prev;
			for (const o of overlays) o.remove();
		}
	}

	async function copyToClipboard(): Promise<void> {
		const blob = mode === 'visible' ? await renderVisible() : await renderElement(getCaptureTarget()!);
		await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
	}

	async function saveAsFile(): Promise<void> {
		const blob = mode === 'visible' ? await renderVisible() : await renderElement(getCaptureTarget()!);
		const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = `canvas-${ts}.png`;
		a.click();
		URL.revokeObjectURL(url);
	}

	async function handleAction(e: MouseEvent): Promise<void> {
		e.stopPropagation();
		if (!container) return;
		state = 'busy';
		try {
			if (e.shiftKey) {
				await saveAsFile();
			} else {
				await copyToClipboard();
			}
			state = 'done';
			setTimeout(() => (state = 'idle'), 2000);
		} catch {
			state = 'idle';
		}
	}
</script>

<button type="button" class="{className}" {title} data-testid="canvas-copy-button" onclick={handleAction}>
	{#if state === 'done'}
		<Check {size} class="text-status-pass" />
	{:else if state === 'busy'}
		<Loader2 {size} class="animate-spin" />
	{:else}
		<CaptureIcon {size} class="text-status-fail" />
	{/if}
</button>
