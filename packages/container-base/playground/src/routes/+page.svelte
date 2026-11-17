<script lang="ts">
	import { onMount } from 'svelte';
	import '@deepseek-insight/container-base/theme/tokens.css';
	import {
		createThemePrefs,
		createLocalePrefs,
		createPrefsStore,
		ThemeToggle,
		LanguageMenu,
		SliderWidth,
		SliderZoom,
		SidebarContainer,
		PanelsZoom,
		PaneBase,
		ResizeGutter,
		WidthBadge,
		PanelHeaderSkeleton,
		PanelClose,
		CanvasCopyButton,
		SidebarCollapseButton,
		resizeOne,
		createGutterResize,
		definePanelKind,
		revivePanels,
		clampKindWidth,
		CONTAINER_BASE_VERSION
	} from '@deepseek-insight/container-base';
	import type { ThemeChoice } from '@deepseek-insight/container-base';
	import MonitorIcon from '../lib/MonitorIcon.svelte';
import { liveBadgePhases, settleBadgePhases, BADGE_AFTERGLOW_MS, type BadgePhaseMap } from '../lib/badge-phases';
	import LanguagesIcon from '../lib/LanguagesIcon.svelte';
	import SunIcon from '../lib/SunIcon.svelte';
	import MoonIcon from '../lib/MoonIcon.svelte';

	// The playground's OWN lamp identity: key 'pg-theme' (never dsi-theme).
	const prefs = createThemePrefs({ baseKey: 'pg-theme' });
	onMount(() => {
		prefs.adopt();
		localePrefs.adopt();
	});

	const icons = { system: MonitorIcon, light: SunIcon, dark: MoonIcon };

	// The playground's OWN locale identity: key/cookie 'pg-locale'
	// (ADR-0065 D9 grammar; the dot form was the drift the law exists for).
	// Tiny inline dictionaries — the base never translates (D3).
	const localePrefs = createLocalePrefs({
		baseKey: 'pg-locale',
		cookieName: 'pg-locale',
		locales: ['en', 'zh', 'id'],
		defaultLocale: 'en'
	});
	// NOTE: no profile threading here ANYMORE — the base owns the read.
	// createPrefsStore auto-resolves an omitted profile from ?profile via
	// the namespace resolver (ADR-0065 R4), so this page stays address-blind:
	// ?profile=wh lands in pg-panels_wh with zero page code.
	// The demo floor (G2): three panels inside PanelsZoom, each column a
	// PaneBase sized by the Width slider; zoom scales the whole row.
	// (Declared ABOVE the stores: the store defaults/revive closures read it.)
	type DemoPane = { id: string; title: string; body: string };
	// D6 (ADR-0066): closed panes + capture targets ride the demo state —
	// the header hosts the title; PanelClose + CanvasCopyButton are its actions.
	const closed = $state<Record<string, boolean>>({});
	// REACTIVE: the header actions snippet captures container at render —
	// a plain object would freeze it as undefined before bind:this lands.
	const paneBodies = $state<Record<string, HTMLElement | null>>({});
	const demoPanes: DemoPane[] = [
		{ id: 'notes', title: 'Notes', body: 'A demo pane riding the base floor.' },
		{ id: 'scheduler', title: 'Scheduler', body: 'Three panes prove the zoom frame.' },
		{ id: 'sessions', title: 'Sessions', body: 'Width and zoom come from pg-panels.' }
	];
	const demoKind = definePanelKind({
		kind: 'demo-pane',
		requiredKeys: (entry) => typeof entry['id'] === 'string',
		revive: (entry) => ({ id: entry['id'] as string, width: entry['width'] as number | undefined }),
		laneDefaultWidth: 730,
		band: () => ({ min: 280, max: 1400 }),
		persisted: true
	});
	// The knob declaration: a junk stored width falls to the lane default,
	// a valid one clamps through the kind's own band — the base law.
	const demoWidthKnob = { key: 'width', default: 730, clamp: (w: number) => clampKindWidth(w, demoKind) };
	// Sliders over the playground's OWN prefs store (base owns the
	// mechanism, the consumer owns the blob). The blob is now PANEL ENTRIES
	// with the universal required keys (id + kind, ADR-0065 design §2) —
	// no raw width arrays, no revive-time shape fabrication. Junk rows
	// drop, junk widths default, valid widths clamp through the demo band,
	// and selectedPanelId cross-checks per D3 — all one revivePanels call.
	const sliderPrefs = createPrefsStore<{
		zoom: number;
		panelWidth: number;
		selectedPanelId: string | null;
		panels: { id: string; kind: string; width: number }[];
	}>(
		{
			key: 'pg-panels',
			defaults: () => ({
				zoom: 1,
				panelWidth: 730,
				selectedPanelId: demoPanes[0].id,
				panels: demoPanes.map((p) => ({ id: p.id, kind: 'demo-pane', width: 730 }))
			}),
			revive: (raw) => {
				const rec = raw as {
					zoom?: unknown;
					panelWidth?: unknown;
					selectedPanelId?: unknown;
					panels?: unknown;
				};
				if (typeof rec.zoom !== 'number' || !Number.isFinite(rec.zoom)) return null;
				const revived = revivePanels<{ id: string; kind: string; width: number }>(
					rec.panels,
					[demoKind],
					[demoWidthKnob],
					{
						rawSelectedId: rec.selectedPanelId,
						crossCheckSelected: (rawId, panels) =>
							panels.some((p) => p.id === rawId) ? rawId : (panels[0]?.id ?? null)
					}
				);
				if (revived.panels.length === 0) return null;
				const panelWidth =
					typeof rec.panelWidth === 'number' && Number.isFinite(rec.panelWidth)
						? clampKindWidth(rec.panelWidth, demoKind)
						: 730;
				return {
					zoom: rec.zoom as number,
					panelWidth,
					selectedPanelId: revived.selected as string | null,
					panels: revived.panels
				};
			}
		}
	)
	;
	// Pre-paint hand-off (ADR-0067 via the base's panelsBootScript): the
	// generated inline block already read pg-panels[_profile] BEFORE paint
	// and left the raw string in the __BOOT_PREFS register. Re-materialize
	// it so the ONE load path below (the base store — still the only
	// parser) restores the saved desk on the first client render.
	if (typeof window !== 'undefined') {
		const boot = (window as { __BOOT_PREFS?: Record<string, { raw?: unknown } | undefined> }).__BOOT_PREFS?.[
			'pg-panels'
		];
		if (boot && typeof boot.raw === 'string' && boot.raw.length > 0 && localStorage.getItem('pg-panels') === null) {
			localStorage.setItem('pg-panels', boot.raw);
		}
	}
	const loaded = sliderPrefs.load();
	let width = $state(loaded.panelWidth);
	let zoom = $state(loaded.zoom);
	function commitWidth(): void {
		// DSI's honest-slider semantic: the width slider is the row PRESET —
		// it syncs EVERY pane to the width (the all-equal preset; the gutters
		// then diverge individual panes until the next preset sync).
		paneWidths = demoPanes.map(() => ({ width }));
		// real id + kind on every entry (design §2); zoom commits widths untouched
		sliderPrefs.save({
			zoom,
			panelWidth: width,
			selectedPanelId,
			panels: paneWidths.map((p, i) => ({ id: demoPanes[i].id, kind: 'demo-pane', width: p.width }))
		});
	}
	function commitZoom(): void {
		// Zoom commits ZOOM ONLY — the pane widths stay exactly as recorded
		// (SSC#2 lesson: sharing one commit made every zoom move reset the
		// widths the gutters had set).
		// real id + kind on every entry (design §2); zoom commits widths untouched
		sliderPrefs.save({
			zoom,
			panelWidth: width,
			selectedPanelId,
			panels: paneWidths.map((p, i) => ({ id: demoPanes[i].id, kind: 'demo-pane', width: p.width }))
		});
	}

	// Demo sidebar state (page-owned, per the ownership split the base
	// container codifies): collapse lives in the pg-sidebar prefs (seeded
	// below); these are the demo section labels.
	const demoSections = ['sessions', 'scheduler'] as const;

	// Per-pane widths (SSC#2 G6 follow-up): the demo drag owns the gutter -
	// DSI's protocol in miniature: snapshot on mousedown, resizeOne per move,
	// persist on mouseup. Clamped through demoKind's band (280..1400) —
	// the declaration is the ONE band site (ADR-0065 W4).
	let paneWidths = $state<{ width: number }[]>(
		demoPanes.map(
			(p) => ({ width: loaded.panels.find((e) => e.id === p.id)?.width ?? loaded.panelWidth })
		)
	);
	const panels = $derived(demoPanes.map((p, i) => ({ id: p.id, width: paneWidths[i]?.width })));
	// Drag state is deliberately NOT $state: mousemove never renders it - the
	// width writes do. Snapshot + start x captured at gutter mousedown.
	let dragSnapshot: number[] = [];
	let dragStartX = 0;
	let dragIndex = -1;
	// The resize chip's phase map (page-owned; the chip renders it, the drag
	// machine writes it — same split DSI's floor-reads runs). fading entries
	// persist through BADGE_AFTERGLOW_MS then drop.
	let badgePhases = $state<BadgePhaseMap>({});
	const badgeTimers: Record<string, ReturnType<typeof setTimeout>> = {};
	function onGutterDown(e: MouseEvent, index: number): void {
		dragSnapshot = paneWidths.map((p) => p.width);
		dragStartX = e.clientX;
		dragIndex = index;
	}
	function onWindowMouseMove(e: MouseEvent): void {
		if (dragIndex < 0) return;
		const delta = e.clientX - dragStartX;
		// the drag clamp reads the declaration's band (D5) — one band site
		paneWidths = resizeOne(paneWidths, dragSnapshot, dragIndex, delta, (w) =>
			clampKindWidth(w, demoKind)
		);
		// badge phases: live for every pane whose width differs from the
		// snapshot (floor-reads badgeByPanelId semantics, mirrored)
		badgePhases = liveBadgePhases(demoPanes.map((p) => p.id), paneWidths.map((p) => p.width), dragSnapshot);
	}
	function onWindowMouseUp(): void {
		if (dragIndex < 0) return;
		dragIndex = -1;
		// afterglow: every live pane goes fading for the chip's 10s window,
		// then drops (the fade itself is the chip's own CSS transition)
		for (const id of settleBadgePhases(badgePhases)) {
			badgePhases[id] = 'fading';
			clearTimeout(badgeTimers[id]);
			badgeTimers[id] = setTimeout(() => {
				delete badgePhases[id];
				delete badgeTimers[id];
			}, BADGE_AFTERGLOW_MS);
		}
		// real id + kind on every entry (design §2); zoom commits widths untouched
		sliderPrefs.save({
			zoom,
			panelWidth: width,
			selectedPanelId,
			panels: paneWidths.map((p, i) => ({ id: demoPanes[i].id, kind: 'demo-pane', width: p.width }))
		});
	}
	let selectedPanelId = $state<string | null>(demoPanes[0].id);
	// Initialize-on-mount (the DSI contract, ADR-0065 R4 fix): the keys EXIST
	// the moment the page opens — a profiled URL gets its suffixed keys with
	// defaults written, no interaction required. Load-then-save is also a
	// normalization pass: a revived blob is re-clamped before its first write.
	sliderPrefs.save({ zoom, panelWidth: width, selectedPanelId, panels: paneWidths.map((p, i) => ({ id: demoPanes[i].id, kind: 'demo-pane', width: p.width })) });

	// The sidebar's OWN prefs (SSC#2 gutter bug): the playground page owns
	// width + collapse and persists them under pg-sidebar, so a drag
	// survives hard-reload — the same contract DSI runs under dsi-sidebar.
	const sidebarPrefs = createPrefsStore<{ width: number; collapsed: boolean }>({
		key: 'pg-sidebar',
		defaults: () => ({ width: 260, collapsed: false }),
		revive: (raw) => {
			const rec = raw as { width?: unknown; collapsed?: unknown };
			if (typeof rec.width !== 'number' || typeof rec.collapsed !== 'boolean') return null;
			return { width: rec.width, collapsed: rec.collapsed };
		}
	});
	const loadedSidebar = sidebarPrefs.load();
	// Initialize-on-mount: the suffixed sidebar key exists on first open (same
	// DSI contract as the panels key above) — no interaction required.
	sidebarPrefs.save({ width: loadedSidebar.width, collapsed: loadedSidebar.collapsed });
	let sidebarWidth = $state(loadedSidebar.width);
	let sidebarCollapsed = $state(loadedSidebar.collapsed);
	// The sidebar drag runs the BASE machine (createGutterResize) — the
	// same skeleton DSI's sidebar runs. Snapshot/delta/clamp/listener
	// lifecycle live in the base; the page only applies + persists.
	// Sidebar badge phase (task 2.3, ADR-0062 D10): one key, own snapshot —
	// the pane badgePhases map keys pane ids, never mixed with this.
	// Same grammar as the pane map / floor-reads badgeByPanelId: live on
	// snapshot delta, fading through BADGE_AFTERGLOW_MS (the chip's own
	// CSS transition does the fade), then drop.
	let sidebarDragSnapshot = 0;
	let sidebarBadgePhase = $state<'live' | 'fading' | null>(null);
	let sidebarBadgeTimer: ReturnType<typeof setTimeout> | undefined;
	const sidebarResize = createGutterResize({
		onStart: () => {
			sidebarDragSnapshot = sidebarWidth;
			return sidebarWidth;
		},
		clamp: (w) => Math.min(600, Math.max(200, w)),
		onResize: (w) => {
			sidebarWidth = w;
			if (sidebarWidth !== sidebarDragSnapshot) sidebarBadgePhase = 'live';
		},
		onSettle: () => {
			if (sidebarBadgePhase === 'live') {
				sidebarBadgePhase = 'fading';
				clearTimeout(sidebarBadgeTimer);
				sidebarBadgeTimer = setTimeout(() => {
					sidebarBadgePhase = null;
				}, BADGE_AFTERGLOW_MS);
			}
			saveSidebar();
		}
	});
	function saveSidebar(): void {
		sidebarPrefs.save({ width: sidebarWidth, collapsed: sidebarCollapsed });
	}
	function toggleSidebar(): void {
		sidebarCollapsed = !sidebarCollapsed;
		saveSidebar();
	}

	const LANGUAGES: Record<string, string> = { en: 'English', zh: '中文', id: 'Bahasa Indonesia' };
	const GREETINGS: Record<string, string> = { en: 'Hello floor', zh: '你好地板', id: 'Halo lantai' };
	const labels: Record<ThemeChoice, string> = { system: 'System', light: 'Light', dark: 'Dark' };
</script>

<svelte:window
	onmousemove={onWindowMouseMove}
	onmouseup={onWindowMouseUp}
/>

<div class="shell">
	<div class="sidebar-col" data-testid="pg-sidebar-host">
		<SidebarContainer
			collapsed={sidebarCollapsed}
			width={sidebarWidth}
			gutterLabel="Resize sidebar"
			onResizeStart={(e) => sidebarResize.start(e)}
		>
			{#snippet badge()}
				{#if sidebarBadgePhase}
					<WidthBadge phase={sidebarBadgePhase} width={sidebarWidth} testid="pg-sidebar-width-badge" />
				{/if}
			{/snippet}
			{#snippet header()}
				<div class="demo-header">
					<span>Demo</span>
					<SidebarCollapseButton class="hdr-btn" testid="pg-sidebar-toggle" onToggle={toggleSidebar} />
				</div>
			{/snippet}
			{#snippet collapsedContent()}
				<SidebarCollapseButton collapsed={true} class="restore-btn" testid="pg-sidebar-restore" onToggle={toggleSidebar} />
			{/snippet}
			<div class="demo-sections">
				{#each demoSections as s (s)}
					<div class="demo-section">{s}</div>
				{/each}
			</div>
			<div class="sidebar-status">
				<p data-testid="package-version">{CONTAINER_BASE_VERSION}</p>
				<p data-testid="theme-choice">{prefs.choice} · {prefs.resolved}</p>
				<p data-testid="locale-choice">{localePrefs.locale}</p>
				<p data-testid="greeting">{GREETINGS[localePrefs.locale] ?? GREETINGS.en}</p>
			</div>
			<div class="sidebar-controls">
				<SliderWidth
					bind:value={width}
					oncommit={commitWidth}
					ariaLabel="Panel width"
					testId="pg-slider-width"
				>
					{#snippet caption(v)}
						<span>Width</span>
						<span class="num">{v}px</span>
					{/snippet}
				</SliderWidth>
				<SliderZoom
					bind:value={zoom}
					oncommit={commitZoom}
					ariaLabel="Floor zoom"
					testId="pg-slider-zoom"
				>
					{#snippet caption(v)}
						<span>Zoom</span>
						<span class="num">{Math.round(v * 100)}%</span>
					{/snippet}
				</SliderZoom>
				<div class="menus">
					<LanguageMenu
						prefs={localePrefs}
						locales={['en', 'zh', 'id']}
						labels={LANGUAGES}
						triggerLabel="Language"
						icon={LanguagesIcon}
						dropUp
					/>
					<ThemeToggle {prefs} triggerLabel="Theme" optionLabels={labels} {icons} dropUp />
				</div>
			</div>
		</SidebarContainer>
	</div>
	<main class="floor">
		<PanelsZoom {zoom} {panels} {selectedPanelId}>
			{#each demoPanes as pane, i (pane.id)}
				<PaneBase
					width={paneWidths[i]?.width ?? width}
					paneId={pane.id}
					selected={selectedPanelId === pane.id}
					onactivate={() => (selectedPanelId = pane.id)}
				>
					{#snippet header()}
						<PanelHeaderSkeleton title={pane.title}>
							{#snippet leading()}
								<span class="pane-title">{pane.title}</span>
							{/snippet}
							{#snippet actions()}
								<CanvasCopyButton container={paneBodies[pane.id]} mode="visible" size={14} class="hdr-btn" />
								<PanelClose sessionId={pane.id} onremove={() => (closed[pane.id] = true)} />
							{/snippet}
						</PanelHeaderSkeleton>
						{#if badgePhases[pane.id]}
							<WidthBadge phase={badgePhases[pane.id]} width={paneWidths[i]?.width ?? width} testid="pg-width-badge-{pane.id}" />
						{/if}
					{/snippet}
					<div class="pane-body" bind:this={paneBodies[pane.id]}>{pane.body}</div>
				</PaneBase>
				<!-- G6 (SSC#2): the drag seam AFTER each column, the DSI
				     PanelColumn composition — the demo page owns the drag:
				     snapshot, resizeOne per move, persist on mouseup. -->
				<ResizeGutter index={i} ariaLabel="Resize panel" title="Drag to resize" onGutterDown={(e) => onGutterDown(e, i)} />
			{/each}
		</PanelsZoom>
	</main>
</div>

<style>
	/* The playground's OWN token set — the consumer overrides every var the
	 * base reads (tokens.css gives light defaults; dark is ours here). */
	:global(html[data-theme='dark']) {
		--color-surface-primary: #10131a;
		--color-surface-secondary: #1b202b;
		--color-surface-elevated: #171c26;
		--color-surface-border: #2a3140;
		--color-text-primary: #e8eaf0;
		--color-text-secondary: #9aa3b2;
		--color-accent-purple: #c084fc;
	}
	/* the floor is a full-viewport app — the UA's default 8px body margin
	 * pushed the 100vh shell 8px down and spawned a 16px page scrollbar */
	:global(body) {
		margin: 0;
	}
	/* DSI-like shell: sidebar is the FIRST column, the floor fills the rest. */
	.shell {
		display: flex;
		height: 100vh;
		overflow: hidden;
		background: var(--color-surface-primary);
		color: var(--color-text-primary);
		font-family: system-ui, sans-serif;
	}
	.sidebar-col {
		display: flex;
		min-height: 0;
	}
	.sidebar-col :global(.cb-sidebar-wrap),
	.sidebar-col :global(.cb-sidebar) {
		height: 100%;
	}
	/* :global — the button root belongs to the package organ now */
	:global(.restore-btn) {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 26px;
		height: 26px;
		padding: 0;
		border: 1px solid var(--color-surface-border);
		border-radius: 0.25rem;
		background: var(--color-surface-secondary);
		color: var(--color-text-secondary);
		cursor: pointer;
	}
	.restore-btn:hover {
		color: var(--color-text-primary);
	}
	.demo-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 0.5rem;
		font-weight: 600;
		border-bottom: 1px solid var(--color-surface-border);
	}
	.demo-sections {
		border-bottom: 1px solid var(--color-surface-border);
	}
	.demo-section {
		padding: 0.5rem;
		font-size: 0.8rem;
		color: var(--color-text-secondary);
	}
	.sidebar-status {
		padding: 0.5rem;
		font-size: 0.8rem;
		color: var(--color-text-secondary);
	}
	.sidebar-status p {
		margin: 0.15rem 0;
	}
	.sidebar-controls {
		margin-top: auto;
		padding: 0.5rem;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		color: var(--color-text-secondary);
	}
	.menus {
		display: flex;
		gap: 0.75rem;
		align-items: center;
		/* DSI's header action cluster sits at the rail's RIGHT edge, so the
		 * menus' right-anchored popups (right: 0) open INSIDE the rail —
		 * left-aligned triggers made the popups extend past the sidebar's
		 * left edge and get clipped by its overflow:hidden. */
		justify-content: flex-end;
	}
	.num {
		font-variant-numeric: tabular-nums;
		color: var(--color-text-primary);
	}
	/* The floor: PanelsZoom is the content area. */
	.floor {
		display: flex;
		flex: 1;
		min-width: 0;
		min-height: 0;
		flex-direction: column;
	}
	.pane-title {
		font-weight: 600;
		font-size: 0.85rem;
	}

	/* The playground's own dressing for the promoted header organs — the
	 * base ships no skin (ground rule), so the consumer styles them. This
	 * mirrors DSI PanelHeader's .hdr-btn (SC#2 look) consumer-side. */
	:global(.hdr-btn) {
		flex-shrink: 0;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 1.375rem; /* 22px — the DSI PanelHeader box */
		height: 1.375rem;
		border: none;
		border-radius: 0.25rem;
		background: transparent;
		color: var(--color-text-secondary);
		cursor: pointer;
	}
	:global(.hdr-btn:hover),
	:global(.hdr-btn:focus-visible) {
		background: var(--color-surface-secondary);
		color: var(--color-text-primary);
	}
	:global(.hdr-btn:disabled) {
		opacity: 0.5;
		cursor: not-allowed;
	}
	/* the close button carries a bordered white square at idle (SC#2) */
	:global(.hdr-btn[data-testid='panel-close']) {
		background: var(--color-surface-elevated, #fff);
		border: 1px solid var(--color-surface-border);
	}
	.pane-body {
		padding: 0.75rem;
		font-size: 0.85rem;
		color: var(--color-text-secondary);
	}
</style>
