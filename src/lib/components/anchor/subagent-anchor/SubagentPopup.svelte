<script lang="ts">
	import { onMount } from 'svelte';
	import FloatingAnchorContainerPopup from '$lib/components/common/containers/FloatingAnchorContainerPopup.svelte';
	import { subagentClock } from '$lib/services/conversation/subagent-clock.svelte';
	import { addPanelFromSidebar } from '$lib/services/panels/panel-registry';
	import { floor } from '$lib/services/panels/floor-registry.svelte';
	import { getWorkspaceState } from '$lib/services/conversation/workspace-context.svelte';
	import { Trash2, LoaderCircle, CircleDashed } from '@lucide/svelte';
	import * as m from '$lib/paraglide/messages';
	import { t } from '$lib/services/locale/locale-state.svelte';
	import { formatCompact } from '$lib/utils/compact-number';
	import type { DsiSubagentRow } from '$lib/types';

	/**
	 * SubagentPopup — the ledger half of the Subagent Anchor (Subagent
	 * Anchor ADR D1/D5, amendment D6/D7): every spawned session as ONE flat
	 * row — title · tokens · elapsed — inside the house popup shell (Esc /
	 * outside close, right-full placement, width cap). The popup owns NO
	 * state: rows arrive as props from the anchor button's poll; elapsed
	 * lives only in the subagent-clock registry; lineage is re-derived
	 * per fetch upstream, never written here.
	 *
	 * D6 header: shell title row + the count chip (N helpers, M running).
	 * D5 sort: running first, then token spend descending (nulls last).
	 * D7 footer: Σ over EXACTLY the header's rows; any null-degraded row
	 * flips it to the honest Σ-incomplete marker — a partial sum must never
	 * read as whole. Elapsed is NOT summed (concurrent wall-clocks add to
	 * nothing). The footnote states the one-tick first-sight bias.
	 */
	let {
		open = $bindable(false),
		triggerEl = undefined,
		rows,
		onopenrow
	}: {
		/** Popup open state — bindable into the shared shell. */
		open?: boolean;
		/** The toggle button's wrapper — the shell's close-contract exclusion. */
		triggerEl?: HTMLElement | undefined;
		/** The join's rows (the button's latest poll). */
		rows: DsiSubagentRow[];
		/** Row click — the existing session-open routing, threaded from the mount. */
		onopenrow?: (sessionId: string) => void;
	} = $props();

	// Live elapsed while the popup is visible: one 1s tick drives every
	// running row (elapsedMs reads the registry's tick state, so this
	// re-renders them). Ticking only while open; the poll cadence owns data.
	onMount(() => {
		const iv = setInterval(() => {
			if (open) subagentClock.tick();
		}, 1000);
		return () => clearInterval(iv);
	});

	const spend = (row: DsiSubagentRow): number =>
		row.tokens === null ? -1 : row.tokens.input + row.tokens.output;

	/** D5: running first, then token spend desc (unknown spends last),
	 *  then session id for a stable tiebreak. */
	const sorted = $derived(
		[...rows].sort(
			(a, b) =>
				Number(b.running) - Number(a.running) ||
				spend(b) - spend(a) ||
				a.sessionId.localeCompare(b.sessionId)
		)
	);
	const runningCount = $derived(rows.filter((r) => r.running).length);
	const anyUnknown = $derived(rows.some((r) => r.tokens === null));
	const totalTokens = $derived(
		rows.reduce((acc, r) => (r.tokens === null ? acc : acc + r.tokens.input + r.tokens.output), 0)
	);

	/** True when this helper's panel is already open on the floor — the
	 *  row tints so the operator sees which helpers live in the zoom. */
	function onFloor(sessionId: string): boolean {
		return floorPanelId(sessionId) !== null;
	}

	/** The floor panel id hosting this helper, null when not open. */
	function floorPanelId(sessionId: string): string | null {
		// 'sessionId' in panel narrows the DsiPanelEntry union — only the
		// session-bearing branches carry it.
		return floor.panels.find((panel) => 'sessionId' in panel && panel.sessionId === sessionId)?.id ?? null;
	}

	/** Row click is a TOGGLE (operator, 2026-10-26 review): not on the
	 *  floor → adopt (the ghost-adopt verb, into the PanelsZoom view);
	 *  already open → bring it OUT (the RowButtonClose verb — the host's
	 *  workspace-state remove). */
	function toggleRow(sessionId: string): void {
		const panelId = floorPanelId(sessionId);
		if (panelId !== null) {
			getWorkspaceState()?.remove(panelId);
			return;
		}
		addPanelFromSidebar({ sessionId, agentPreset: null });
	}

	/** Any helper live on the floor — the close-all X's visibility. */
	const anyOnFloor = $derived(rows.some((r) => onFloor(r.sessionId)));

	/** Close every helper's panel (the chip X): the RowButtonClose verb
	 *  per open helper panel. */
	function closeAll(): void {
		for (const r of rows) {
			const panelId = floorPanelId(r.sessionId);
			if (panelId !== null) getWorkspaceState()?.remove(panelId);
		}
	}

	/** Compact ledger form, DSH GUI parity — null renders the dash (never 0). */
	function tokensLabel(row: DsiSubagentRow): string {
		if (row.tokens === null) return '—';
		return `${formatCompact(row.tokens.input + row.tokens.output)} tok`;
	}

	/** Elapsed label — the ledger's operate time (llmMs, the stats bar's
	 *  own 'LLM …' number, settled rows included). The first-sight clock is
	 *  the FALLBACK for rows the host cannot date; null renders the dash
	 *  (never a guess). */
	function elapsedLabel(row: DsiSubagentRow): string {
		let ms: number | null;
		if (typeof row.operateMs === 'number') {
			ms = row.operateMs;
		} else {
			ms = subagentClock.elapsedMs(row.sessionId);
		}
		if (ms === null) return '—';
		const s = Math.floor(ms / 1000);
		if (s < 60) return `${s}s`;
		const m = Math.floor(s / 60);
		if (m < 60) return `${m}m ${s % 60}s`;
		return `${Math.floor(m / 60)}h ${m % 60}m`;
	}
</script>

<FloatingAnchorContainerPopup
	bind:open
	{triggerEl}
	popupTestId="subagent-popup"
>
	<div
		class="flex items-center border-b border-surface-border px-2.5 py-1 text-[10px] uppercase tracking-wider text-text-muted"
		data-testid="subagent-popup-chip"
	>
		<span class="flex-1">{rows.length}
		{rows.length === 1 ? 'subagent' : 'subagents'} · {runningCount} running</span>
		{#if anyOnFloor}
			<button
				type="button"
				class="shrink-0 transition-colors"
				title={t(m.subagentCloseAllPanels)}
				aria-label={t(m.subagentCloseAllPanels)}
				data-testid="subagent-popup-close-all"
				onclick={(e) => {
					e.stopPropagation();
					closeAll();
				}}
			>
				<Trash2 size={14} aria-hidden="true" style="stroke: red;" />
			</button>
		{/if}
	</div>
	{#each sorted as row (row.sessionId)}
		<button
			type="button"
			class="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-surface-hover {onFloor(row.sessionId) ? 'row-on-floor' : ''}"
			data-testid="subagent-row"
			onclick={() => {
				// TOGGLE (operator, 2026-10-26 review): not on the floor →
				// adopt (the ghost-adopt verb, into the PanelsZoom view);
				// already open → bring it OUT (the RowButtonClose verb).
				if (onopenrow) {
					onopenrow(row.sessionId);
					return;
				}
				toggleRow(row.sessionId);
			}}
		>
			<!-- Status icon (2026-10-26, operator request): a RUNNING row spins —
			     live work is visibly live, same convention as JobRosterList. -->
			<span
				class="flex shrink-0 items-center {row.running ? 'text-amber-500' : 'text-text-muted'}"
				data-testid="subagent-row-glyph"
			>
				{#if row.running}
					<LoaderCircle size={11} class="animate-spin" />
				{:else}
					<CircleDashed size={11} />
				{/if}
			</span>
			<span class="min-w-0 flex-1 truncate">{row.title ?? '—'}</span>
			<span class="w-20 shrink-0 text-right font-variant-numeric tabular-nums" data-testid="subagent-row-tokens"
				>{tokensLabel(row)}</span
			>
			<span class="w-14 shrink-0 text-right text-text-muted tabular-nums" data-testid="subagent-row-elapsed"
				>{elapsedLabel(row)}</span
			>
		</button>
	{/each}
	<div
		class="sticky bottom-0 flex items-center border-t border-surface-border bg-surface-elevated px-2.5 py-1.5 text-[12px] font-medium tracking-wider {anyUnknown
			? 'text-text-muted'
			: 'text-text-primary'}"
		data-testid="subagent-popup-footer"
		style="padding-right: 6em;"
	>
		<span class="flex-1 text-right">{t(() => m.totalTokens())}</span>
		<span class="w-20 shrink-0 text-right font-variant-numeric tabular-nums" data-testid="subagent-popup-footer-tokens"
			>{anyUnknown ? '—' : `${formatCompact(totalTokens)} tok`}</span
		>
	</div>
</FloatingAnchorContainerPopup>

<style>
	/* A helper whose panel is already open on the floor (living in the
	   zoom) tints its row — the same accent wash the focused panel's
	   ring uses, quieter: the popup asks 'where is it', the row answers. */
	.row-on-floor {
		background: color-mix(in srgb, var(--color-accent-blue, #3b82f6) 12%, transparent);
	}

	.row-on-floor:hover {
		background: color-mix(in srgb, var(--color-accent-blue, #3b82f6) 18%, transparent);
	}
</style>
