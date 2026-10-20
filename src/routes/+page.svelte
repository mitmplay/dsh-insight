<script lang="ts">
	/**
	 * Workspace route — the floor SHELL (ADR-0019 W3): configure the
	 * floor-registry dep seam once, seed/restore through initFloor,
	 * persist the blob, and render. ALL floor state, mutators, and read
	 * views live in services/panels/{floor-registry,floor-reads} — the
	 * names below are wiring aliases so the markup reads unchanged.
	 */
	import { onMount } from 'svelte';
	import { afterNavigate, replaceState } from '$app/navigation';
	import { page } from '$app/state';
	import AppSidebar from '$lib/components/common/layout/AppSidebar.svelte';
	import ConversationPanel from '$lib/components/conversation/ConversationPanel.svelte';
	import PromptManagerPanel from '$lib/components/prompt-manager/PromptManagerPanel.svelte';
	import TerminalDesk from '$lib/components/terminal/TerminalDesk.svelte';
	import BrowserPanel from '$lib/components/browser/BrowserPanel.svelte';
	import { persistPanelIndex, readPersistedId, readPersistedIndex } from '$lib/services/panels/browser-session-resolver.js';
	import SettingsSkillsPanel from '$lib/components/settings-skills/SettingsSkillsPanel.svelte';
	import PluginManagerPanel from '$lib/components/settings-plugins/PluginManagerPanel.svelte';
	import SettingsEditorPanel from '$lib/components/panels/SettingsEditorPanel.svelte';
	import InjectedDocPanel from '$lib/components/panels/InjectedDocPanel.svelte';
	import WorkspaceExplorerPanel from '$lib/components/workspace-explorer/WorkspaceExplorerPanel.svelte';
	import WorkspaceFilePanel from '$lib/components/workspace-file/WorkspaceFilePanel.svelte';
	import PanelsZoom from '$lib/components/panels/PanelsZoom.svelte';
	import PanelColumn from '$lib/components/panels/PanelColumn.svelte';
	import PanelLoupe from '$lib/components/panels/PanelLoupe.svelte';
	import StickyColumnContainer from '$lib/components/panels/StickyColumnContainer.svelte';
	import EmptyFloor from '$lib/components/panels/EmptyFloor.svelte';
	import ControlBar from '$lib/components/panels/control-bar/ControlBar.svelte';
	import {
		registerAddPanel,
		registerMovePanel,
		registerReplacePanel,
		registerReplacePanelBySession,
		registerReplaceSelected,
		registerSelectPanel,
		registerStartPanelResize
	} from '$lib/services/panels/panel-registry';
	import { setWorkspaceState } from '$lib/services/conversation/workspace-context.svelte';
	import { panelHeaderLabel } from '$lib/services/panels/panel-rows';
	import { appConfig } from '$lib/services/config/app-config.svelte';
	import { resetSync } from '$lib/services/chat/prompt-sync.svelte';
	import { pagePrefs } from '$lib/services/workspace/page-prefs.svelte';
	import { pageFeeds } from '$lib/services/workspace/page-feeds.svelte';
	import * as floorApi from '$lib/services/panels/floor-registry.svelte';
	import {
		agentFor,
		agentLabelFor,
		a2aRowsFor,
		filePanelRoot,
		floorReads,
		panelParentFor,
		panelTitleFor,
		panelWorkspaceFor,
		seedColdOf
	} from '$lib/services/panels/floor-reads.svelte';
	import { clampPanelZoom, loadPanelPrefs, PANEL_WORKSPACE_EXPLORER_WIDTH, savePanelPrefs } from '$lib/utils/panel-prefs';
	import { sanitizeWorkspaceProfile } from '$lib/utils/storage-profile';
	import { clampSidebarWidth } from '$lib/utils/sidebar-prefs';
	import type { DsiConversationPanel, DsiPanelEntry, TerminalDeskMirror } from '$lib/types';

	// ── Dep seam (one configure, then the machine runs itself) ──────────
	const activeProfile = sanitizeWorkspaceProfile(page.url.searchParams.get('profile') ?? '');
	function seedSessionId(): string | null {
		const fromQuery = page.url.searchParams.get('sessionKey');
		return fromQuery !== null && fromQuery.length > 0 ? fromQuery : null;
	}
	const seededInitially = seedSessionId() !== null;
	const seedCold = seedColdOf(page.data);
	pagePrefs.init(activeProfile);
	pagePrefs.installSidebarAutoSave();
	const initialPrefs = loadPanelPrefs(activeProfile);
	let terminalDeskRef: { applyAction: (action: 'new-tab' | 'split-down') => void } | null = $state(null);
	let terminalDeskMirrors = $state<Record<string, TerminalDeskMirror>>({});
	floorApi.configureFloorRegistry({
		getLineageFacts: () => floorReads.lineageFacts,
		getMoveFacts: () => floorReads.moveFacts,
		getWorkspaceFor: (sid) => panelWorkspaceFor(sid),
		ensureCold: (sid) => ensureCold(sid),
		rememberEdge: (child, parent) => pageFeeds.rememberEdge(child, parent),
		getPanelWidth: () => pagePrefs.panelWidth,
		setPanelWidthPreset: (w) => (pagePrefs.panelWidth = w),
		setTreePct: (pct) => (pagePrefs.treePct = pct),
		getSettingsHomes: () => appConfig().settingsHomes,
		applyTerminalDeskAction: (a) => terminalDeskRef?.applyAction(a)
	});
	// Seed resets to one panel; a bare arrival restores the stored blob.
	floorApi.initFloor(
		seededInitially
			? [floorApi.makePanel(seedSessionId()!, seedCold?.agentPreset ?? null)]
			: initialPrefs.panels,
		seededInitially ? null : initialPrefs.selectedPanelId
	);
	if (seededInitially) floorApi.selectPanel(floorApi.floor.panels[0]?.id ?? null);
	if (seededInitially && seedCold !== undefined) {
		pageFeeds.primeSeed(seedSessionId()!, seedCold); // full cold props on paint one
	}

	// The Sticky Glass (ADR-0030 D1): the session survives the reload — the
	// PANEL must too. The floor blob does not persist the browser species
	// (sanitizePanels folds it into conversation), so a bare arrival
	// restores it ONLY when the persisted session is still live on the
	// server. No live id → no auto-open: a browser must never come back to
	// life uninvited (least-surprise, ADR-0029 D8's rejection stands); the
	// chip remains the way to summon a fresh one.
	void (async () => {
		try {
			const persisted = readPersistedId();
			if (!persisted) return;
			if (floorApi.floor.panels.some((panel) => panel.kind === 'browser')) return;
			const res = await fetch('/api/browser');
			if (!res.ok) return;
			const body = (await res.json()) as { sessions?: Array<{ id: string }> };
			if (body.sessions?.some((s) => s.id === persisted)) floorApi.openBrowserPanel(readPersistedIndex() ?? undefined, true);
		} catch {
			/* a boot-time probe must never break the floor */
		}
	})();

	// ── Derived reads (template names unchanged) ────────────────────────
	const panels = $derived(floorApi.floor.panels as DsiPanelEntry[]);
	const selectedPanelId = $derived(floorApi.floor.selectedPanelId);
	const selected = $derived(floorApi.floor.selected);
	const loupePanel = $derived(floorApi.floor.loupePanel);
	const focusComposerId = $derived(floorApi.floor.focusComposerId);
	const pendingFileIntents = $derived(floorApi.floor.pendingFileIntents);
	const badgeByPanelId = $derived(floorReads.badgeByPanelId);
	const rowFactsByPanelId = $derived(floorReads.rowFactsByPanelId);
	const spineTitles = $derived(floorReads.spineTitles);
	const spineWorkspaces = $derived(floorReads.spineWorkspaces);
	const lineageFacts = $derived(floorReads.lineageFacts);
	const moveFacts = $derived(floorReads.moveFacts);
	const conversationPanels = $derived(floorReads.conversationPanels);
	const panelRows = $derived(floorReads.panelRows);
	const ghostRows = $derived(floorReads.ghostRows);
	const sidebarPlacement = $derived(appConfig().sidebar.placement);
	const sidebarInZoom = $derived(sidebarPlacement === 'panels-zoom' && !pagePrefs.sidebarCollapsed);
	pageFeeds.installFeeds(() => conversationPanels.map((p) => p.sessionId));

	async function ensureCold(sessionId: string): Promise<void> {
		await pageFeeds.runCold(sessionId, floorApi.fetchColdFromWire);
	}

	// ── Persistence (R2: one effect, every change) + seed strip (R1) ────
	// The browser panel's floor slot rides localStorage (the blob does not
	// persist the browser species) — the boot auto-restore pins to it.
	$effect(() => {
		const bIdx = panels.findIndex((panel) => panel.kind === 'browser');
		// A boot-time tick sees NO browser panel (the auto-restore is still
		// async) — a -1 must never wipe the saved slot the restore is about
		// to read. persistPanelIndex treats negatives as no-ops.
		if (bIdx >= 0) persistPanelIndex(bIdx);
	});
	$effect(() => {
		savePanelPrefs(
			{
				panels: panels.map((p) =>
					// The desk mirror rides the terminal entry (D3) so a mirror
					// change re-runs this effect and persists.
					p.kind === 'terminal' && terminalDeskMirrors[p.id] ? { ...p, desk: terminalDeskMirrors[p.id] } : p
				),
				selectedPanelId,
				panelWidth: pagePrefs.panelWidth,
				zoom: pagePrefs.zoom,
				treePct: pagePrefs.treePct
			},
			activeProfile
		);
	});
	afterNavigate(() => {
		// One microtask: replaceState throws before the router starts
		// during hydration (client.js sets started AFTER the callbacks).
		// Only sessionKey is stripped — ?profile= survives on purpose.
		if (!seededInitially) return;
		void Promise.resolve().then(() => {
			const clean = new URL(page.url);
			clean.searchParams.delete('sessionKey');
			replaceState(clean.pathname + clean.search + clean.hash, {});
		});
	});

	// ── App sidebar (layout state page-owned in pagePrefs) ──────────────
	let pageRoot = $state<HTMLElement | null>(null);
	let floorEl = $state<HTMLElement | null>(null);
	let sidebarDrag: { startX: number; startWidth: number } | null = null;
	function toggleSidebar(): void {
		pagePrefs.sidebarCollapsed = !pagePrefs.sidebarCollapsed;
	}
	function startSidebarResize(e: MouseEvent): void {
		e.preventDefault();
		sidebarDrag = { startX: e.clientX, startWidth: pagePrefs.sidebarWidth };
	}
	function onSidebarMouseMove(e: MouseEvent): void {
		if (!sidebarDrag) return;
		// Raw screen-px delta — unscaled on purpose (ADR-0006 R8 quirk).
		pagePrefs.sidebarWidth = clampSidebarWidth(sidebarDrag.startWidth + (e.clientX - sidebarDrag.startX));
	}
	function stopSidebarResize(): void {
		sidebarDrag = null;
	}

	// ── Mount: register registry actions + publish workspace context ────
	// Each register* takes its own handler type; a zipped
	// registrations/handlers forEach cannot correlate the arrays' element
	// types (TS union parameter), so registrations are made explicitly and
	// the tuple below serves only the null-clearing destroy loop.
	const registrations = [
		registerAddPanel,
		registerReplaceSelected,
		registerReplacePanel,
		registerReplacePanelBySession,
		registerSelectPanel,
		registerStartPanelResize,
		registerMovePanel
	] as const;
	onMount(() => {
		registerAddPanel(floorApi.doAdd);
		registerReplaceSelected(floorApi.doReplaceSelected);
		registerReplacePanel(floorApi.doReplacePanel);
		registerReplacePanelBySession(floorApi.doReplacePanelBySession);
		registerSelectPanel(floorApi.selectPanel);
		registerStartPanelResize(floorApi.doStartPanelResize);
		registerMovePanel(floorApi.doMovePanel);
		setWorkspaceState({
			get rows() {
				return panelRows;
			},
			get ghosts() {
				return ghostRows;
			},
			get selectedPanelId() {
				return selectedPanelId;
			},
			profile: activeProfile,
			select: floorApi.selectPanel,
			remove: floorApi.removePanel
		});
		return () => {
			// Registry lifecycle (commitment 8): invoke-after-destroy → false.
			registrations.forEach((register) => register(null));
			floorApi.disposeFloorGestures();
			setWorkspaceState(null);
			resetSync(); // prompt-sync checks are session-scoped
		};
	});
</script>

<svelte:window
	onmousemove={(e) => {
		floorApi.onPanelWindowMouseMove(e);
		onSidebarMouseMove(e);
	}}
	onmouseup={() => {
		floorApi.onPanelWindowMouseUp();
		stopSidebarResize();
	}}
/>

<svelte:head>
	<!-- i18n-skip: brand, never translated -->
	<title>Workspace — deepseek-insight</title>
</svelte:head>

{#snippet sidebarRail()}
	<!-- One rail component, two hosts (OCI railColumn snippet pattern):
	     the SAME markup renders beside the floor (standalone — owns its
	     width wrapper + gutter) or inside StickyColumnContainer (embedded
	     — the column owns both). Re-homing swaps the host site, so the
	     rail re-mounts — harmless: its only local state (the session
	     filter) re-seeds from session-filter-prefs, a persisted pref. -->
	<AppSidebar
		profile={activeProfile}
		collapsed={pagePrefs.sidebarCollapsed}
		width={pagePrefs.sidebarWidth}
		embedded={sidebarInZoom}
		currentSessionId={selected?.kind === 'conversation' ? selected.sessionId : ''}
		paneledSessionIds={conversationPanels.map((p) => p.sessionId)}
		captureContainer={pageRoot}
		onToggleCollapse={toggleSidebar}
		onResizeStart={startSidebarResize}
	/>
{/snippet}

<!-- The per-panel body ladder, ONE source for TWO render sites (The
     Panel Loupe ADR D7, 2026-09-04): the column renders it with the
     floor's panel id; the loupe renders the SAME ladder with
     `floorPanelId = null` — ConversationPanel's documented outside-floor
     shape (D3), so the lens's /new reports it cannot run here instead of
     editing the floor slot. Everything else — the dead card, the cold
     full-props mount, the onNeedCold mount — is byte-identical at both
     sites. -->
{#snippet panelBody(panel: DsiPanelEntry, floorPanelId: string | null, hostClose?: () => void)}
	{#if panel.kind === 'terminal'}
		<!-- Terminal branch (Web Terminal spec Wave 5) — kind switches before
		     the session path: a terminal slot has no session. The content
		     self-gates on terminal.enabled and owns its whole lifecycle. -->
		<div class="panel-manager-body" data-testid="panel-terminal">
			<!-- The desk (Terminal Desk ADR D1, Wave 2): tabs + rows in the ONE
			     terminal slot. Shell exit (its LAST shell) auto-closes the panel
			     the same way the header × did pre-desk. -->
			<TerminalDesk
				bind:this={terminalDeskRef}
				restored={panel.desk ?? null}
				onMirror={(m) => (terminalDeskMirrors[panel.id] = m)}
				onShellExit={() => floorApi.removePanel(panel.id)}
			/>
		</div>
	{:else if panel.kind === 'browser'}
		<!-- Browser branch (The Glass Browser spec W2, ADR-0029 D4): the
		     glass owns its session lifecycle — panel-close / unmount both
		     release it (D8); the floor just removes the slot. -->
		<div class="panel-manager-body" data-testid="panel-browser-slot">
			<BrowserPanel
				browserSessionId={'browserSessionId' in panel ? panel.browserSessionId : undefined}
				onclose={() => floorApi.removePanel(panel.id)}
			/>
		</div>
	{:else if panel.kind === 'prompt-manager'}
		<!-- Manager branch (ADR D6/D8) — KIND SWITCHES BEFORE THE SESSION
		     PATH: a manager slot has no session, so the dead/cold ladder
		     below is unreachable for it by type. The EMBEDDED host (W4):
		     root-scoped Escape (D3 — two managers close independently),
		     edit pair portaled under document.body (BC-7 — unscaled under
		     zoom), --mgr-bleed matched to the scroll box's padding, and
		     onclose removing the slot (the sidebar row leaves with it).
		     onchanged stays a lazy no-op (ADR fact 9: the strip refetches
		     on its next trigger, never eagerly). hostClose: in the lens the
		     content's close closes the LENS copy — the host decides what
		     close means (The Loupe for Every Panel, 2026-09-08). -->
		<div class="panel-manager-body" data-testid="panel-manager">
			<PromptManagerPanel
				onclose={hostClose ?? (() => floorApi.removePanel(panel.id))}
				escapeScope="root"
				host="panel"
			/>
		</div>
	{:else if panel.kind === 'plugin-rack'}
		<!-- Plugin-rack branch (The Plugin Rack ADR, 2026-09-27, D1):
		     the content owns its fetches (/api/plugins); close is
		     PanelColumn's chrome — the rack takes no onclose. -->
		<div class="panel-manager-body" data-testid="panel-plugins">
			<PluginManagerPanel
				refreshToken={panel.refresh ?? 0}
				initialTab={panel.tab ?? 'install'}
				ontabchange={(v) => floorApi.setRackTab(panel.id, v)}
			/>
		</div>
	{:else if panel.kind === 'skill-shelf'}
		<!-- Skill-shelf branch (The Skill Shelf ADR, 2026-09-20, D1): the
		     content owns its fetches (/api/skills); close is PanelColumn's
		     chrome — the shelf takes no onclose (2026-09-21). -->
		<div class="panel-manager-body" data-testid="panel-skills">
			<SettingsSkillsPanel
				refreshToken={panel.refresh ?? 0}
				initialTab={panel.tab ?? 'install'}
				initialCollapsed={panel.collapsed ?? null}
				initialSearch={panel.searchQ ?? ''}
				initialReload={panel.reload ?? null}
				ontabchange={(v) => floorApi.setShelfTab(panel.id, v)}
				oncollapsedchange={(ids) => floorApi.setShelfCollapsed(panel.id, ids)}
				onsearchchange={(q) => floorApi.setShelfSearch(panel.id, q)}
				onreloadchange={(r) => floorApi.setShelfReload(panel.id, r)}
			/>
		</div>
	{:else if panel.kind === 'settings-editor'}
		<!-- Settings branch (Settings Panel ADR D3/D6, 2026-09-07): same
		     embedding rule as the manager — root-scoped Escape, onclose
		     removing the slot, the content owns its fetches (/api/settings). -->
		<div class="panel-manager-body" data-testid="panel-settings">
			<SettingsEditorPanel target={panel.target} onclose={hostClose ?? (() => floorApi.removePanel(panel.id))} />
		</div>
	{:else if panel.kind === 'injected-doc'}
		<!-- Injected-doc branch (Loadinjected ADR D1/D2): the kind's SINGLE
		     floor content — extension-routed Markdown / Monaco readOnly over
		     the LOGGED payload, resolved from this conversation's transcript
		     snapshot (the floor's cold seed; no fetch). Root-scoped Escape +
		     onclose per the manager/settings embedding rule. -->
		<div class="panel-manager-body">
			<InjectedDocPanel
				sourceSessionId={panel.sourceSessionId}
				displayPath={panel.displayPath}
				entries={pageFeeds.coldCache[panel.sourceSessionId]?.entries ?? []}
				onclose={hostClose ?? (() => floorApi.removePanel(panel.id))}
			/>
		</div>
	{:else if panel.kind === 'workspace-explorer'}
		<!-- Explorer branch (Workspace Explorer ADR D2): the LIVE tree —
		     the panel fetches its own levels over the HTTP route and owns
		     that cache; the owner owns expanded (persisted) and the
		     open-file intent (W4). -->
		<WorkspaceExplorerPanel
			sessionId={panel.sessionId}
			root={panel.root}
			home={panel.home}
			expanded={panel.expanded}
			tab={panel.tab ?? 'explorer'}
			onToggle={(path) => floorApi.toggleExplorerPath(panel.id, path)}
			onOpenFile={(path) => {
				if (panel.home !== undefined) {
					floorApi.openExplorerTab(panel.id, path);
					return;
				}
				if (panel.sessionId !== null) floorApi.openWorkspaceFile(panel.sessionId, path);
			}}
			onCollapseAll={() => floorApi.collapseExplorerPaths(panel.id)}
			onTabChange={(tab) => floorApi.setExplorerTab(panel.id, tab)}
			collapsedRepos={panel.collapsedRepos ?? []}
			onToggleRepo={(repoRel) => floorApi.toggleExplorerRepo(panel.id, repoRel)}
			onCollapseAllRepos={(repos) => floorApi.collapseExplorerRepos(panel.id, repos)}
			treePct={pagePrefs.treePct}
			onTreePctChange={(pct) => floorApi.setExplorerTreePct(panel.id, pct)}
			pendingOpenFile={pendingFileIntents[panel.id] ?? null}
			onPendingOpenConsumed={(nonce) => floorApi.consumeFileIntent(panel.id, nonce)}
			openTabs={panel.openTabs ?? []}
			activeFile={panel.activeFile ?? null}
			onOpenTab={(path) => floorApi.openExplorerTab(panel.id, path)}
			onCloseTab={(path) => floorApi.closeExplorerTab(panel.id, path)}
			onActivateTab={(path) => floorApi.activateExplorerTab(panel.id, path)}
		/>
	{:else if panel.kind === 'workspace-file'}
		<!-- File branch (Workspace Explorer W4, ADR D2): the LIVE file —
		     the panel fetches its own content over the HTTP route; root
		     feeds the copy fallback from its explorer / the session row. -->
		<WorkspaceFilePanel
			sessionId={panel.sessionId}
			path={panel.path}
			root={filePanelRoot(panel.sessionId)}
			view={panel.view ?? 'edit'}
			onviewchange={(v) => floorApi.setFileView(panel.id, v)}
			onclose={() => floorApi.removePanel(panel.id)}
		/>
	{:else if panel.kind === 'conversation'}
	{@const p = panel}
	{#key p.sessionId}
		{#if pageFeeds.deadSessions[p.sessionId]}
			<div class="panel-error" data-testid="panel-error" role="alert">
				<p>{pageFeeds.deadSessions[p.sessionId]}</p>
				<button
					type="button"
					data-testid="panel-error-close"
					onclick={() => floorApi.removePanel(p.id)}
				>
					Close
				</button>
			</div>
			{:else if pageFeeds.coldCache[p.sessionId]}
			{@const cold = pageFeeds.coldCache[p.sessionId]!}
			<ConversationPanel
				panelId={floorPanelId}
				sessionId={p.sessionId}
				onFileLink={(href) => void floorApi.openFileLinkFromMarkdown(p.sessionId, href)}
				onFileOpen={(path) => void floorApi.openFileLinkFromMarkdown(p.sessionId, path)}
				title={panelTitleFor(p.sessionId)}
				workspace={panelWorkspaceFor(p.sessionId)}
				workspaces={spineWorkspaces}
				agent={agentFor(p)}
				agentDisplay={agentLabelFor(p)}
				subagent={lineageFacts.subagentIds.has(p.sessionId)}
				depth={lineageFacts.depthById.get(p.sessionId) ?? 0}
				parentSessionId={panelParentFor(p.sessionId)}
				entries={cold.entries}
				lastSeq={cold.lastSeq}
				running={cold.running}
				hasMore={cold.hasMore}
				pendingAnswers={cold.pendingAnswers}
				settledAnswers={cold.settledAnswers}
				permission={cold.permission}
				imageLimits={cold.imageLimits ?? undefined}
				knobEvents={cold.knobEvents}
				deliverables={cold.deliverables}
				a2aRows={a2aRowsFor(p.sessionId)}
				a2aTitles={spineTitles}
				onOpenExplorer={floorApi.openWorkspaceExplorer}
				onOpenBrowser={lineageFacts.subagentIds.has(p.sessionId) ? undefined : (() => floorApi.openBrowserPanel())}
				focusComposer={p.id === focusComposerId}
				oncomposerfocus={() => floorApi.clearFocusComposer()}
				focused={p.id === selectedPanelId}
			/>
			{:else if pageFeeds.coldInFlight.has(p.sessionId)}
				<div class="panel-loading" data-testid="panel-loading">Loading…</div>
			{:else}
				<ConversationPanel
					panelId={floorPanelId}
					sessionId={p.sessionId}
					onFileLink={(href) => void floorApi.openFileLinkFromMarkdown(p.sessionId, href)}
				onFileOpen={(path) => void floorApi.openFileLinkFromMarkdown(p.sessionId, path)}
					title={panelTitleFor(p.sessionId)}
					workspace={panelWorkspaceFor(p.sessionId)}
					workspaces={spineWorkspaces}
					agent={agentFor(p)}
					agentDisplay={agentLabelFor(p)}
					subagent={lineageFacts.subagentIds.has(p.sessionId)}
					depth={lineageFacts.depthById.get(p.sessionId) ?? 0}
					parentSessionId={panelParentFor(p.sessionId)}
					lastSeq={-1}
					running={false}
					a2aRows={a2aRowsFor(p.sessionId)}
					a2aTitles={spineTitles}
					onNeedCold={(sid) => void ensureCold(sid)}
					onOpenExplorer={floorApi.openWorkspaceExplorer}
				onOpenBrowser={lineageFacts.subagentIds.has(p.sessionId) ? undefined : (() => floorApi.openBrowserPanel())}
				focusComposer={p.id === focusComposerId}
					oncomposerfocus={() => floorApi.clearFocusComposer()}
					focused={p.id === selectedPanelId}
				/>
			{/if}
	{/key}
	{/if}
{/snippet}

<div class="flex h-dvh conversation-page" bind:this={pageRoot}>
	{#if !sidebarInZoom}
		<!-- Standalone rail: placement 'none', or 'panels-zoom' collapsed
		     (the 34px stub always renders beside the floor — OCI parity). -->
		{@render sidebarRail()}
	{/if}

	<ControlBar bind:panelWidth={pagePrefs.panelWidth} bind:zoom={pagePrefs.zoom} onresizeall={floorApi.resizeAll} captureContainer={floorEl} />

	<!-- The floor wrapper: PanelsZoom's layout slot (flex:1 moves here;
	     the viewport fills it) and the tray canvas-copy's capture target
	     (bind:this → captureContainer down through ControlBar). -->
	<div class="floor" bind:this={floorEl}>
		<!-- railWidth rides the zoom frame's geometry fingerprint: mounting,
		     unmounting, or resizing the in-zoom rail re-measures the frame
		     (OCI `leading ? railWidth : ''`). -->
		<PanelsZoom zoom={pagePrefs.zoom} {panels} railWidth={sidebarInZoom ? pagePrefs.sidebarWidth : null} {selectedPanelId}>
		{#if sidebarInZoom}
			<!-- Leading sticky column (OCI StickyColumnContainer): the rail
			     scales with zoom and scrolls with the row; its trailing
			     gutter exists only while panel columns follow. -->
			<StickyColumnContainer
				width={pagePrefs.sidebarWidth}
				showGutter={panels.length > 0}
				onResizeStart={startSidebarResize}
			>
				{@render sidebarRail()}
			</StickyColumnContainer>
		{/if}
		{#each panels as panel, index (panel.id)}
				<PanelColumn
					{panel}
					{index}
					selected={panel.id === selectedPanelId}
					widthBadge={badgeByPanelId.get(panel.id) ?? null}
					copyValue={panel.kind === 'workspace-file'
						? filePanelRoot(panel.sessionId).replace(/\/+$/, '') + '/' + panel.path
						: undefined}
					canMoveLeft={(rowFactsByPanelId.get(panel.id)?.canMoveUp) ?? index > 0}
					canMoveRight={(rowFactsByPanelId.get(panel.id)?.canMoveDown) ?? index < panels.length - 1}
					onremove={(opts) => floorApi.removePanel(panel.id, { family: opts?.shiftKey !== true })}
					onactivate={() => floorApi.selectPanel(panel.id)}
					onloupe={() => floorApi.openLoupe(panel.id)}
				>
					{@render panelBody(panel, panel.id)}
				</PanelColumn>
			{/each}
	</PanelsZoom>
	<!-- The empty floor centers over the whole floor, NOT inside the zoom
	     row (the row is width: max-content, so a 100%-wide child there
	     collapses to its own text width and cannot center). -->
	{#if panels.length === 0}
		<EmptyFloor />
	{/if}
	</div>

	{#if loupePanel !== null}
		<!-- The loupe at the route root, OUTSIDE .floor (The Panel Loupe
		     ADR D2): the DOM portals to document.body regardless — the
		     mount site keeps the component out of the zoom transform's
		     subtree. One loupe, never persisted (D5): Escape/mask/× clear
		     loupePanelId; closing the louvered panel from the floor clears
		     it through floorApi.clearLoupeIfGone. ANY kind lenses (The Loupe for
		     Every Panel, 2026-09-08): the header rides the panel's label
		     variant, and the body snippet's hostClose makes the content's
		     close close the LENS copy, never the floor slot. -->
		<PanelLoupe
			panelId={loupePanel.id}
			sessionId={loupePanel.kind === 'conversation' ? loupePanel.sessionId : ''}
			label={panelHeaderLabel(loupePanel)}
			onclose={floorApi.closeLoupe}
		>
			{@render panelBody(loupePanel, null, floorApi.closeLoupe)}
		</PanelLoupe>
	{/if}
</div>

<style>
	.conversation-page {
		/* Three-State Lamp (ADR-0023): the floor rides the token layer */
		background-color: var(--color-surface);
	}
	/* Embedded manager host (W4, ADR D8): the slot's scroll box — the
	   column gives the width, this box owns the vertical scroll the
	   modal got from .mgr-modal's overflow. NO padding: this host never
	   carries a session (the kind switch above guarantees it), and the
	   manager's own chrome pads its content; --mgr-bleed: 0 keeps the
	   sticky-header bleed aligned with the zero padding. */
	.panel-manager-body {
		height: 100%;
		overflow-y: auto;
		padding: 0;
		font-size: 0.8125rem;
		--mgr-bleed: 0rem;
	}
	/* Floor wrapper — takes over PanelsZoom's row slot (flex:1) and
	   hands the height down (the viewport fills it); bind:this makes it
	   the tray canvas-copy's capture target. */
	.floor {
		position: relative;
		display: flex;
		flex-direction: column;
		flex: 1;
		min-width: 0;
		min-height: 0;
	}

	.panel-error {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.75rem;
		height: 100%;
		padding: 1rem;
		text-align: center;
		color: var(--si-run);
		background: var(--color-danger-wash);
		font-size: 0.8125rem;
	}

	.panel-error button {
		border: 1px solid var(--color-danger-wash-border);
		border-radius: 0.375rem;
		background: var(--color-surface-elevated);
		color: var(--si-run);
		padding: 0.25rem 0.75rem;
		font-size: 0.75rem;
		cursor: pointer;
	}

	.panel-loading {
		display: flex;
		align-items: center;
		justify-content: center;
		height: 100%;
		color: var(--color-text-secondary, #6c757d);
		font-size: 0.875rem;
	}
</style>