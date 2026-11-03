<script lang="ts">
	/**
	 * PluginManagerPanel — The Plugin Rack (ADR 2026-09-27, D1): the
	 * panel is the STATE OWNER and owns its fetches (/api/plugins/*);
	 * it never touches the engine or dsh. One list, per-row verb: an
	 * uninstalled row offers install, an installed row offers uninstall
	 * (the manifest is the uninstall authority, D4 — the snapshot's
	 * installed flag is the API's derived copy). A successful apply ends
	 * with the DSH restart chain: the floor goes down and re-attaches on
	 * the same URL (D5) — the banner says so BEFORE the fetch storms.
	 */
	import { onMount } from 'svelte';
	import { t } from '$lib/services/locale/locale-state.svelte';
	import * as m from '$lib/paraglide/messages';
	import { LoaderCircle } from '@lucide/svelte';
	import PluginManagerHeader from './PluginManagerHeader.svelte';
	import PluginManagerToolbar from './PluginManagerToolbar.svelte';
	import PluginManagerInstall from './PluginManagerInstall.svelte';
	import PluginManagerSection, { type RackPlugin, type RackSource } from './PluginManagerSection.svelte';

	interface Props {
		/** Session-only refresh token (BUG 2026-10-05, same contract as the
		 *  shelf's): the floor bumps it on /dsi-plugins --reload dedupe so
		 *  the open rack re-fetches the rebuilt snapshot. */
		refreshToken?: number;
		/** Persisted chrome (the explorer-tab pattern): the active pill tab.
		 *  Junk sanitizes to 'install'. */
		initialTab?: 'install' | 'uninstall';
		/** Reports the active tab up to the panel entry (hard-reload survival). */
		ontabchange?: (tab: 'install' | 'uninstall') => void;
	}
	let { refreshToken = 0, initialTab = 'install', ontabchange }: Props = $props();

	interface RackSnapshot {
		generatedAt: string;
		profile: string;
		sources?: RackSource[]; // v2: grouped by repository (Shelf Chrome grammar)
		plugins: RackPlugin[]; // flat derived copy (v1 back-compat)
	}
	interface ErrorRow {
		id: string;
		error: string;
	}

	let snapshot = $state<RackSnapshot | null>(null);
	let loadFailed = $state(false);
	// D5 ext (amendment IV): an apply bounces the floor and can kill the very
	// page this panel lives in, so waitFloorBack's self-refresh may never run.
	// The marker outlives the reload (sessionStorage — dies with the tab,
	// exactly the bounce's lifetime); the remounted rack says what happened
	// instead of training the operator to click apply twice.
	const APPLY_MARKER = 'rack-just-applied';
	const APPLY_MARKER_MAX_AGE_MS = 120_000;
	let bounceNote = $state(false);
	let loading = $state(true);
	let floorBounce = $state(false);
	let errors = $state<ErrorRow[]>([]);
	// GitHub stargazers per plugin id — the snapshot/reload responses carry
	// them best-effort; an absent fetch simply leaves the badge off the row.
	let stars = $state<Record<string, number>>({});
	// The shelf's tab grammar (Shelf Chrome ADR): install lists uninstalled
	// plugins, uninstall lists installed ones - a successful apply MOVES the
	// row (the post-apply load() refetch flips the installed flag).
	// Sanitize through a value expression: junk falls to 'install', and the
	// direct prop reference would trip svelte's state_referenced_locally warn.
	// svelte-ignore state_referenced_locally -- intentional one-time init; later changes to initialTab must not move the tab.
	let tab = $state<'install' | 'uninstall'>(initialTab === 'uninstall' ? 'uninstall' : 'install');
	function setTab(next: 'install' | 'uninstall'): void {
		tab = next;
		// Selection is door-scoped (amendment IV): switching doors drops it.
		selected = new Set();
		// the bounce note's acknowledgment is the operator's next gesture
		if (bounceNote) {
			bounceNote = false;
			sessionStorage.removeItem(APPLY_MARKER);
		}
		ontabchange?.(next);
	}
	// The bounce wait (D5 answers-first): the server is DOWN while the chain
	// re-serves, so the poll expects failures and polls through them until a
	// snapshot answers again — then load() refreshes the panel by itself. No
	// operator hard-reload.
	const BOUNCE_POLL_MS = 1500;
	const BOUNCE_TIMEOUT_MS = 120_000;
	let searchQ = $state('');
	let rootEl = $state<HTMLElement | null>(null);
	let visiblePlugins = $derived.by(() => {
		const rows = snapshot?.plugins.filter((p) => (tab === 'install' ? !p.installed : p.installed)) ?? [];
		const q = searchQ.trim().toLowerCase();
		if (!q) return rows;
		// The needle searches the row's identity: display name, id, repo, author.
		return rows.filter((p) =>
			[p.n, p.id, p.repo, p.author ?? ''].some((s) => s.toLowerCase().includes(q))
		);
	});

	/** Poll through the bounce: the floor answers failures until the chain
	 *  has re-served, then one snapshot success ends the wait. False on
	 *  timeout (the banner gives way to the retry UI; polling never hangs). */
	async function waitFloorBack(): Promise<boolean> {
		const deadline = Date.now() + BOUNCE_TIMEOUT_MS;
		while (Date.now() < deadline) {
			await new Promise((resolve) => setTimeout(resolve, BOUNCE_POLL_MS));
			try {
				const res = await fetch('/api/plugins/snapshot', { cache: 'no-store' });
				if (res.ok) return true;
			} catch {
				// floor still down — keep polling
			}
		}
		return false;
	}

	async function load(): Promise<void> {
		loading = true;
		loadFailed = false;
		try {
			const res = await fetch('/api/plugins/snapshot');
			const body = await res.json();
			if (body.ok) {
				snapshot = body.snapshot;
				stars = body.stars ?? {};
				// the note STAYS: it explains this very list; the tab switch is the
				// operator's acknowledgment (setTab clears it)
			} else loadFailed = true;
		} catch {
			loadFailed = true;
		} finally {
			loading = false;
		}
	}

	// The header's reload verb is a REBUILD, not a re-read (RCA 2026-09-27:
	// wired to load() it only re-fetched the cached snapshot — the button
	// looked dead because a cached GET cannot change). POST --reload asks
	// the engine to re-take the snapshot (fresh numbering + manifest-
	// reconciled installed flags) and the body carries it directly.
	async function runReload(): Promise<void> {
		if (loading || floorBounce) return;
		loading = true;
		loadFailed = false;
		errors = [];
		try {
			const res = await fetch('/api/plugins/reload', { method: 'POST' });
			const body = await res.json();
			if (body.ok && body.snapshot) {
				snapshot = body.snapshot;
				stars = body.stars ?? {};
			} else loadFailed = true;
		} catch {
			loadFailed = true;
		} finally {
			loading = false;
		}
	}

	// The --reload-on-open-rack contract (BUG 2026-10-05): the floor bumps
	// refreshToken after the server-side rebuild; the FIRST value is the
	// mount itself (load in onMount), every CHANGE re-fetches.
	// svelte-ignore state_referenced_locally -- intentional: the seed is the
	// mount-time value; only later CHANGES re-fetch.
	let lastRefreshToken = refreshToken;
	$effect(() => {
		if (refreshToken !== lastRefreshToken) {
			lastRefreshToken = refreshToken;
			void load();
		}
	});


	// Shelf selection grammar (3.3): one Set keyed by row n; the bottom bar
	// applies ALL selected rows in ONE POST, then clears and reloads.
	let selected = $state<ReadonlySet<string>>(new Set());
	// Shelf Chrome: sources ship COLLAPSED; the chevron or the expand-all
	// verb opens one repo's rows.
	let collapsedGroups = $state<ReadonlySet<string>>(new Set());
	const visibleSources = $derived.by(() => {
		const q = searchQ.trim().toLowerCase();
		let rows = snapshot?.plugins ?? [];
		rows = rows.filter((p) => (tab === 'install' ? !p.installed : p.installed));
		if (q) rows = rows.filter((p) => [p.n, p.id, p.repo, p.author ?? '', p.description ?? ''].some((x) => x.toLowerCase().includes(q)));
		const srcs = snapshot?.sources ?? [];
		if (srcs.length > 0) {
			// v2 wire: sources are authoritative; filter their rows by the tab/search.
			return srcs
				.map((src, si) => ({
					...src,
					n: String(si + 1),
					plugins: rows.filter((p) => src.plugins.some((sp) => sp.n === p.n)).map((p, ri) => ({ ...p, dn: (si + 1) + '.' + (ri + 1) }))
				}))
				.filter((src) => src.plugins.length > 0);
		}
		// v1 back-compat: group the flat rows by repo tail (Plugin Garden ADR, D1).
		const groups = new Map<string, { id: string; n: string; name?: string; author: string | null; repo: string; plugins: RackPlugin[] }>();
		for (const p of rows) {
			const tail = p.repo.replace(/\.git$/, '').replace(/\/+$/, '').split('/').slice(-2).join('/');
			const gid = tail || p.repo;
			if (!groups.has(gid)) groups.set(gid, { id: gid, n: String(groups.size + 1), name: gid.split('/').pop(), author: p.author ?? null, repo: p.repo, plugins: [] });
			groups.get(gid)!.plugins.push(p);
		}
		return [...groups.values()];
	});
	function toggleGroup(id: string): void {
		const next = new Set(collapsedGroups);
		if (next.has(id)) next.delete(id);
		else next.add(id);
		collapsedGroups = next;
	}
	function collapseAll(): void {
		collapsedGroups = new Set(visibleSources.map((src) => src.id));
	}
	function expandAll(): void {
		collapsedGroups = new Set();
	}
	// Both doors speak the selection grammar (amendment IV): the visible
	// rows are already tab-filtered, so the count is just the selection.
	const applyCount = $derived(visibleSources.flatMap((src) => src.plugins).filter((p) => selected.has(p.n)).length);
	function toggleSelect(n: string): void {
		const next = new Set(selected);
		if (next.has(n)) next.delete(n);
		else next.add(n);
		selected = next;
	}
	async function runApply(): Promise<void> {
		if (applyCount === 0 || floorBounce) return;
		const action = tab === 'install' ? 'install' : 'remove';
		const targets = [...selected];
		const idByN = new Map(visibleSources.flatMap((src) => src.plugins).filter((p) => selected.has(p.n)).map((p) => [p.n, p.id]));
		errors = [];
		try {
			const res = await fetch('/api/plugins/apply', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ action, targets })
			});
			const body = await res.json();
			if (body.ok && body.restarting) {
				// D5: the chain kills this very server — announce the bounce, ride
				// it out, and let the panel refresh ITSELF when the floor returns.
				floorBounce = true;
				selected = new Set();
				try {
					sessionStorage.setItem(APPLY_MARKER, JSON.stringify({ action, targets, at: Date.now() }));
				} catch {
					// storage full/blocked: the note is best-effort, the bounce is not
				}
				void waitFloorBack().then(async (back) => {
					if (back) await load();
					else loadFailed = true;
					floorBounce = false;
				});
				return;
			}
			if (!body.ok) {
				const results = body.results ?? [];
				errors = results.length
					? results
							.filter((r: { ok: boolean }) => !r.ok)
							.map((r: { id?: string; n?: string; error?: string }) => ({ id: r.id ?? idByN.get(String(r.n)) ?? targets[0], error: r.error ?? '' }))
					: [{ id: idByN.get(targets[0]) ?? targets[0], error: '' }];
				selected = new Set();
			} else {
				selected = new Set();
				await load();
			}
		} catch {
			errors = targets.map((n) => ({ id: idByN.get(n) ?? n, error: 'network' }));
		} finally {
		}
	}

	onMount(() => {
		try {
			const raw = sessionStorage.getItem(APPLY_MARKER);
			const mark = raw ? (JSON.parse(raw) as { at?: number }) : null;
			if (mark && typeof mark.at === 'number' && Date.now() - mark.at <= APPLY_MARKER_MAX_AGE_MS) bounceNote = true;
			else if (raw) sessionStorage.removeItem(APPLY_MARKER); // stale junk sanitizes away
		} catch {
			sessionStorage.removeItem(APPLY_MARKER);
		}
		void load();
	});
</script>

<div class="rack" bind:this={rootEl} data-testid="rack-body">
	<PluginManagerToolbar generatedAt={snapshot?.generatedAt ?? ''} bind:searchQ />
	<PluginManagerHeader {tab} {loading} {floorBounce} ontabchange={setTab} onreload={() => void runReload()} oncollapseall={collapseAll} onexpandall={expandAll} />

		{#if floorBounce}
			<div class="rack-banner" data-testid="rack-bounce" role="status">{t(m.pluginRackApplying)}</div>
		{:else if loading}
			<div class="rack-note"><span class="spin"><LoaderCircle size={14} /></span></div>
		{:else if loadFailed || !snapshot}
			<div class="rack-note" data-testid="rack-load-failed">
				{t(m.pluginRackLoadFailed)}
				<button type="button" onclick={() => void load()}>{t(m.pluginRackRetry)}</button>
			</div>
		{:else if snapshot.plugins?.length === 0}
			<div class="rack-note" data-testid="rack-empty">{t(m.pluginRackEmpty)}</div>
		{:else if visibleSources.length === 0}
			<div class="rack-note" data-testid="rack-tab-empty">
				{tab === 'install' ? t(m.pluginRackInstallEmpty) : t(m.pluginRackUninstallEmpty)}
			</div>
		{:else}
			{#if bounceNote}<div class="rack-note" data-testid="rack-apply-note" role="status">{t(m.pluginRackApplyNote)}</div>{/if}
			{#each visibleSources as source (source.id + source.repo)}
				<PluginManagerSection
					{tab}
					{stars}
					{source}
					{selected}
					ontoggleselect={toggleSelect}
					ontoggle={() => toggleGroup(source.id)}
					collapsed={collapsedGroups.has(source.id)}
				/>
			{/each}
			{#if errors.length > 0}
				<ul class="rack-errors" data-testid="rack-errors">
					{#each errors as e (e.id)}
						<li class="rack-error">{e.id}: {e.error}</li>
					{/each}
				</ul>
			{/if}
			<PluginManagerInstall {tab} count={applyCount} {floorBounce} onapply={() => void runApply()} />
		{/if}
</div>
<style>
	.rack {
		position: relative;
		display: flex;
		flex-direction: column;
		flex: 1;
		min-height: 0;
		height: 100%;
		box-sizing: border-box;
		gap: 0.25rem;
		font-size: 0.85rem;
		padding-bottom: 3.2rem;
	}
	.rack-note {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		opacity: 0.75;
		padding: 0.25rem 0.5rem;
	}
	.rack-banner {
		padding: 0.5rem 0.6rem;
		border-radius: 6px;
		background: color-mix(in srgb, orange 18%, transparent);
	}
	.rack-errors {
		list-style: none;
		margin: 0;
		padding: 0.4rem 0.5rem;
		border-radius: 6px;
		background: color-mix(in srgb, red 12%, transparent);
		font-size: 0.75rem;
		overflow-wrap: anywhere;
	}
	.spin {
		display: inline-flex;
		animation: rack-spin 1s linear infinite;
	}
	@keyframes rack-spin {
		to {
			transform: rotate(360deg);
		}
	}
</style>
