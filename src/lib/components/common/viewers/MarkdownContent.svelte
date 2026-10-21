<!--
	MarkdownContent — shared markdown renderer (OCI port, 2026-08-22).

	OCI structure, DSI rendering rule: the {@html} sink is fed EXCLUSIVELY
	by renderMarkdown (BC-12 escape-first allow-list pipeline) — no marked,
	no highlight.js. Those are OCI dependencies DSI deliberately does not
	carry; the escape-first subset covers the harness-transcript subset
	pinned by markdown.test.ts.

	Mermaid (2026-08-23): a ```mermaid fence renders as a placeholder div
	(see markdown.ts); this component swaps the SVG in — OCI's render pass,
	better loading: the mermaid runtime (~1.4 MB) is LAZY-imported on the
	first diagram only, code-split off the main bundle (OCI imports it
	statically). The pass is browser-gated so unit tests never load it.
	Table canvas copy (2026-09-05): the HTML arrives as a string, so each
	rendered table gets its hover-revealed CanvasCopyButton through a
	post-render DOM pass (the mermaid pass's pattern): the table is wrapped
	in a relative div and a small image button floats at its top-left.
	Click copies the table as PNG; Shift+Click saves the file.

	Two paths (OCI contract):
	  full    — relative wrapper; when the content looks like markdown, a
	            hover-revealed Copy/Raw pair sits top-right
	  lean    — hideToggle: bare .md-content div, hosts that render their
	            own action row (PromptBubble does)
-->
<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import { themePrefs } from '$lib/utils/theme-prefs.svelte';
	import { t } from '$lib/services/locale/locale-state.svelte';
	import { browser } from '$app/environment';
	import { mount, unmount } from 'svelte';
	import { renderMarkdown } from '$lib/utils/markdown';
	import { isFileLinkHref, normalizeFileLinkPath, parseFileLinkHref } from '$lib/utils/file-link';
	import CanvasCopyButton from '$lib/components/common/buttons/CanvasCopyButton.svelte';
	import CopyButton from '$lib/components/common/buttons/CopyButton.svelte';
	import FileTypeIcon from '$lib/components/common/file-icons/FileTypeIcon.svelte';
	import RawPreviewToggle from './RawPreviewToggle.svelte';

	let {
		content,
		small = false,
		hideToggle = false,
		searchTerm = '',
		onFileLink = undefined
	}: {
		content: string;
		small?: boolean;
		hideToggle?: boolean;
		searchTerm?: string;
		/** File Link Intent (ADR 2026-09-25 D2): when set, clicks on scheme-free
		 *  relative anchors are intercepted (preventDefault) and forwarded as
		 *  workspace-relative paths. Absent = anchors navigate as today. */
		onFileLink?: (path: string) => void;
	} = $props();

	let showRaw = $state(false);
	let containerEl: HTMLDivElement | null = $state(null);

	/** Sanitized HTML — BC-12: allow-listed tags only (never raw input). */
	let renderedHtml = $derived(renderMarkdown(content));

	/** Highlight search term in rendered HTML — AFTER markdown rendering. */
	let highlightedHtml = $derived.by(() => {
		if (!searchTerm.trim()) return renderedHtml;
		const term = searchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
		try {
			const regex = new RegExp(`(?<![<\\w/])(${term})(?![\\w>])`, 'gi');
			return renderedHtml.replace(regex, '<mark class="bg-accent-blue/30 rounded px-0.5">$1</mark>');
		} catch {
			return renderedHtml;
		}
	});

	let textSize = $derived(small ? 'text-xs' : 'text-sm');

	/** Cheap markdown-lookahead so plain text mounts stay lean (OCI parity). */
	let hasMarkdown = $derived(
		content.includes('`') ||
			content.includes('```') ||
			content.includes('#') ||
			content.includes('**') ||
			content.includes('>')
	);

	/** A diagram is waiting only when a mermaid fence is present. */
	let hasMermaid = $derived(/^```mermaid\b/m.test(content));

	/** Mermaid runtime, lazy — the heavy chunk loads on first diagram only. */
	let mermaidMod: Promise<typeof import('mermaid')> | null = null;
	/** Sequence-diagram chrome (2026-10-11): mermaid's 'base' theme left the
	 *  signal text/lines at defaults that failed WCAG in BOTH modes (dim
	 *  gray on white in light, on #16181d in dark). Two full sets. */
	const MERMAID_SEQ_LIGHT = {
		actorBkg: '#DBEAFE',
		actorBorder: '#3B82F6',
		actorTextColor: '#1E293B',
		actorLineColor: '#475569',
		signalColor: '#475569',
		signalTextColor: '#1E293B',
		labelBoxBkColor: '#E2E8F0',
		labelBoxBorderColor: '#64748B',
		labelTextColor: '#1E293B',
		noteBkgColor: '#FEF3C7',
		noteTextColor: '#78350F',
		noteBorderColor: '#F59E0B',
		sequenceNumberColor: '#1E293B'
	};
	const MERMAID_SEQ_DARK = {
		actorBkg: '#1e3a5f',
		actorBorder: '#60a5fa',
		actorTextColor: '#E2E8F0',
		actorLineColor: '#9aa3ad',
		signalColor: '#9aa3ad',
		signalTextColor: '#E2E8F0',
		labelBoxBkColor: '#1d2026',
		labelBoxBorderColor: '#9aa3ad',
		labelTextColor: '#E2E8F0',
		noteBkgColor: '#451a03',
		noteTextColor: '#fbbf24',
		noteBorderColor: '#fbbf24',
		sequenceNumberColor: '#E2E8F0'
	};

	/** The appearance the runtime was last initialized for — re-init on a
	 *  theme flip (the once-only guard froze the first-render palette, the
	 *  operator's 2026-10-11 bug: dim sequence text in light, pastel boxes
	 *  in dark). */
	let mermaidInitTheme: 'light' | 'dark' | null = null;
	/** The appearance the CURRENT container's diagrams were painted under. */
	let renderedTheme: 'light' | 'dark' | null = null;

	/** Zed-style palette (2026-10-06): every flowchart box gets its own
	 *  pastel fill + saturated border instead of the flat neutral gray.
	 *  Implemented as injected classDef/class statements so the author's
	 *  own classDef/style/class lines always win — injection is skipped
	 *  the moment the source styles itself. Pure string work: no mermaid
	 *  import at module scope, unit-testable without the runtime. */
	const MERMAID_PALETTE = [
		['#DBEAFE', '#3B82F6'], // blue
		['#CCFBF1', '#14B8A6'], // teal
		['#EDE9FE', '#8B5CF6'], // violet
		['#DCFCE7', '#22C55E'], // green
		['#FEF3C7', '#F59E0B'], // amber
		['#FCE7F3', '#EC4899'], // pink
		['#FEE2E2', '#EF4444'], // red
		['#E2E8F0', '#64748B'] // slate
	] as const;

	/** Dark twin of the Zed palette (2026-10-10, ADR-0023): deep fills,
	 *  lightened borders, light ink — same hues so a diagram reads as the
	 *  SAME diagram across modes, only re-lit. Chosen per render from the
	 *  html data-theme attribute; a live re-render on toggle is Wave 3's
	 *  panel re-render path, not a mermaid re-init. */
	const MERMAID_PALETTE_DARK = [
		['#1e3a5f', '#60a5fa'], // blue
		['#134e4a', '#2dd4bf'], // teal
		['#3b2a6b', '#a78bfa'], // violet
		['#14532d', '#4ade80'], // green
		['#451a03', '#fbbf24'], // amber
		['#4a1942', '#f472b6'], // pink
		['#450a0a', '#f87171'], // red
		['#1d2026', '#9aa3ad'] // slate
	] as const;

	/** The resolved appearance lives on html[data-theme] (ADR-0023 D1);
	 *  SSR-safe default light. */
	const mermaidDark = (): boolean =>
		typeof document !== 'undefined' && document.documentElement.dataset.theme === 'dark';

	/** Sequence-diagram half of the Zed palette (2026-10-06): mermaid has
	 *  NO classDef for sequence participants — their boxes take the theme's
	 *  single actorBkg, so the injected flowchart classes can't reach them
	 *  (the operator's follow-up complaint: every actor box rendered gray).
	 *  Fix: paint the RENDERED SVG instead — the runtime emits one
	 *  rect.actor per participant; cycle the same palette over them and
	 *  darken the matching labels. Runs after innerHTML lands, before the
	 *  capture button could ever snapshot the box. */
	function paintSequenceColors(host: HTMLElement): void {
		const boxes = host.querySelectorAll<SVGRectElement>('svg rect.actor');
		if (boxes.length === 0) return;
		// Mermaid renders EACH PARTICIPANT TWICE — a header box and a footer
		// box on the same lifeline (the operator's follow-up: top and bottom
		// of one column came out different colors, which reads as two
		// different things). Identity = horizontal position: boxes on the
		// same lifeline share the same center x. Group by that, and assign
		// one color per COLUMN, not per rect.
		const columnColor = new Map<number, readonly [string, string]>();
		const columnOf = (r: SVGRectElement) =>
			Math.round(r.getBBox().x + r.getBBox().width / 2);
		let next = 0;
		for (const rect of boxes) {
			const cx = columnOf(rect);
			if (!columnColor.has(cx)) {
				const palette = mermaidDark() ? MERMAID_PALETTE_DARK : MERMAID_PALETTE;
				columnColor.set(cx, palette[next % palette.length]);
				next++;
			}
			const [fill, stroke] = columnColor.get(cx)!;
			rect.style.fill = fill;
			rect.style.stroke = stroke;
		}
		host.querySelectorAll<SVGTextElement>('svg text.actor').forEach((text) => {
			const bb = text.getBBox();
			const cx = Math.round(bb.x + bb.width / 2);
			// A label may sit a few px off its rect's exact center; snap to
			// the nearest known column.
			let best: number | null = null;
			let bestDist = Infinity;
			for (const cxKey of columnColor.keys()) {
				const d = Math.abs(cxKey - cx);
				if (d < bestDist) {
					bestDist = d;
					best = cxKey;
				}
			}
			if (best === null) return;
			text.style.fill = columnColor.get(best)![1];
			text.style.fontWeight = '600';
		});
	}

	function colorizeMermaid(source: string): string {
		// Respect diagrams that style themselves.
		if (/^\s*(classDef|style|class)\s/m.test(source)) return source;
		if (!/^\s*(flowchart|graph)\b/m.test(source)) return source;
		const ids = new Set<string>();
		for (const line of source.split('\n')) {
			const t = line.trim();
			if (!t || /^(flowchart|graph|subgraph|end|direction|%%)/.test(t)) continue;
			// Node declarations and both ends of an edge: an id followed by
			// a shape opener ([ ( { >). Quoted labels are stripped first, so
			// words inside label text ("host process (dsh web)") are never
			// mistaken for node ids.
			const bare = t.replace(/"[^"]*"/g, '');
			for (const m of bare.matchAll(/(?:^|[\s;])([A-Za-z][A-Za-z0-9_]*)\s*(?=[\[(>{])/g)) {
				ids.add(m[1]);
			}
		}
		if (ids.size === 0) return source;
		const palette = mermaidDark() ? MERMAID_PALETTE_DARK : MERMAID_PALETTE;
		const ink = mermaidDark() ? '#E2E8F0' : '#1E293B';
		const defs = palette.map(
			([fill, stroke], i) => 'classDef zc' + i + ' fill:' + fill + ',stroke:' + stroke + ',color:' + ink + ';'
		).join('\n');
		const assigns = Array.from(ids)
			.map((id, i) => 'class ' + id + ' zc' + (i % MERMAID_PALETTE.length) + ';')
			.join('\n');
		return source + '\n' + defs + '\n' + assigns;
	}

	/** Mounted per-element copy buttons — unmounted on every content change
	 *  (the {@html} swap discards their host DOM; Svelte must hear it). */
	let copyDisposers: (() => void)[] = [];

	/** Complete literal class pairs (Tailwind 4 scans whole names only). */
	const TABLE_COPY_CLASSES = {
		wrap: 'group/table relative',
		host: 'absolute top-0 left-0 opacity-0 group-hover/table:opacity-100 transition-opacity'
	} as const;
	const DIAGRAM_COPY_CLASSES = {
		wrap: 'group/diagram relative',
		host: 'absolute top-0 left-0 opacity-0 group-hover/diagram:opacity-100 transition-opacity'
	} as const;

	/** Wrap one rendered element in a relative div with a hover-revealed
	 *  canvas-copy button at its top-left. Returns the disposer that
	 *  unmounts the button and unwraps the element.
	 *
	 *  The two class pairs are passed as COMPLETE literals, never built by
	 *  concatenation: Tailwind 4's automatic content detection scans source
	 *  text for whole utility names — a 'group-hover/' + group + ':opacity'
	 *  concat leaves only fragments in the source, so the hover utilities
	 *  are never generated and the button stays opacity-0 forever (the
	 *  2026-09-05 regression this signature exists to prevent). */
	function attachCopyButton(
		el: HTMLElement,
		classes: { wrap: string; host: string },
		title: string
	): () => void {
		const wrap = document.createElement('div');
		wrap.className = classes.wrap;
		const host = document.createElement('div');
		host.className = classes.host;
		el.parentNode?.insertBefore(wrap, el);
		wrap.appendChild(el);
		wrap.appendChild(host);
		const btn = mount(CanvasCopyButton, {
			target: host,
			props: {
				container: el,
				title,
				size: 12,
				class:
					'p-1 rounded-md bg-surface/60 border border-surface-border/50 text-text-muted hover:text-text-primary hover:bg-surface-hover'
			}
		});
		return () => {
			unmount(btn);
			// Unwrap: the element returns to its place, wrapper and host go.
			wrap.replaceWith(el);
			wrap.remove();
		};
	}

	/** Give every rendered table and mermaid diagram its own canvas-copy
	 *  button (top-left, hover-revealed): each rides inside a relative
	 *  wrapper so the button anchors to its own box, not the whole block.
	 *  The mermaid pass swaps the SVG INSIDE the .mermaid-diagram div, so a
	 *  button attached to the placeholder captures the rendered diagram. */
	$effect(() => {
		// Depend on the HTML so a content change re-runs the pass.
		void highlightedHtml;
		copyDisposers.forEach((dispose) => dispose());
		copyDisposers = [];
		if (!containerEl) return;
		for (const table of Array.from(containerEl.querySelectorAll('table'))) {
			copyDisposers.push(
				attachCopyButton(table, TABLE_COPY_CLASSES, 'Copy table as image (Shift+Click to save)')
			);
		}
		for (const diagram of Array.from(containerEl.querySelectorAll('.mermaid-diagram'))) {
			copyDisposers.push(
				attachCopyButton(
					diagram as HTMLElement,
					DIAGRAM_COPY_CLASSES,
					'Copy diagram as image (Shift+Click to save)'
				)
			);
		}
	});

	/** A feature-spec lead renders as bold 'feature-spec: ' — flag the whole
	 *  block for the top-right canvas copy (2026-09-05). Detected on the
	 *  RENDERED html so both '**feature-spec:' markdown and any future
	 *  allow-listed strong lead land the same button. */
	let hasFeatureSpec = $derived(renderedHtml.includes('<strong>feature-spec: '));

	/** Lean path (hideToggle): hosts render their own action rows, so the
	 *  feature-spec copy button attaches through a small DOM pass — the
	 *  container itself becomes the positioning anchor. Classes are
	 *  complete literals (Tailwind 4 scans whole names only — the
	 *  2026-09-05 concat regression's rule). */
	let featureSpecDispose: (() => void) | null = null;
	$effect(() => {
		featureSpecDispose?.();
		featureSpecDispose = null;
		if (!hideToggle || !containerEl || !hasFeatureSpec) return;
		const mdEl = containerEl;
		mdEl.classList.add('relative', 'group/featurespec');
		const host = document.createElement('div');
		host.className =
			'absolute top-1.5 right-1.5 opacity-0 group-hover/featurespec:opacity-100 transition-opacity';
		containerEl.appendChild(host);
		const btn = mount(CanvasCopyButton, {
			target: host,
			props: {
				container: mdEl,
				title: 'Copy feature spec as image (Shift+Click to save)',
				size: 12,
				class:
					'p-1 rounded-md bg-surface/60 border border-surface-border/50 text-text-muted hover:text-text-primary hover:bg-surface-hover'
			}
		});
		featureSpecDispose = () => {
			unmount(btn);
			host.remove();
			mdEl.classList.remove('relative', 'group/featurespec');
		};
	});

	/** File Link Intent (ADR 2026-09-25 D2): delegated capture-phase click
	 *  listener. Without the prop this component changes NOTHING — anchors
	 *  keep native navigation. With it, scheme-free relative anchors
	 *  preventDefault and forward the RAW href — the consumer parses the
	 *  path AND the #L line anchor out of it (parseFileLinkHref), so the
	 *  anchor must survive this seam. Everything else (external, /api/,
	 *  '..', escaped) keeps native behavior. */
	$effect(() => {
		const el = containerEl;
		if (!el || !onFileLink) return;
		const onClick = (event: MouseEvent) => {
			const anchor = (event.target as HTMLElement | null)?.closest('a');
			if (!anchor) return;
			const href = anchor.getAttribute('href');
			if (!href || !isFileLinkHref(href)) return;
			if (normalizeFileLinkPath(href) === null) return;
			event.preventDefault();
			onFileLink(href);
		};
		el.addEventListener('click', onClick, true);
		return () => el.removeEventListener('click', onClick, true);
	});

	/** Fullpath Bow ADR 2026-09-26 D2: decorate each file-link anchor with
	 *  the extension glyph — the SAME FileTypeIcon the explorer tree rows
	 *  render (WorkspaceExplorerTree.svelte), imported, never duplicated.
	 *  Idempotent over a WeakSet (the mermaid pass's discipline); re-runs
	 *  when the rendered HTML changes; markdown.ts stays pure — this is a
	 *  DOM post-pass, never renderer output. */
	const iconDecorated = new WeakSet<HTMLAnchorElement>();
	let iconInstances: Record<string, unknown>[] = [];
	$effect(() => {
		void highlightedHtml;
		const el = containerEl;
		if (!el || !onFileLink) return;
		const created: Record<string, unknown>[] = [];
		for (const anchor of Array.from(el.querySelectorAll<HTMLAnchorElement>('a[href]'))) {
			const href = anchor.getAttribute('href') ?? '';
			if (!isFileLinkHref(href) || iconDecorated.has(anchor)) continue;
			const path = parseFileLinkHref(href).path;
			const name = path.split('/').pop() ?? '';
			if (name === '') continue;
			const iconHost = document.createElement('span');
			iconHost.className = 'flink-icon';
			iconHost.setAttribute('aria-hidden', 'true');
			// inline with the link text — a bare span/svg box wraps the anchor
			iconHost.style.cssText = 'display:inline-flex;align-items:center;vertical-align:-2px;margin-right:4px';
			anchor.style.display = 'inline-flex';
			anchor.style.alignItems = 'center';
			created.push(mount(FileTypeIcon, { target: iconHost, props: { name, size: 14 } }));
			anchor.prepend(iconHost);
			iconDecorated.add(anchor);
		}
		iconInstances = created;
		return () => {
			for (const instance of iconInstances) unmount(instance);
			iconInstances = [];
		};
	});

	/** External-link host icon (2026-09-27): every http(s) anchor gets the
	 *  host's favicon (DuckDuckGo icon service) prepended — gitlab.com shows
	 *  the GitLab mark, github.com the octocat, etc. Same DOM post-pass
	 *  discipline as the file-link pass above: idempotent WeakSet, re-runs on
	 *  content change, markdown.ts stays pure. Images are 14px, lazy, and
	 *  referrerpolicy-hardened; a failed load just leaves the plain link. */
	const extIconDecorated = new WeakSet<HTMLAnchorElement>();
	$effect(() => {
		void highlightedHtml;
		const el = containerEl;
		if (!el) return;
		for (const anchor of Array.from(el.querySelectorAll<HTMLAnchorElement>('a[href]'))) {
			if (extIconDecorated.has(anchor)) continue;
			extIconDecorated.add(anchor);
			const href = anchor.getAttribute('href') ?? '';
			let host = '';
			try {
				const u = new URL(href, location.origin);
				if (!/^https?:$/.test(u.protocol) || u.host === location.host) continue;
				host = u.hostname;
			} catch {
				continue;
			}
			const icon = document.createElement('img');
			icon.className = 'elink-icon';
			// Google s2 (verified 2026-09-27: gitlab.com returns the official
			// tanuki mark); DDG's ip3 service proved flaky (TLS + wrong marks).
			icon.src = `https://www.google.com/s2/favicons?domain=${host}&sz=64`;
			icon.alt = '';
			icon.width = 14;
			icon.height = 14;
			icon.loading = 'lazy';
			icon.referrerPolicy = 'no-referrer';
			icon.style.cssText = 'display:inline-block;vertical-align:-2px;margin-right:4px';
			anchor.prepend(icon);
		}
	});

	/** Render every unprocessed placeholder in this container (OCI pass). */
	$effect(() => {
		// Depend on the HTML AND the resolved appearance: a theme flip
		// re-runs the pass with the other palette (ADR-0023, 2026-10-11).
		void highlightedHtml;
		void themePrefs.resolved;
		if (!browser || !containerEl || !hasMermaid) return;
		if (renderedTheme !== null && renderedTheme !== themePrefs.resolved) {
			// appearance flipped since the last render: repaint every
			// placeholder with the other palette
			for (const d of Array.from(containerEl.querySelectorAll('.mermaid-diagram'))) {
				d.setAttribute('data-processed', 'false');
			}
		}

		const els = containerEl.querySelectorAll<HTMLDivElement>(
			'.mermaid-diagram[data-processed="false"]'
		);
		if (els.length === 0) return;

		let cancelled = false;
		void (async () => {
			mermaidMod ??= import('mermaid');
			const mermaid = (await mermaidMod).default;
			if (mermaidInitTheme !== themePrefs.resolved) {
				mermaid.initialize({
					startOnLoad: false,
					// 'base' + variables (2026-10-06): lets the injected
					// Zed-style classDefs show through, keeps the canvas
					// transparent over any surface, and drops the mono
					// diagram font for the app's own sans stack.
					theme: 'base',
					themeVariables: {
						background: 'transparent',
						// ADR-0023 (2026-10-10): the base diagram chrome follows
						// the resolved appearance; injected classDefs carry the
						// per-node palette. Initialize runs once — the theme at
						// first diagram wins until the next full render.
						primaryColor: mermaidDark() ? '#1d2026' : '#E2E8F0',
						primaryBorderColor: mermaidDark() ? '#9aa3ad' : '#64748B',
						primaryTextColor: mermaidDark() ? '#E2E8F0' : '#1E293B',
						lineColor: mermaidDark() ? '#9aa3ad' : '#64748B',
						fontFamily: 'ui-sans-serif, system-ui, sans-serif'
					},
					securityLevel: 'strict'
				});
				mermaidInitTheme = themePrefs.resolved;
			}
			for (const el of Array.from(els)) {
				if (cancelled) return;
				const encoded = el.dataset.source;
				if (!encoded) continue;
				const source = new TextDecoder().decode(
					Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0))
				);
				try {
					const id = `mmd-${Math.random().toString(36).slice(2, 8)}`;
					// Zed-style per-box colors: inject the palette classDefs
					// just before render (a no-op for self-styled diagrams).
					const { svg } = await mermaid.render(id, colorizeMermaid(source));
					el.innerHTML = svg;
					paintSequenceColors(el);
					el.setAttribute('data-processed', 'true');
				} catch (err) {
					el.innerHTML = `<div class="text-xs text-status-fail p-2 border border-status-fail/30 rounded bg-status-fail/10">Mermaid render error: ${String(err).split('\n')[0]}</div>`;
					el.setAttribute('data-processed', 'true');
				}
			}
			renderedTheme = themePrefs.resolved;
		})();

		return () => {
			cancelled = true;
		};
	});
</script>

{#if hideToggle}
	<!-- Lean path: no wrapper div, no toggle UI -->
	<div class="md-content {textSize} leading-relaxed break-words" bind:this={containerEl}>
		<!-- eslint-disable-next-line svelte/no-at-html-tags — BC-12: sanitized util output only -->
		{@html highlightedHtml}
	</div>
{:else}
	<!-- Full path: with relative wrapper for toggle button -->
	<div class="relative group/markdown">
		{#if showRaw}
			<pre
				class="{textSize} leading-relaxed whitespace-pre-wrap break-words font-mono text-text-secondary"
				data-testid="markdown-raw"
			>{content}</pre>
		{:else}
			<div class="md-content {textSize} leading-relaxed break-words" bind:this={containerEl}>
				<!-- eslint-disable-next-line svelte/no-at-html-tags — BC-12: sanitized util output only -->
				{@html highlightedHtml}
			</div>
		{/if}

		{#if hasMarkdown || hasFeatureSpec}
			<div
				class="absolute top-1.5 right-1.5 flex gap-1 opacity-0 group-hover/markdown:opacity-100 transition-opacity"
			>
				{#if hasFeatureSpec}
					<CanvasCopyButton
						container={containerEl}
						title={t(m.copySpecImage)}
						size={12}
						class="p-1 rounded-md bg-surface/60 border border-surface-border/50 text-text-muted hover:text-text-primary hover:bg-surface-hover"
					/>
				{/if}
				{#if hasMarkdown}
					<CopyButton
						value={content}
						title={t(m.copyMarkdown)}
						size={12}
						class="p-1 rounded-md bg-surface/60 border border-surface-border/50 text-text-muted hover:text-text-primary hover:bg-surface-hover"
					/>
					<RawPreviewToggle bind:showRaw />
				{/if}
			</div>
		{/if}
	</div>
{/if}
