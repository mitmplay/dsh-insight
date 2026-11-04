<script lang="ts">
	/**
	 * Workspace route — the floor SHELL (ADR-0019 W3): configure the
	 * floor-registry dep seam once, seed/restore through initFloor,
	 * persist the blob, and render. ALL floor state, mutators, and read
	 * views live in services/panels/{floor-registry,floor-reads} — the
	 * names below are wiring aliases so the markup reads unchanged.
	 */
	import { onMount, untrack } from 'svelte';
	import { afterNavigate, replaceState } from '$app/navigation';
	import { page } from '$app/state';
	import AppSidebar from '$lib/components/common/layout/AppSidebar.svelte';
	import ConversationPanel from '$lib/components/conversation/panel/ConversationPanel.svelte';
	import PromptManagerPanel from '$lib/components/prompt-manager/PromptManagerPanel.svelte';
	import ChordPalette from '$lib/components/panels/ChordPalette.svelte';
	import TerminalDesk from '$lib/components/terminal/TerminalDesk.svelte';
	import { registerJobTabLauncher } from '$lib/services/jobs/follow-client.svelte';
	import BrowserManager from '$lib/components/browser/BrowserManager.svelte';
	import { browserSlotStore, captureHarnessSessionKey, glassReadoptCandidate, harnessSessionKey, persistBrowserSlots, primeBrowserSlotStore, readBrowserSlots, removeBrowserSlot } from '$lib/services/panels/browser-session-resolver.js';
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
	import {
		registerAddPanel,
		registerMovePanel,
		registerReplacePanel,
		registerReplacePanelBySession,
		registerReplaceSelected,
		registerSelectPanel,
		registerStartPanelResize,
		registerSummonGlass
	} from '$lib/services/panels/panel-registry';
	import { setWorkspaceState } from '$lib/services/conversation/workspace-context.svelte';
	import type { PanelRow } from '$lib/services/conversation/workspace-context.svelte';
	import { foldedGlassRowsFor, panelHeaderLabel } from '$lib/services/panels/panel-rows';
	import { appConfig } from '$lib/services/config/app-config.svelte';
	import { resetSync } from '$lib/services/chat/prompt-sync.svelte';
	import { pagePrefs } from '$lib/services/workspace/page-prefs.svelte';
	import { pageFeeds } from '$lib/services/workspace/page-feeds.svelte';
	import * as floorApi from '$lib/services/panels/floor-registry.svelte';
	import { applyWidthPreset } from '$lib/services/panels/floor-registry.svelte';
	import {
		chordOptions,
		decideChordKeydown,
		hasAnyPreset,
		IDLE_CHORD,
		type ChordState,
		type ChordVerb
	} from '$lib/utils/key-chords';
	import { releaseGlasses } from '$lib/services/panels/glass-release.js';
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
	import { applySidebarLane } from '$lib/config';
	import { clampSidebarWidth } from '$lib/utils/sidebar-prefs';
	import type { DsiConversationPanel, DsiPanelEntry, TerminalDeskMirror } from '$lib/types';

	// ── Dep seam (one configure, then the machine runs itself) ──────────
	const activeProfile = sanitizeWorkspaceProfile(page.url.searchParams.get('profile') ?? '');
	function seedSessionId(): string | null {
		const fromQuery = page.url.searchParams.get('sessionKey');
		return fromQuery !== null && fromQuery.length > 0 ? fromQuery : null;
	}
	// RCA 2026-10-30 "The Key That Cleaned Itself Away": capture the key NOW,
	// while it is still in the URL — the cleanup $effect below strips it right
	// after hydration, and a later reader (the glass chip-open) must still
	// know whose conversation this page is (ADR-0045 amendment 3 D7).
	// NO restored-blob fallback (retracted same day): the panel blob lives in
	// localStorage, SHARED by every DSI tab — the last saver wins, so a bare
	// reload of X3/X4 read X2's panels and claimed X2's identity (observed:
	// two glasses minted with session-f2c2d33b as owner). The ONLY truthful
	// sources are the deep-link query param (this load) and the per-tab
	// sessionStorage memory the capture keeps (survives F5, dies with tab).
	// A tab that lost its key stays keyless until a fresh GUI deep link.
	captureHarnessSessionKey(seedSessionId());
	const seededInitially = seedSessionId() !== null;
	const seedCold = seedColdOf(page.data);
	pagePrefs.init(activeProfile);
	pagePrefs.installSidebarAutoSave();
	const initialPrefs = loadPanelPrefs(activeProfile);
	let terminalDeskRef: { applyAction: (action: 'new-tab' | 'split-down') => void } | null = $state(null);
	// The desk mirrors live in a PLAIN record bumped by a $state counter
	// (2026-11-03): assigning fresh objects into a deep-$state proxy tripped
	// assignment_value_stale on every publish (stored proxy ≠ raw RHS). The
	// counter is the reactive gate the save effect reads; the record itself
	// is plain and read untracked there.
	let terminalDeskMirrors: Record<string, TerminalDeskMirror> = {};
	let terminalDeskMirrorsVersion = $state(0);
	floorApi.configureFloorRegistry({
		getLineageFacts: () => floorReads.lineageFacts,
		getMoveFacts: () => floorReads.moveFacts,
		getWorkspaceFor: (sid) => panelWorkspaceFor(sid),
		ensureCold: (sid) => ensureCold(sid),
		rememberEdge: (child, parent) => pageFeeds.rememberEdge(child, parent),
		getPanelWidth: () => pagePrefs.panelWidth,
		setPanelWidthPreset: (w) => (pagePrefs.panelWidth = w),
		setTreePct: (pct) => (pagePrefs.treePct = pct),
		setExplorerHidden: (hidden) => (pagePrefs.explorerHidden = hidden),
		getSettingsHomes: () => appConfig().settingsHomes,
		applyTerminalDeskAction: (a) => terminalDeskRef?.applyAction(a),
		// The Glass Close Ladder (ADR 2026-10-24 D1/D2): the cascade's wire
		// kill — fire-and-forget close per doomed glass; an ok answer prunes
		// the slot entry so the ghost rows drop in the same stroke (D4).
		releaseGlasses: (ids) => void releaseGlasses(ids)
	});
	// Seed resets to one panel; a bare arrival restores the stored blob.
	floorApi.initFloor(
		seededInitially
			? [floorApi.makePanel(seedSessionId()!, seedCold?.agentPreset ?? null)]
			: initialPrefs.panels,
		seededInitially ? null : initialPrefs.selectedPanelId
	);
	if (seededInitially) floorApi.selectPanel(floorApi.floor.panels[0]?.id ?? null);

	// Job Follower Tab (ADR-0035): a roster click with NO terminal panel on
	// the floor LAUNCHES one (the one-live-terminal add grammar) — the desk
	// then registers as the opener and replays the queued request. Without
	// this launcher the click was a silent no-op (RCA 2026-10-21).
	registerJobTabLauncher(() => floorApi.doAdd({ kind: 'terminal' }));
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
	// ADR-0037 D4 — the ONE summon seam, two summoners (boot + sidebar
	// sidebar ghost rows). Probes the live set, re-mints every UNFOLDED glass
	// whose own session answers live (reload survival, Amendment 3), and
	// prunes folded entries whose session died (the honest row).
	// In-flight latch: the HMR re-adopt below can request the restore from
	// a reactive tick that fires more than once while the fetch is pending —
	// concurrent calls would double-summon (the panels guard inside only
	// helps AFTER a summon lands).
	let restoringGlasses = false;
	async function restoreBrowserGlasses(): Promise<void> {
		if (restoringGlasses) return;
		restoringGlasses = true;
		try {
			if (floorApi.floor.panels.some((panel) => panel.kind === 'browser')) return;
			const res = await fetch('/api/browser');
			if (!res.ok) return;
			const body = (await res.json()) as { sessions?: Array<{ id: string; ownerSessionId?: string | null }> };
			// ADR-0045 amendment 3 D7 — a live session owned by ANOTHER
			// conversation is not ours to restore; null owner (legacy) re-binds
			// as before. localStorage keeps only slot memory (D8).
			// RCA 2026-10-30 (reload half): seedSessionId() reads the RAW query —
			// null on every bare reload after the cleanup strips sessionKey — so
			// a glass minted by THIS conversation pruned as "foreign" on reload
			// (observed live: slots wiped, panel lost). The identity authority is
			// harnessSessionKey(): load-time capture → sessionStorage v2 → URL.
			// RCA 2026-10-30 (hosted-set half): a page hosts MANY conversations —
			// a + New chat panel's chip mints the glass with the OPENER's session
			// as owner (ADR-0045 amendment: owner = opener panel), which is never
			// the deep-link key. Ownership check is therefore a SET: every
			// conversation panel currently hosted on this floor, plus the page
			// identity. Anything else on the registry is genuinely foreign.
			const ownSessions = new Set<string>(
				floorApi.floor.panels
					.filter((p) => p.kind === 'conversation')
					.map((p) => (p as { sessionId: string }).sessionId)
			);
			const pageKey = harnessSessionKey();
			if (pageKey) ownSessions.add(pageKey);
			const live = new Set((body.sessions ?? []).map((s) => s.id));
			const ownerOf = new Map((body.sessions ?? []).map((s) => [s.id, s.ownerSessionId ?? null]));
			const mine = (id: string): boolean => {
				const owner = ownerOf.get(id);
				return owner == null || ownSessions.has(owner);
			};
			const slots = readBrowserSlots();
			const dead = slots.filter((s) => s.sessionId && (!live.has(s.sessionId) || !mine(s.sessionId)));
			if (dead.length > 0) persistBrowserSlots(slots.filter((s) => !dead.includes(s)));
			for (const slot of slots) {
				if (slot.folded) continue; // a folded glass never comes back uninvited (ADR-0029 D8)
				if (!slot.sessionId || !live.has(slot.sessionId) || !mine(slot.sessionId)) continue;
				summonGlass(slot);
			}
		} catch {
			/* a boot-time probe must never break the floor */
		} finally {
			restoringGlasses = false;
		}
	}

	/** Bring ONE folded glass back (the summon; the replace verb is the
	 *  same re-bind — the glass owns its slot identity, D4). keepSelection:
	 *  boot restore keeps the operator's focus (true, the default); the
	 *  ghost-click summon focuses the GLASS (false, Ladder focus contract). */
	// FOLD-LOG summon
	function summonGlass(
		glass: { index?: number; width?: number; openedBy?: string; sessionId?: string },
		opts: { keepSelection?: boolean } = {}
	): void {
		floorApi.openBrowserPanel(glass.index, opts.keepSelection ?? true, glass.width, glass.openedBy, glass.sessionId);
	}

	primeBrowserSlotStore();
	void restoreBrowserGlasses();

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
	// ADR-0037 D4: the folded glasses' sidebar rows — derived from the
// slot mirror, titled through the existing spine merge, keyed by
// opener. The summon clears the flag by remounting (the persist
// effect writes unfolded entries for mounted glasses).
	const allFoldedGlassRows = $derived(
		foldedGlassRowsFor(
			$browserSlotStore,
			(id) => lineageFacts.depthById.get(id) ?? 0,
			(id) => panelTitleFor(id)
		)
	);
	// Two homes by the OPENER's floor state (2026-10-22 operator review):
	// opener PANELED -> the roster's ghost grammar (under its opener, the
	// established grammar); opener UNPANELED -> the SPINE, nested under
	// the opener family in the Sessions list — never a dangling orphan
	// block floating above the sessions.
	const foldedGlassRows = $derived(
		allFoldedGlassRows.filter((g) =>
			conversationPanels.some((p) => p.sessionId === g.parentSessionId)
		)
	);
	const spineGlassRows = $derived(
		allFoldedGlassRows
			.filter((g) => !conversationPanels.some((p) => p.sessionId === g.parentSessionId))
			.map((g) => ({
				sessionId: (g.panel as { sessionId: string }).sessionId,
				openedBy: g.parentSessionId as string,
				title: g.title ?? 'Browser'
			}))
	);
	const sidebarPlacement = $derived(appConfig().sidebar.placement);
	const sidebarInZoom = $derived(sidebarPlacement === 'panels-zoom' && !pagePrefs.sidebarCollapsed);
	pageFeeds.installFeeds(() => conversationPanels.map((p) => p.sessionId));

	async function ensureCold(sessionId: string): Promise<void> {
		await pageFeeds.runCold(sessionId, floorApi.fetchColdFromWire);
	}

	// ── Persistence (R2: one effect, every change) + seed strip (R1) ────
	// The browser panel's floor slot rides localStorage (the blob does not
	// persist the browser species) — the boot auto-restore pins to it.
	let browserSeen = false;
	$effect(() => {
		// Amendment 3: the slot is a LIST — one entry per glass, each with
		// its own width, opener, and resolved sessionId (the boot restore
		// re-binds N glasses to N live sessions). A boot-time tick sees no
		// browser panel (the restore is still async); the browserSeen latch
		// only lets a POST-glass no-glass tick clear the list — no ghost.
		const glasses = panels.filter((panel) => panel.kind === 'browser');
		if (glasses.length > 0) {
			browserSeen = true;
			persistBrowserSlots(
				glasses.map((g) => ({
					index: panels.indexOf(g),
					width: g.width,
					openedBy: g.openedBy,
					sessionId: g.browserSessionId
				}))
			);
		} else if (browserSeen) {
			browserSeen = false;
			// ADR-0037 D3: a FOLD keeps its entry — marked, not wiped. The
			// boot restore skips folded entries; the probe prunes the dead.
			persistBrowserSlots(readBrowserSlots().map((s) => ({ ...s, folded: true })));
		} else if (glassReadoptCandidate(readBrowserSlots())) {
			// HMR RE-ADOPT (2026-10-30): a dependency-module HMR re-instantiates
			// the floor registry's module state (panels reset) WITHOUT re-running
			// this component's init — the init-only restore never fires again and
			// the glass vanishes from the floor while its Chrome lives on. The
			// signature is exact: this instance never saw a glass (browserSeen
			// false — a real fold lands in the branch above) yet an UNFOLDED slot
			// with a sessionId says one was on the floor. Re-run the restore —
			// the SAME contract as a hard reload (ADR-0037 D4 seam); dead or
			// foreign-owned slots are pruned inside the restore, and a live
			// re-bind changes nothing else on the floor.
			void restoreBrowserGlasses();
		}
	});
	$effect(() => {
		// The Drag Frame ADR 2026-10-27: a gutter drag rewrites `panels` on
		// every coalesced frame — persisting here would JSON.stringify the
		// whole blob + localStorage.setItem per frame (synchronous, the drag
		// stall). Reading `floor.drag` gates the save AND re-arms it at
		// mouseup: drag → null re-runs this effect with the settled widths.
		if (floorApi.floor.drag !== null) return;
		// the version counter is the tracked dependency; the record is read
		// untracked (plain object — no proxy, no stale-assignment warning)
		void terminalDeskMirrorsVersion;
		const mirrors = untrack(() => ({ ...terminalDeskMirrors }));
		savePanelPrefs(
			{
				panels: panels.map((p) =>
					// The desk mirror rides the terminal entry (D3) so a mirror
					// change re-runs this effect and persists.
					p.kind === 'terminal' && mirrors[p.id] ? { ...p, desk: mirrors[p.id] } : p
				),
				selectedPanelId,
				panelWidth: pagePrefs.panelWidth,
				zoom: pagePrefs.zoom,
				treePct: pagePrefs.treePct,
				explorerHidden: pagePrefs.explorerHidden
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
		// Badge live (Movable Rail ADR amendment 2026-10-30): also cancels
		// any armed afterglow — the chip returns to live instantly.
		pagePrefs.cancelSidebarAfterglow();
	}
	function onSidebarMouseMove(e: MouseEvent): void {
		if (!sidebarDrag) return;
		// Raw screen-px delta — unscaled on purpose (ADR-0006 R8 quirk).
		pagePrefs.sidebarWidth = clampSidebarWidth(sidebarDrag.startWidth + (e.clientX - sidebarDrag.startX));
	}
	function stopSidebarResize(): void {
		sidebarDrag = null;
		// Badge afterglow: freeze into 'fading', 10s linear, then null —
		// the same lifecycle the floor gutters run (drag.svelte.ts).
		pagePrefs.armSidebarAfterglow();
	}

	// ── Width Preset Chord + Chord Palette (ADR-0006a, 2026-10-31 amendment)
	// The wiring is a three-line adapter: decide (PURE decideChordKeydown,
	// capture-first per D12/D13 — Alt+S and the armed next key swallow
	// everywhere, un-armed editable targets pass untouched), then act on
	// the action. The floor owns widths (applyWidthPreset) and membership
	// (removePanel / doAdd) — neither knows the chord exists.
	let chord = $state(IDLE_CHORD);
	function subagentConversationCount(): number {
		const subagents = floorApi.floorSeam().getLineageFacts().subagentIds;
		return floorApi.floor.panels.filter((p) => p.kind === 'conversation' && subagents.has(p.sessionId)).length;
	}
	function chordPaletteRows() {
		const kinds = [...new Set(floorApi.floor.panels.map((p) => p.kind))];
		const selected = floorApi.floor.panels.find((p) => p.id === floorApi.floor.selectedPanelId);
		return chordOptions({
			presets: appConfig().panel.presets,
			panelKinds: kinds,
			subagentCount: subagentConversationCount(),
			focusedConversation: selected?.kind === 'conversation'
		});
	}
	function dispatchChordVerb(verb: ChordVerb): void {
		const panels = floorApi.floor.panels;
		const removeKind = (...kinds: string[]) =>
			panels.filter((p) => kinds.includes(p.kind)).forEach((p) => floorApi.removePanel(p.id));
		switch (verb) {
			case 'a': {
				// D22: the sweep also takes the config shelf (plugin rack + skill shelf).
				const subagents = floorApi.floorSeam().getLineageFacts().subagentIds;
				for (const p of panels) {
					if (
						p.kind === 'terminal' ||
						p.kind === 'workspace-explorer' ||
						p.kind === 'plugin-rack' ||
						p.kind === 'skill-shelf'
					)
						floorApi.removePanel(p.id);
					else if (p.kind === 'conversation' && subagents.has(p.sessionId)) floorApi.removePanel(p.id);
				}
				return;
			}
			case 'b':
				return removeKind('browser');
			case 'c':
				return removeKind('settings-home', 'skill-shelf', 'plugin-rack');
			case 'p': {
				const open = panels.find((p) => p.kind === 'prompt-manager');
				return open ? floorApi.removePanel(open.id) : void floorApi.doAdd({ kind: 'prompt-manager' });
			}
			case 'g': {
				// D23: toggle the plugin manager — the rack add request dedupes to focus.
				const open = panels.find((p) => p.kind === 'plugin-rack');
				return open ? floorApi.removePanel(open.id) : void floorApi.doAdd({ kind: 'plugin-rack' });
			}
			case 'k': {
				// D24: toggle the skill manager the same way over skill-shelf.
				const open = panels.find((p) => p.kind === 'skill-shelf');
				return open ? floorApi.removePanel(open.id) : void floorApi.doAdd({ kind: 'skill-shelf' });
			}
			case 'n': {
				// D20: spawn the focused session's sibling — same agent + workspace,
				// landed directly below it, composer focused on first mount.
				const anchor = panels.find(
					(p): p is DsiConversationPanel =>
						p.kind === 'conversation' && p.id === floorApi.floor.selectedPanelId
				);
				if (!anchor) return;
				void (async () => {
					const workspace = panelWorkspaceFor(anchor.sessionId);
					const res = await fetch('/api/dsh/sessions', {
						method: 'POST',
						headers: { 'content-type': 'application/json' },
						body: JSON.stringify(
							workspace
								? { agentPreset: anchor.agentPreset, cwd: workspace }
								: { agentPreset: anchor.agentPreset }
						)
					});
					const body = (await res.json()) as { ok: boolean; sessionId?: string; agentPreset?: string | null };
					if (!res.ok || !body.ok || !body.sessionId) return; // silent no-op on failure
					// Same workspace PRIVILEGE access (operator report 2026-10-31):
					// session.create carries no permission knobs, so the newborn sits
					// at the host default. The anchor's access mode resolves the same
					// way the cold page does (GET /permission → history-tail + live
					// projections) — re-apply it via the native /permission line
					// (ADR-0007 R5), custom excepted (no single preset name).
					const permRes = await fetch(`/api/dsh/session/${anchor.sessionId}/permission`);
					const permBody = (await permRes.json()) as {
						ok: boolean;
						permission?: { current: string } | null;
					};
					const preset = permBody.ok ? permBody.permission?.current : undefined;
					if (preset && preset !== 'custom') {
						await fetch(`/api/dsh/session/${body.sessionId}/permission`, {
							method: 'POST',
							headers: { 'content-type': 'application/json' },
							body: JSON.stringify({ line: `/permission ${preset}` })
						});
					}
					floorApi.doAdd({
						sessionId: body.sessionId,
						agentPreset: body.agentPreset ?? anchor.agentPreset,
						afterSessionId: anchor.sessionId,
						focus: true
					});
				})();
				return;
			}
			case 's':
				// D19: the same write the sidebar chevron makes.
				pagePrefs.sidebarCollapsed = !pagePrefs.sidebarCollapsed;
				return;
			case 't': {
				const open = panels.find((p) => p.kind === 'terminal');
				return open ? floorApi.removePanel(open.id) : void floorApi.doAdd({ kind: 'terminal' });
			}
			case 'w':
				return removeKind('workspace-explorer');
		}
	}
	function onChordKeyDown(e: KeyboardEvent): void {
		// canArm is UNCONDITIONAL since the verb layer (D14): the chord always
		// owns a/b/c/p/t/w; D4 silent absence now gates only which digit rows
		// the palette lists (chordOptions), never the arming itself.
		const res = decideChordKeydown(chord, e, true);
		if (res.preventDefault) {
			// D17: capture phase + stopPropagation — a leaf like xterm's helper
			// textarea must never see (or swallow) a chord-owned key.
			e.preventDefault();
			e.stopPropagation();
		}
		chord = res.state;
		if (res.action.type === 'verb') dispatchChordVerb(res.action.verb);
		if (res.action.type !== 'apply') return;
		const presets = appConfig().panel.presets;
		const { agent, glass, sidebar, zoom } = presets;
		const a = agent[res.action.n];
		const g = glass[res.action.n];
		const s = sidebar[res.action.n];
		const z = zoom?.[res.action.n];
		if (a === undefined && g === undefined && s === undefined && z === undefined) return; // AC 3
		applyWidthPreset(a, g);
		// Sidebar LANE (ADR-0006a ext 5): one lane per slot, width implies expand
		// (D28); the writes land through pagePrefs — the same home as a drag.
		const laneWrites = applySidebarLane(s, clampSidebarWidth);
		if (laneWrites.width !== undefined) pagePrefs.sidebarWidth = laneWrites.width;
		if (laneWrites.collapsed !== undefined) pagePrefs.sidebarCollapsed = laneWrites.collapsed;
		// Zoom preset is PERCENT (80 = 0.8) — the single zoom bound site clamps.
		if (z !== undefined) pagePrefs.zoom = clampPanelZoom(z / 100);
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
		registerMovePanel,
		registerSummonGlass
	] as const;
	onMount(() => {
		// D17: the chord hears keys in the CAPTURE phase — bubble-phase
		// svelte:window is blind behind leaf stopPropagation (xterm ate the
		// armed chord's t, operator report + CDP probe 2026-10-31).
		window.addEventListener('keydown', onChordKeyDown, true);
		registerAddPanel(floorApi.doAdd);
		registerReplaceSelected(floorApi.doReplaceSelected);
		registerReplacePanel(floorApi.doReplacePanel);
		registerReplacePanelBySession(floorApi.doReplacePanelBySession);
		registerSelectPanel(floorApi.selectPanel);
		registerStartPanelResize(floorApi.doStartPanelResize);
		registerMovePanel(floorApi.doMovePanel);
		registerSummonGlass((glass, opts) => summonGlass(glass, opts));
		setWorkspaceState({
			get rows() {
				return panelRows;
			},
				get ghosts() {
					// ADR-0037 D4: folded glasses join the ghost rows — the SAME
					// interleaved grammar under the opener (the sub-agent pattern).
					return [...ghostRows, ...foldedGlassRows];
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
			window.removeEventListener('keydown', onChordKeyDown, true);
			registrations.forEach((register) => register(null));
			floorApi.disposeFloorGestures();
			setWorkspaceState(null);
			resetSync(); // prompt-sync checks are session-scoped
		};
	});
</script>

<svelte:window
	onmousemove={(e) => {
		// The Drag Frame ADR 2026-10-27: coalesce the floor drag to ONE
		// width write per animation frame (mousemove outruns the display).
		floorApi.onPanelWindowMouseMoveCoalesced(e);
		onSidebarMouseMove(e);
	}}
	onmouseup={() => {
		floorApi.onPanelWindowMouseUp();
		stopSidebarResize();
	}}
/>

<!-- The armed chord's face (D16/D18): centered view over route chord
	state; the 10s idle decay lives in the palette and resets the chord here. -->
<ChordPalette
	open={chord.armed}
	rows={chordPaletteRows()}
	since={chord.since}
	onexpire={() => (chord = IDLE_CHORD)}
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
		trayContainer={floorEl}
		glassRows={spineGlassRows}
		bind:panelWidth={pagePrefs.panelWidth}
		bind:zoom={pagePrefs.zoom}
		onresizeall={floorApi.resizeAll}
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
			<!-- Zoom only on the FLOOR site — the loupe renders the same
			     snippet OUTSIDE the transform (its own mount site), where
			     the pocket must not engage. -->
			<TerminalDesk
				bind:this={terminalDeskRef}
				restored={panel.desk ?? null}
				zoom={floorPanelId ? pagePrefs.zoom : 1}
				onMirror={(m) => {
					terminalDeskMirrors[panel.id] = m;
					terminalDeskMirrorsVersion++;
				}}
				onShellExit={() => floorApi.removePanel(panel.id)}
			/>
		</div>
	{:else if panel.kind === 'browser'}
		<!-- Browser branch (The Glass Browser spec W2, ADR-0029 D4). The
		     header 🗑 (BrowserClosed, Glass Close Ladder Amendment 1,
		     2026-10-24 operator ruling) is a FULL CLOSE — same as a
		     close-panel: the wire session is killed (releaseGlasses → the
		     registry's idempotent close, slot pruned on ok) AND the panel
		     leaves the floor. The old fold (ADR-0037 D1) is retired on
		     this surface. -->
		<BrowserManager
			browserSessionId={'browserSessionId' in panel ? panel.browserSessionId : undefined}
			onclose={() => {
				if ('browserSessionId' in panel && panel.browserSessionId) {
					void releaseGlasses([panel.browserSessionId]);
				}
				floorApi.removePanel(panel.id);
			}}
			openedBy={panel.openedBy}
			parentTitle={panel.openedBy ? (panelTitleFor(panel.openedBy) ?? panel.openedBy) : null}
			depth={panel.openedBy ? (lineageFacts.depthById.get(panel.openedBy) ?? 0) : 0}
			onsession={(id) => floorApi.setBrowserSessionId(panel.id, id)}
			onclosed={() => {
				// The Glass Close Ladder (ADR 2026-10-24 D4): the touch answered
				// 409 CLOSED — prune the slot entry so the ghost rows drop in
				// the same stroke, no reload.
				if ('browserSessionId' in panel && panel.browserSessionId) {
					removeBrowserSlot(panel.browserSessionId);
				}
			}}
		/>
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
			explorerHidden={pagePrefs.explorerHidden}
			ontoggleexplorer={() => floorApi.setExplorerHidden(panel.id, !pagePrefs.explorerHidden)}
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
					onOpenBrowser={lineageFacts.subagentIds.has(p.sessionId) ? undefined : (() => floorApi.openBrowserPanel(undefined, false, undefined, p.sessionId))}
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
					onOpenBrowser={lineageFacts.subagentIds.has(p.sessionId) ? undefined : (() => floorApi.openBrowserPanel(undefined, false, undefined, p.sessionId))}
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

	<!-- The floor wrapper: PanelsZoom's layout slot (flex:1 moves here;
	     the viewport fills it) and the tray canvas-copy's capture target
	     (bind:this → trayContainer down through AppSidebar into the
	     sidebar-hosted ControlBar, 2026-10-22). -->
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