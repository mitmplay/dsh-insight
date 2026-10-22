<script lang="ts">
	/**
	 * SidebarSessions — the app sidebar's body (OCI ControlRoom analog):
	 * the DATA OWNER of the mini session list fed by DSI's own
	 * /api/dsh/sessions (BC-1/BC-2 — no host contact, no server imports).
	 * Same guarded-load shape as the home page: focus refresh +
	 * HOME_REFRESH_MS cadence, both idempotent.
	 *
	 * Rendering delegated (2026-08-24 split): SessionsList owns the phase
	 * branches, filter row, and footer; SidebarSessionContainer owns the
	 * rows. This component owns loading, cadence, derived state, the
	 * spine's VIEW state (collapse + name filter + sub-agent toggle,
	 * persisted per desk via spine-group-prefs since 2026-09-01), and the
	 * create-session handoff.
	 *
	 * DSH's model is flat — workspace and preset are row ATTRIBUTES, not
	 * containers — so both dimensions filter through SessionFilterRow
	 * pills and never nest. The pills list EVERY host preset and EVERY
	 * registry workspace (count 0 included): they are the selection
	 * surface for + New chat, which creates directly from them (no
	 * picker dialog). Blank never-prompted sessions hide by default
	 * (toggle in the filter row).
	 */
	import { getWorkspaceState } from '$lib/services/conversation/workspace-context.svelte';
	import { conversationSeedUrl } from '$lib/utils/seed-url';
	import {
		addPanelFromSidebar,
		replaceSelectedFromRegistry
	} from '$lib/services/panels/panel-registry';
	import { appConfig } from '$lib/services/config/app-config.svelte';
	import { deriveLineage, nestSpineFamilies, suppressFromSpine } from '$lib/services/lineage/lineage';
	import type { DsiPreset, DsiSessionSummary, DsiWorkspaceSummary } from '$lib/types';
	import {
		applySessionDateFilter,
		applySessionFilterFamily,
		applySessionNameFilter,
		collectSessionDates,
		effectiveSessionFilter,
		presetOptions,
		rankRunningFirst,
		workspaceOptions,
		type SessionFilterState
	} from '$lib/utils/session-filters';
	import {
		loadSpineGroupPrefs,
		saveSpineGroupPrefs,
		type SpineGroupPrefs
	} from '$lib/utils/spine-group-prefs';
	import SessionsList from './SessionsList.svelte';

	let {
		currentSessionId,
		/** Active filter — owned by AppSidebar (header toggle + this body
		 *  share one state); this component only reads and reports writes. */
		filter,
		paneledSessionIds = [],
		/** ADR-0037 D4 spine half (2026-10-22): folded glasses whose opener
		 *  holds no panel — synthetic rows nested under the opener family;
		 *  a row's click summons the glass (RowSessionItem's 'browser' arm). */
		glassRows = [] as Array<{ sessionId: string; openedBy: string; title: string }>,
		onfilterchange,
	}: {
		currentSessionId: string;
		filter: SessionFilterState;
		/** Open floor panels (W4) — paneled sessions leave the spine. */
		paneledSessionIds?: string[];
		/** Folded glasses for the SPINE (ADR-0037 D4 spine half). */
		glassRows?: Array<{ sessionId: string; openedBy: string; title: string }>;
		onfilterchange: (next: SessionFilterState) => void;
	} = $props();

	// List state as FLAT rune states (2026-08-23): a $state typed by a
	// LOCAL union-of-objects (the home page's old ListState) trips a
	// svelte2tsx circular inference that poisons every other $state in the
	// file; string unions and imported types are safe. phase discriminates
	// loading/ready/error; `sessions` populates on ready.
	let phase = $state<'loading' | 'ready' | 'error'>('loading');
	let sessions = $state<DsiSessionSummary[]>([]);
	/** The host workspace registry — the AUTHORITY for chips/pills here. */
	let workspaces = $state<DsiWorkspaceSummary[]>([]);
	/** The full host preset catalog — the agent pills list it entirely. */
	let availablePresets = $state<DsiPreset[]>([]);
	let message = $state('');

	/** In-flight guard: one load at a time — the cadence tick and focus
	 *  events coalesce instead of stacking (home-page pattern). */
	let inFlight = false;

	async function load(): Promise<void> {
		if (inFlight) return;
		inFlight = true;
		try {
			await doLoad();
		} finally {
			inFlight = false;
		}
	}

	async function doLoad(): Promise<void> {
		// First load only: a cadence refresh that blanks the list every 5s
		// beside a live conversation would flicker; ready state stays put.
		if (phase !== 'ready') phase = 'loading';
		try {
			const res = await fetch('/api/dsh/sessions');
			const body = (await res.json()) as {
				ok: boolean;
				sessions?: DsiSessionSummary[];
				workspaces?: DsiWorkspaceSummary[];
				presets?: DsiPreset[];
				error?: { code: string; message: string };
			};
			if (!res.ok || !body.ok) {
				message = body.error?.message ?? `request failed (${res.status})`;
				phase = 'error';
				return;
			}
			sessions = body.sessions ?? [];
			workspaces = body.workspaces ?? [];
			availablePresets = body.presets ?? [];
			phase = 'ready';
		} catch (err) {
			message = err instanceof Error ? err.message : String(err);
			phase = 'error';
		}
	}

	$effect(() => {
		void load();
		window.addEventListener('focus', load);
		// AddWorkspaceButton fires this right after a successful adoption —
		// the new workspace's pill must not wait for the cadence tick.
		window.addEventListener('dsi:workspaces-changed', load);
		const tick = setInterval(() => void load(), appConfig().home.refreshMs);
		return () => {
			window.removeEventListener('focus', load);
			window.removeEventListener('dsi:workspaces-changed', load);
			clearInterval(tick);
		};
	});

	const ready = $derived(phase === 'ready' ? sessions : []);
	/** Folded-glass synthetic rows (2026-10-22): shaped as session
	 *  summaries so the WHOLE spine pipeline (lineage, family nesting,
	 *  filters) treats them as the opener's children. origin 'browser'
	 *  marks the row for RowSessionItem's summon click; workspace and
	 *  title ride the opener so filters keep the family whole. */
	const glassSummaries = $derived.by<DsiSessionSummary[]>(() => {
		return glassRows.map((g) => {
			const opener = ready.find((s) => s.sessionId === g.openedBy);
			return {
				sessionId: g.sessionId,
				title: g.title || 'Browser',
				agentPreset: null,
				running: true,
				blank: false,
				updatedAt: opener?.updatedAt ?? 0,
				workspace: opener?.workspace ?? null,
				turns: null,
				parentSessionId: g.openedBy,
				origin: 'browser'
			} satisfies DsiSessionSummary;
		});
	});
	/** Current row — looked up from the RAW list (never filtered away). */
	const current = $derived(ready.find((s) => s.sessionId === currentSessionId) ?? null);

	// ── Spine view state (2026-09-01) ───────────────────────────────────
	// The spine group's collapse, session-name filter, and sub-agent
	// toggle are VIEW state: the owner applies AND persists them (one
	// header report lands in localStorage before anything re-reads it).
	// The effect re-arms on a desk switch so each profile keeps its own
	// memory instead of inheriting the previous desk's.
	const profile = $derived(getWorkspaceState()?.profile ?? null);
	let spine = $state(loadSpineGroupPrefs(getWorkspaceState()?.profile ?? null));
	$effect(() => {
		spine = loadSpineGroupPrefs(profile);
	});

	/** One header report — apply + write through (no debounce: the query
	 *  is a tiny string; the pills' filter persists the same way). */
	function setSpine(partial: Partial<SpineGroupPrefs>): void {
		spine = { ...spine, ...partial };
		saveSpineGroupPrefs(spine, profile);
	}

	/** Filter list excludes the pinned current session by contract; on the
	 *  floor (W4 4.3) it ALSO excludes every paneled session — the panel
	 *  list above the spine is where open panels live now (pinned-exemption
	 *  generalized from 1 to N). */
	const paneled = $derived(new Set(paneledSessionIds));
	const others = $derived(ready.filter((s) => s.sessionId !== currentSessionId && !paneled.has(s.sessionId)));
	// Lineage facts (W4 tasks 4.1/4.2, ADR D5/D7) over the READY list (the
	// full family graph — parents may sit outside `others` as current or
	// paneled rows); pure module, derived per tick.
	const lineage = $derived(deriveLineage([...ready, ...glassSummaries], []));
	// No double-listing: a sub-agent under an OPEN parent (panel or ghost)
	// leaves the spine — one session, one home.
	const unsuppressed = $derived(
		suppressFromSpine(
			// The glass rows join the spine body AFTER the pills/presets census
			// (pills derive from `others`) — one synthetic row must not mint a
			// workspace pill or a + New chat preset count.
			[...others, ...glassSummaries],
			lineage,
			paneled
		)
	);
	const wsPills = $derived(workspaceOptions(others, workspaces));
	const presets = $derived(presetOptions(availablePresets, others));
	/** Self-healed filter — a persisted key no pill carries reads as All. */
	const activeFilter = $derived(effectiveSessionFilter(filter, wsPills.map((w) => w.key)));
	/** Spine view filters (2026-09-01): the sub-agent toggle removes
	 *  origin-'subagent' rows; the header query keeps families whole
	 *  (applySessionNameFilter). Both shape the SPINE only — wsPills and
	 *  presets above keep counting `others`, so + New chat's arming
	 *  census is untouched by a view filter. */
	const spineRows = $derived(
		spine.subagentsHidden
			? unsuppressed.filter((s) => !lineage.subagentIds.has(s.sessionId))
			: unsuppressed
	);
	const nameFiltered = $derived(applySessionNameFilter(spineRows, spine.nameFilter));
	/** Date stage (2026-09-04, FilterDateButton port): the picked day's
	 *  last-active rows, families whole — the same spine-view class as the
	 *  name query, applied right after it (both before the pill family
	 *  filter). The dot set derives from the PRE-filter candidates, so the
	 *  calendar always shows where sessions live, never the filter's own
	 *  echo. */
	const dateFiltered = $derived(applySessionDateFilter(nameFiltered, spine.dateFilter));
	const sessionDates = $derived(collectSessionDates(spineRows));
	/** Visible rows — FAMILY-filtered (children ride the family head, D7),
	 *  then running-first (live sessions top the spine; recency holds
	 *  within each band, 2026-08-26), then NESTED (D6/I1): every family
	 *  renders as one contiguous block — head, then its children — so a
	 *  foreign root never wedges between a parent's indented children
	 *  (live-caught 2026-08-28: feed order + indent alone interleaved an
	 *  unrelated session inside a 5-child family). */
	const visible = $derived(
		nestSpineFamilies(
			rankRunningFirst(applySessionFilterFamily(dateFiltered, activeFilter, workspaces)),
			lineage
		)
	);
	/** Nesting depths for the spine render (D6): sub-agents that STAY in
	 *  the spine (off-floor parent) indent under their family head. Plain
	 *  Record — the rows read their own depth, components stay lineage-free. */
	const depthById = $derived.by(() => {
		const map: Record<string, number> = {};
		for (const s of visible) {
			const depth = lineage.depthById.get(s.sessionId) ?? 0;
			if (depth > 0) map[s.sessionId] = depth;
		}
		return map;
	});

	/**
	 * Created from the sidebar (2026-08-31 revision): the fresh session
	 * JOINS the open floor as a new panel — no navigation, no desk reset
	 * (the seed deep link demoted to the off-floor fallback). The floor's
	 * doAdd inserts before the focused panel and takes selection; the
	 * composer takes the caret (the same one-shot swap-focus /new uses).
	 */
	function gotoCreated(sessionId: string, agentPreset: string | null): void {
		const added = addPanelFromSidebar({ sessionId, agentPreset, focus: true });
		if (added) return;
		navigateToSeed(sessionId);
	}

	/**
	 * Replace chat: the fresh session swaps onto the FOCUSED panel —
	 * [a,b,c] focused b becomes [a,new,c], slot and width kept by the
	 * floor's doReplaceSelected. Off-floor, same fallback as add.
	 */
	function replaceFocused(sessionId: string, agentPreset: string | null): void {
		const replaced = replaceSelectedFromRegistry({ sessionId, agentPreset, focus: true });
		if (replaced) return;
		navigateToSeed(sessionId);
	}

	/** Off-floor fallback — the pre-2026-08-31 behavior: seed navigation. */
	function navigateToSeed(sessionId: string): void {
		window.location.assign(conversationSeedUrl(sessionId, getWorkspaceState()?.profile ?? null));
	}
</script>

<SessionsList
	{phase}
	{message}
	{current}
	{visible}
	{workspaces}
	{depthById}
	paneledSessionIds={paneledSessionIds}
	wsPills={wsPills}
	{presets}
	filter={activeFilter}
	{spine}
	{sessionDates}
	onspinechange={setSpine}
	{onfilterchange}
	oncreated={gotoCreated}
	onreplace={replaceFocused}
/>