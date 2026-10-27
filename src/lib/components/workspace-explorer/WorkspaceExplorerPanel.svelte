<script lang="ts">
	/**
	 * WorkspaceExplorerPanel — the workspace-explorer kind's SINGLE floor
	 * content (Workspace Explorer W3 task 3.1, ADR D2): a hand-rolled
	 * directory tree over the session's workspace root, NO tree dependency
	 * (ADR D1). One level fetches per expand over GET /api/dsh/directory
	 * (BC-1: host bytes only through the HTTP route) and caches in the
	 * component-local levels state — the cache lives until reload BY
	 * DESIGN, the owner persists only expanded paths (PRD §5), so F5
	 * re-fetches what the tree reopens.
	 *
	 * Ordering is presentation-local: directories first, then natural name
	 * order (the host listing order is presentation-irrelevant per the DSH
	 * WorkspaceDirectoryListing contract). A failed level renders a failure
	 * row (the FilesBody pattern), a truncated one a suffix row, an empty
	 * one an empty row — never a blank region.
	 *
	 * The tree rendering itself lives in WorkspaceExplorerTree (extracted
	 * 2026-09-13) — presentation only, all state and fetches stay here.
	 *
	 * The Changes tab rendering lives in WorkspaceExplorerChanges (extracted
	 * 2026-09-13) — also presentation only; the status cache stays here.
	 *
	 * The panel emits INTENT ONLY (Module Communication Map): onToggle
	 * forwards expand/collapse, onOpenFile forwards a file click — the
	 * floor owner owns dedupe, slots, and persistence.
	 */
	import { onDestroy } from 'svelte';
	import { clampTreePct, PANEL_WORKSPACE_EXPLORER_WIDTH, TREE_PCT_DEFAULT } from '$lib/utils/panel-prefs';
	import WorkspaceExplorer from './WorkspaceExplorer.svelte';
	import WorkspaceFilePanel from '../workspace-file/WorkspaceFilePanel.svelte';
	import SettingsHomeFile from '../panels/SettingsHomeFile.svelte';
	import WorkspaceFileTabs from '../workspace-file/WorkspaceFileTabs.svelte';
	import ResizeGutter from '../panels/ResizeGutter.svelte';
	import type { DirEntry, Level } from './WorkspaceExplorerTree.svelte';
	import type { ChangeStatus } from './WorkspaceExplorerRepo.svelte';


	/** Heartbeat cadence for deep-path freshness (ADR D4 amendment). */
	const HEARTBEAT_MS = 30_000;

	let {
		sessionId,
		root,
		home,
		expanded,
		onToggle,
		onOpenFile,
		onCollapseAll,
		tab = 'explorer',
		onTabChange,
		collapsedRepos,
		onToggleRepo,
		onCollapseAllRepos,
		treePct = TREE_PCT_DEFAULT,
		onTreePctChange,
		pendingOpenFile = null,
		onPendingOpenConsumed,
		openTabs = [],
		activeFile = null,
		onOpenTab,
		onCloseTab,
		onActivateTab
	}: {
		/** The owning session — provenance for the level fetches. NULL for a
		 *  session-less settings-home explorer (The Settings Tree ADR
		 *  2026-09-18 D3), which fetches over the DSI-local plane instead. */
		sessionId: string | null;
		/** The Settings Tree ADR (2026-09-18, D2): when set, every fetch goes
		 *  to the DSI-local /api/settings-home routes for that home — the
		 *  DSH session routes are session-scoped and cannot serve the home. */
		home?: 'dsi' | 'dsh';
		/** Verbatim workspace root — the copy control's clipboard value. */
		root: string;
		/** Root-relative directory paths currently expanded (owner-owned). */
		expanded: readonly string[];
		/** Expand/collapse intent — the owner mutates the expanded list. */
		onToggle: (path: string) => void;
		/** File click intent — a session explorer forwards it to the owner
		 *  (which publishes it back as a tab intent); a home explorer opens
		 *  the tab directly (The Settings Tree ADR 2026-09-18 D2). */
		onOpenFile: (path: string) => void;
		/** The OWNER-persisted tree share in percent (ADR D4, panel-prefs).
		 *  Authority between drags; the drag override bridges live moves. */
		treePct?: number;
		/** Drag-settle intent — the owner persists through clampTreePct. */
		onTreePctChange?: (pct: number) => void;
		/** Route-published file intent in 'explorer' layout (nonce-guarded,
		 *  consumed exactly once — the tabOverride dissolve pattern). */
		pendingOpenFile?: {
			path: string;
			nonce: number;
			lines?: { start: number; end: number } | null;
		} | null;
		/** Consumed intent — the route clears its pending publish. */
		onPendingOpenConsumed?: (nonce: number) => void;
		/** Explorer Layout (amendment 2026-09-16): the OWNER-persisted open
		 *  file tabs (root-relative) — a hard reload restores them from
		 *  panel-prefs, same discipline as expanded/tab. D5's
		 *  die-with-the-panel still holds: no resurrection after close. */
		openTabs?: readonly string[];
		/** The persisted active tab path; null renders the tree alone. */
		activeFile?: string | null;
		/** Open-tab intent — the owner appends (deduped) and activates. */
		onOpenTab?: (path: string) => void;
		/** Close-tab intent — the owner removes it and re-selects active. */
		onCloseTab?: (path: string) => void;
		/** Activate intent — the owner moves the active tab. */
		onActivateTab?: (path: string) => void;
		/** Collapse-all intent — the owner empties the expanded list. */
		onCollapseAll: () => void;
		/** Git Eye (2026-09-12 operator request): the PERSISTED active tab —
		 *  the owner stores it on the entry, so a hard reload restores it. */
		tab?: 'explorer' | 'changes';
		/** Tab-switch intent — the owner PERSISTS it on the entry. */
		onTabChange?: (tab: 'explorer' | 'changes') => void;
		/** Git Eye (2026-09-13): the PERSISTED collapsed repo rel paths —
		 *  the owner stores them on the entry, so a hard reload restores them. */
		collapsedRepos?: readonly string[];
		/** Repo collapse-toggle intent — the owner PERSISTS it on the entry. */
		onToggleRepo?: (repoRel: string) => void;
		/** Collapse-all-repos intent (2026-09-13): on the Changes tab the
		 *  toolbar's collapse-all collapses EVERY known repo instead — the
		 *  owner persists the resulting collapsed list. */
		onCollapseAllRepos?: (repos: readonly string[]) => void;
	} = $props();


	/** Rel path → level state. Key '' is the root level. */
	let levels = $state<Record<string, Level>>({});

	/**
	 * The Always Tabs (ADR 2026-09-16 D2): git DATA availability (null =
	 * first probe in flight, false = FINAL — no git data, zero further
	 * probes). NOT a gate answer any more: the point-in-time read routes
	 * answer on every desk; this only says whether the data face is live.
	 * Component-local, never persisted — same discipline as levels.
	 */
	let gitReady = $state<boolean | null>(null);
	let repoMaps = $state<Record<string, { rootIsRepo: boolean; repos: Record<string, boolean> }>>({});

	/**
	 * Git Eye Changes view (ADR D5): the active tab (component-local — a
	 * remount opens on Explorer BY DESIGN) and the per-repo status fetches,
	 * keyed by repo rel ('' = the workspace root itself).
	 */
	// The OWNER's persisted tab is the live authority (2026-09-12 glitch fix:
	// a one-shot init capture rendered Explorer first and flipped when the
	// owner state landed). A local override only bridges the click → the
	// owner's state round-trip, and dissolves once the prop catches up.
	// svelte-ignore state_referenced_locally -- reading the prop in $derived is reactive.
	let tabOverride = $state<'explorer' | 'changes' | null>(null);
	const activeTab = $derived(tabOverride ?? tab);
	let changesStatuses = $state<Record<string, ChangeStatus>>({});

	/** Repos under the workspace root, as rel paths ('' first when the root
	 *  is one). Empty until the root probe answers. The tab strip is
	 *  unconditional (Always Tabs D1) — this list drives ROWS, not tabs. */
	const changesRepos = $derived.by(() => {
		const rootMap = repoMaps[''];
		if (!rootMap) return [];
		const out: string[] = [];
		if (rootMap.rootIsRepo) out.push('');
		for (const [name, flag] of Object.entries(rootMap.repos)) {
			if (flag) out.push(name);
		}
		return out;
	});

	/** Root-relative paths reported changed by git-status — the Explorer
	 *  tree tints these file rows red, the same contract as the Changes rows. */
	const changedPaths = $derived.by(() => {
		const out = new Set<string>();
		for (const [repoRel, st] of Object.entries(changesStatuses)) {
			if (st.kind !== 'ready') continue;
			for (const f of st.files) out.add(repoRel === '' ? f.path : repoRel + '/' + f.path);
		}
		return out;
	});

	/** Every ancestor directory of a changed path — a parent of a changed
	 *  file is highlighted exactly like a repo row (bold + #FF4500). */
	const changedDirs = $derived.by(() => {
		const out = new Set<string>();
		for (const p of changedPaths) {
			const parts = p.split('/');
			parts.pop();
			let cur = '';
			for (const part of parts) {
				cur = cur === '' ? part : cur + '/' + part;
				out.add(cur);
			}
		}
		return out;
	});

	/** Rel → absolute (posix join; the directory route takes absolute paths). */
	function abs(rel: string): string {
		return rel === '' ? root : root.replace(/\/+$/, '') + '/' + rel;
	}

	/** Entry's children rel prefix: '' + name, or 'a/b' + '/' + name. */
	function childRel(rel: string, name: string): string {
		return rel === '' ? name : rel + '/' + name;
	}

	async function fetchLevel(rel: string): Promise<void> {
		levels[rel] = { kind: 'loading' };
		try {
			// The host's descriptor REQUIRES a non-empty path: the root lists
			// through its ABSOLUTE workspace path, nested levels through theirs.
			// A settings-home explorer (The Settings Tree ADR D2) takes the
			// DSI-local plane instead — rel paths against the home root.
			const res = await fetch(
				home !== undefined
					? '/api/settings-home/tree?home=' + encodeURIComponent(home) + '&path=' + encodeURIComponent(rel)
					: '/api/dsh/workspace-tree?sessionId=' + encodeURIComponent(sessionId ?? '') + '&path=' + encodeURIComponent(abs(rel))
			);
			const body = (await res.json()) as {
				ok: boolean;
				listing?: { entries?: DirEntry[]; truncated?: boolean };
				error?: { code?: string; message?: string };
			};
			if (!body.ok || !body.listing?.entries) {
				// Surface the host's refusal verbatim — a generic "could not
				// list" hides actionable facts (the 2026-09-10 sub-agent
				// session/not-found case was invisible behind it).
				const reason = body.error?.message ?? body.error?.code ?? String(res.status);
				levels[rel] = { kind: 'failed', reason };
				return;
			}
			levels[rel] = {
				kind: 'ready',
				entries: body.listing.entries,
				truncated: body.listing.truncated === true
			};
		} catch (err) {
			levels[rel] = { kind: 'failed', reason: err instanceof Error ? err.message : 'network' };
		}
	}

	// One fetch per newly expanded path (the once-per-expand rule); the
	// root level fetches with the mount (the chip click opened the tree).
	$effect(() => {
		for (const rel of ['', ...expanded]) {
			if (levels[rel] === undefined) void fetchLevel(rel);
		}
	});

	/** One git-map probe for a level: once per level (repoMaps is the
	 *  guard); a no-data answer closes probing for the WHOLE panel. */
	async function probeGit(rel: string): Promise<void> {
		if (gitReady === false || repoMaps[rel] !== undefined) return;
		// While the FIRST (root) probe is in flight the gate is unknown — no
		// other level may probe (the answer closes or opens for all of them).
		if (rel !== '' && gitReady === null) return;
		try {
			const res = await fetch(
				'/api/workspace/git-map?sessionId=' + encodeURIComponent(sessionId ?? '') + '&dir=' + encodeURIComponent(abs(rel))
			);
			const body = (await res.json()) as {
				ok: boolean;
				enabled?: boolean;
				rootIsRepo?: boolean;
				repos?: Record<string, boolean>;
			};
			if (!body.ok || body.enabled !== true) {
				gitReady = false; // final: no git data from here on (Always Tabs D2 — not a desk verdict)
				return;
			}
			gitReady = true;
			repoMaps[rel] = { rootIsRepo: body.rootIsRepo === true, repos: body.repos ?? {} };
		} catch {
			gitReady = false; // unreachable probe: honest degradation, no retry loop
		}
	}

	// One probe per rendered level — the root at mount, expanded levels on
	// demand (ADR D3: cost tracks what the operator opens). A disabled gate
	// ends the loop; each level probes once (the repoMaps guard).
	$effect(() => {
		// The Settings Tree ADR D2: a home explorer has no git gate — skip
		// the probe loop entirely (final no-git verdict, mount-time).
		if (home !== undefined) {
			gitReady = false;
			return;
		}
		if (gitReady === false) return;
		for (const rel of ['', ...expanded]) void probeGit(rel);
	});

	/** One git-status fetch per repo (guarded — the tab re-opens reuse the
	 *  cache; Refresh clears it like everything else). */
	async function fetchChanges(rel: string): Promise<void> {
		if (changesStatuses[rel] !== undefined) return;
		changesStatuses[rel] = { kind: 'loading' };
		try {
			const res = await fetch(
				'/api/workspace/git-status?sessionId=' + encodeURIComponent(sessionId ?? '') +
					'&root=' + encodeURIComponent(root) +
					'&repo=' + encodeURIComponent(abs(rel))
			);
			const body = (await res.json()) as {
				ok: boolean;
				enabled?: boolean;
				truncated?: boolean;
				files?: Array<{ code: string; path: string }>;
				code?: string;
				message?: string;
			};
			if (!body.ok) {
				changesStatuses[rel] =
					body.code === 'git-unavailable'
						? { kind: 'unavailable' }
						: { kind: 'failed', reason: body.message ?? body.code ?? String(res.status) };
				return;
			}
			changesStatuses[rel] = { kind: 'ready', truncated: body.truncated === true, files: body.files ?? [] };
		} catch (err) {
			changesStatuses[rel] = { kind: 'failed', reason: err instanceof Error ? err.message : 'network' };
		}
	}

	// An open gate fetches every known repo's status once (cache-guarded) —
	// the Explorer tree needs it for red changed-file rows, the Changes tab
	// reuses the same cache. Gate off ⇒ zero status fetches.
	$effect(() => {
		if (gitReady !== true) return;
		for (const rel of changesRepos) void fetchChanges(rel);
	});

	// Once the owner's persisted tab equals the local override, the override
	// has served its purpose and dissolves (the prop is authoritative again).
	$effect(() => {
		if (tabOverride !== null && tab === tabOverride) tabOverride = null;
	});

	/** Refresh intent: drop the whole levels cache — the effect re-fetches
	 *  the root level and every still-expanded path once each. */
	function refresh(): void {
		levels = {};
		gitReady = null; // staleness is honest — Refresh re-asks everything
		invalidateGit();
	}

	/** The git caches ONLY (Index Pulse W3): the tree structure did not
	 *  change, so the levels cache survives — the probes and status fetches
	 *  re-run through the same guarded effects as a full Refresh. */
	function invalidateGit(): void {
		repoMaps = {};
		changesStatuses = {};
		pulseRefused = false; // Always Tabs D2: each refresh re-asks the pulse once
	}

	/**
	 * The Index Pulse (ADR 2026-09-13, D3/D5): while the gate is open and
	 * repos are known, ONE EventSource listens for generation rings. A ring
	 * invalidates the git caches (invalidateGit — the unchanged effects
	 * re-fetch through the gated route); an enabled:false event or a stream
	 * error CLOSES the source with no retry loop — degradation is today's
	 * manual-Refresh world, and the browser's default EventSource reconnect
	 * is deliberately NOT fought here (the reconnect re-opens a fresh
	 * generation baseline, which is safe by construction).
	 */
	let pulseKey: string | null = null; // PLAIN — never an effect dependency
	let pulseSource: EventSource | null = null;
	/** Sticky refusal (Always Tabs D2 give-up): a gated git-events answer is
	 *  a FATAL EventSource error — remember it so the pulse effect never
	 *  re-opens a doomed stream until the caches are invalidated. Cleared by
	 *  invalidateGit()/refresh() (one honest re-ask per refresh). */
	let pulseRefused = $state(false);
	/** Reactive liveness of the stream — the heartbeat runs ONLY while a
	 *  stream is alive (Always Tabs D2: no stream, no standing cost). */
	let pulseAlive = $state(false);
	/** Last generation seen on the CURRENT stream (null until the connect
	 *  baseline arrives). The server's first event is a BASELINE, not a
	 *  ring — the panel's rows were fetched fresh at connect, and treating
	 *  it as a ring caused the invalidate→re-probe→reopen storm (fixed
	 *  2026-09-13, headed-verified). */
	let pulseLastGen: string | null = null;

	function closePulse(): void {
		pulseSource?.close();
		pulseSource = null;
		pulseKey = null;
		pulseLastGen = null;
		pulseAlive = false;
	}

	function openPulse(key: string): void {
		// Non-browser env safety (mirrors WorkspaceFilePanel): unit tests
		// mount the panel in environments without EventSource — the stream
		// is a live-freshness channel, not a render dependency.
		if (typeof EventSource === 'undefined') return;
		closePulse();
		const params =
			'sessionId=' + encodeURIComponent(sessionId ?? '') +
			'&root=' + encodeURIComponent(root) +
			changesRepos.map((rel) => '&repo=' + encodeURIComponent(abs(rel))).join('');
		const source = new EventSource('/api/workspace/git-events?' + params);
		pulseSource = source;
		pulseKey = key;
		pulseAlive = true;
		source.addEventListener('generation', (event) => {
			const generation = (event as MessageEvent).data as string;
			if (pulseLastGen === null) {
				pulseLastGen = generation; // connect baseline — rows are already fresh
				return;
			}
			if (generation === pulseLastGen) return;
			pulseLastGen = generation;
			invalidateGit();
		});
		source.addEventListener('enabled', closePulse);
		// An error is NOT always fatal: while the browser is auto-reconnecting
		// (readyState CONNECTING) the stream must survive — a dev-server SSR
		// reload or a network blip drops the TCP side, and closing here meant
		// rings during the outage were never heard (stale rows, fixed
		// 2026-09-13). Only a truly CLOSED source tears the wiring down. The
		// reconnect itself is safe by construction: its first event carries
		// the current generation, and a bump during the outage differs from
		// pulseLastGen — which invalidates exactly once.
		source.onerror = () => {
			if (source.readyState === 2) {
				// A gated git-events answer is plain JSON, never a stream — this
				// fatal close IS the refusal (Always Tabs D2). Sticky: no retry
				// loop against the standing watcher cost on a gateless desk.
				pulseRefused = true;
				closePulse(); // EventSource.CLOSED
			}
		};
	}

	// Reacts ONLY to gate/repos changes; the pulse bookkeeping above is
	// untracked, so an invalidation triggered by a ring cannot re-open the
	// stream. A momentarily-empty changesRepos (probe re-fetch in flight
	// after a REAL ring's invalidation) keeps the existing stream — only a
	// closed gate tears it down.
	$effect(() => {
		if (gitReady !== true) {
			closePulse();
			return;
		}
		if (pulseRefused) return; // sticky: one doomed attempt per refresh, never a loop
		if (changesRepos.length === 0) return; // probe in flight — stream stays
		const key = changesRepos.join('\u0000');
		if (pulseKey === key && pulseSource !== null) return;
		openPulse(key);
	});

	// Safety-net heartbeat (ADR D4 amendment, 2026-09-13): the index watcher
	// and the repo-root watcher cannot see DEEP working-tree paths (a new
	// file inside an existing docs/ subdirectory fires no event). While a
	// stream is ALIVE, the panel re-asks at a slow, visible-tab-only cadence —
	// bounded cost, honest freshness for the paths no watcher can cover.
	// Always Tabs D2 give-up: no live stream (gateless desk) ⇒ NO heartbeat —
	// freshness there is the Refresh button, never a standing interval.
	$effect(() => {
		if (gitReady !== true || !pulseAlive) return;
		const timer = setInterval(() => {
			if (document.visibilityState === 'visible') invalidateGit();
		}, HEARTBEAT_MS);
		return () => clearInterval(timer);
	});

	onDestroy(closePulse);

	// The Explorer Layout (ADR 2026-09-17 D3/D4/D5; amendment 2026-09-16):
	// the tab list and the active tab are OWNER-PERSISTED panel facts
	// (panel-prefs, same discipline as expanded/tab/collapsedRepos) — a
	// hard reload restores them. They still die with the PANEL (D5):
	// closing the panel drops the entry; no localStorage resurrection.
	function handleFileClick(path: string): void {
		// The Settings Tree ADR 2026-09-18 D1: 'explorer' is the only
		// behavior — every click is a tab (open or focus), session or home.
		onOpenTab?.(path);
	}

	// Consume ONCE per nonce: a state change inside handleFileClick re-runs
	// this effect (openTabs is a dependency), and the guard keeps the
	// consume single-shot even before the owner clears the publish.
	let consumedNonce = -1;
	/** The parked #L anchor target (transient, never persisted) — handed to
	 *  the active file panel and cleared once it reports the highlight done. */
	let lineTarget = $state<{ start: number; end: number } | null>(null);
	$effect(() => {
		if (pendingOpenFile !== null && pendingOpenFile.nonce !== consumedNonce) {
			consumedNonce = pendingOpenFile.nonce;
			// Reveal the file in the tree FIRST: a published intent (File Link
			// Intent, 2026-09-25) arrives with the tree fully collapsed — the
			// tab opens, but nothing shows WHERE it lives. Expand every
			// ancestor folder (owner applies via onToggle, which fetches the
			// level); shallow-to-deep so each level lists before its child.
			const dirs = pendingOpenFile.path.split('/').slice(0, -1);
			let acc = '';
			for (const dir of dirs) {
				acc = acc ? acc + '/' + dir : dir;
				if (!expanded.includes(acc)) onToggle(acc);
			}
			handleFileClick(pendingOpenFile.path);
			// The #L anchor target rides the intent as DISPLAY metadata: park it
			// for the file panel, which consumes it once (scroll + highlight) and
			// reports back — a later plain tab click must NOT re-highlight.
			if (pendingOpenFile.lines) lineTarget = pendingOpenFile.lines;
			onPendingOpenConsumed?.(pendingOpenFile.nonce);
		}
	});

	// Fullpath Bow D3 AS AMENDED 2026-09-26 (operator decision): reveal is
	// bound to the ACTIVE FILE, not to the intent — navigating WorkspaceFileTabs
	// tabs also expands the file's ancestors and scrolls its row into view.
	// One reveal per active-file value; the scroll fires only once the row
	// actually renders (levels land asynchronously via the owner's onToggle).
	let revealedFile: string | null = null;
	$effect(() => {
		const file = activeFile;
		if (file === null || file === revealedFile) return;
		const dirs = file.split('/').slice(0, -1);
		let acc = '';
		for (const dir of dirs) {
			acc = acc ? acc + '/' + dir : dir;
			if (!expanded.includes(acc)) onToggle(acc);
		}
		const deepest = dirs.length === 0 ? '' : dirs.join('/');
		if (deepest !== '' && levels[deepest]?.kind !== 'ready') return;
		requestAnimationFrame(() => {
			const row = splitRoot?.querySelector('[data-active-file] li.active');
			if (row && typeof (row as HTMLElement).scrollIntoView === 'function') {
				(row as HTMLElement).scrollIntoView({ block: 'nearest' });
				revealedFile = file;
			}
		});
	});

	// ADR D4 AS AMENDED 2026-10-27 (operator request): the PANEL is still
	// the drag owner and the PERSISTED fact is still treePct percent — but
	// the tree lane RENDERS at a pixel basis, so a parent-driven panel
	// resize grows/shrinks ONLY the file region. The percent converts to
	// px ONCE on the first observed width; the gutter drag keeps D4's
	// percent math (px delta → clampTreePct) and settles back into the
	// re-derived px. The split ROOT is the measure (no wrapper regions —
	// the components sit as direct flex children, gutter between them).
	let splitRoot = $state<HTMLElement | null>(null);
	// The settled lane width in px — null until the first ResizeObserver
	// measurement (or the first drag). Until then the lane renders at
	// PANEL_WORKSPACE_EXPLORER_WIDTH, the narrow-lane default.
	let treePx = $state<number | null>(null);
	// The measured split width — kept so a drag that starts before any
	// observer fire still has a width to convert its percent against.
	let panelW = $state<number | null>(null);
	// $state is REQUIRED: dragPct (and the style vars) must re-render on
	// EVERY mousemove — a plain let mutates silently, so the drag reads
	// frozen until mouseup (operator-found regression).
	let dragPct = $state<number | null>(null);
	/** Width captured at mousedown — the percent→px denominator for this drag. */
	let dragWidth: number | null = null;

	// First observed width converts the persisted percent to the lane's
	// px ONCE; later fires (a parent resizing the panel) update panelW
	// but deliberately leave treePx alone — the tree lane is FIXED px,
	// the file region absorbs the resize.
	$effect(() => {
		const el = splitRoot;
		if (el === null || typeof ResizeObserver === 'undefined') return;
		const ro = new ResizeObserver((entries) => {
			const w = entries[0]?.contentRect.width || el.getBoundingClientRect().width;
			if (w <= 0) return;
			panelW = Math.round(w);
			if (treePx === null && dragPct === null) {
				treePx = Math.round((clampTreePct(treePct) / 100) * w);
			}
		});
		ro.observe(el);
		return () => ro.disconnect();
	});

	function startSplitDrag(event: MouseEvent): void {
		const root = splitRoot;
		if (root === null) return;
		const width = panelW ?? root.getBoundingClientRect().width;
		if (width <= 0) return;
		const startX = event.clientX;
		const startPct = dragPct ?? treePct;
		dragWidth = width;
		dragPct = startPct;
		const onMove = (e: MouseEvent): void => {
			dragPct = clampTreePct(startPct + ((e.clientX - startX) / width) * 100);
			// Live px tracking: the lane moves WITH the mouse, in px, while
			// the percent math above stays the persisted authority.
			treePx = Math.round((dragPct / 100) * width);
		};
		const onUp = (): void => {
			window.removeEventListener('mousemove', onMove);
			window.removeEventListener('mouseup', onUp);
			if (dragPct !== null) onTreePctChange?.(dragPct);
		};
		window.addEventListener('mousemove', onMove);
		window.addEventListener('mouseup', onUp);
	}

	/** The rendered tree lane: the settled px, or the narrow-lane default
	 *  before the first measurement. Percent lives only in treePct. */
	const treeBasis = $derived(treePx === null ? PANEL_WORKSPACE_EXPLORER_WIDTH : treePx);
</script>

<div
	data-testid="workspace-explorer"
	class="split"
	bind:this={splitRoot}
	style="--tree-basis: {treeBasis}px"
>
	<!-- NO wrapper regions: the explorer, the gutter, and the file tabs sit
	     as DIRECT flex children of .split, so the gutter is genuinely
	     between them and the drag reads on the seam. Sizing rides the CSS
	     custom properties set above (inherited by the component roots). -->
	<WorkspaceExplorer
		activeFile={activeFile}
		{root}
		{activeTab}
		onTabChange={(t) => {
			tabOverride = t;
			onTabChange?.(t);
		}}
		onRefresh={refresh}
		{onCollapseAll}
		{onCollapseAllRepos}
		{levels}
		{expanded}
		{onToggle}
		{repoMaps}
		{changedPaths}
		{changedDirs}
		onOpenFile={handleFileClick}
		{changesRepos}
		{changesStatuses}
		{collapsedRepos}
		{onToggleRepo}
	/>
	<!-- The Explorer Layout (ADR D4), unconditional since The Settings
	     Tree ADR 2026-09-18 D1: the PANEL owns the drag; the gutter's
	     local owner path fires instead of the registry. -->
	<ResizeGutter index={0} onDragStart={startSplitDrag} />
	<WorkspaceFileTabs
		tabs={openTabs.map((p) => ({ path: p }))}
		activePath={activeFile}
		onActivate={(p) => onActivateTab?.(p)}
		onClose={(p) => onCloseTab?.(p)}
	>
		{#if activeFile !== null}
			{#if home !== undefined}
				<!-- The Settings Tree ADR D2: a home file rides the DSI-local
				     plane — a lean editor, no git faces (a home has none). -->
				<SettingsHomeFile {home} path={activeFile} />
			{:else if sessionId !== null}
				<!-- The floor file component, reused whole: it owns the
				     fetch, the buffer, and save (BC-1 untouched, §7). -->
				<WorkspaceFilePanel
				{sessionId}
				path={activeFile}
				{root}
				highlightLines={lineTarget}
				onhighlightdone={() => (lineTarget = null)}
				onclose={() => {}}
			/>
			{/if}
		{/if}
	</WorkspaceFileTabs>
</div>

<style>
	/* The Explorer Layout split (ADR D4 as amended 2026-10-27): the tree
	   lane is a FIXED PIXEL region (--tree-basis in px) — a parent-driven
	   panel resize grows/shrinks ONLY the file tabs; the gutter drag is
	   the only thing that moves the seam. NO wrapper regions — the three
	   are direct flex children (.explorer, .gutter, .file-tabs), so the
	   gutter physically sits between tree and file. In 'panels' layout
	   the wrapper keeps its block flow — these rules never apply. */
	.split {
		display: flex;
		height: 100%;
		min-height: 0;
		overflow: hidden;
	}
	/* The tree: fixed px basis, no grow/shrink — a panel resize and the
	   gutter drag are the only things that move it. */
	.split > :global(.explorer) {
		flex: 0 0 var(--tree-basis, 280px);
		min-width: 0;
		overflow: hidden;
	}
	/* The file tabs: absorb whatever the panel has left — every
	   parent-driven resize lands here, never on the tree. */
	.split > :global(.file-tabs) {
		flex: 1 1 auto;
		min-width: 0;
		overflow: hidden;
	}
</style>
