<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import { t } from '$lib/services/locale/locale-state.svelte';
	/**
	 * ContextConsumption — context window usage indicator (OCI port,
	 * 2026-08-23; percentage wired 2026-08-24). Two display modes:
	 *
	 *   both values,   → OCI's exact bar: colored progress (green <60%,
	 *   used > 0         amber <85%, red ≥85%) + percentage label
	 *   used only     → DSI fallback: "≈12.3k ctx" text label. The DSH
	 *                    wire reports per-step usage but no model context
	 *                    window, so when the model is unknown to the
	 *                    local catalog (context-window.ts) the bar has
	 *                    no denominator — the label keeps the slot
	 *                    honest instead of dead.
	 *   used = 0      → the fallback label too ("≈0 ctx"): a zero-usage
	 *                    turn would otherwise paint a 0%-wide bar — a dead
	 *                    slot (SC#1, 2026-11-01).
	 *   neither       → renders nothing (OCI contract).
	 *
	 * `used` = what the LAST model request consumed: input + cache-read +
	 * cache-write tokens (the full prompt the model saw) — see
	 * contextTokensOf in turn-grouping's page usage. `limit` today is
	 * CLIENT-RESOLVED from the model id (catalog + dsi-ctx-windows
	 * overrides), never wire truth — the bar's tooltip says so.
	 */
	let {
		used = undefined,
		limit = undefined
	}: {
		/** Context tokens consumed by the last request (wire usage). */
		used?: number | undefined;
		/** Model context window size — absent on the DSH wire today. */
		limit?: number | undefined;
	} = $props();

	const percent = $derived(
		used !== undefined && used > 0 && limit !== undefined && limit > 0
			? Math.round((used / limit) * 100)
			: undefined
	);

	function formatK(n: number): string {
		return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
	}
</script>

{#if percent !== undefined}
	<div
		class="flex items-center gap-1"
		title={t(() => m.ctxWindowTitle({ used: used!, limit: limit! }))}
		data-testid="context-consumption"
	>
		<div class="h-1 w-15 overflow-hidden rounded-sm bg-surface-border">
			<div
				class="h-full rounded-sm transition-[width] duration-300 bg-[var(--color-accent-deep)]"
				style="width: {Math.min(percent, 100)}%"
			></div>
		</div>
		<span class="text-[11px] tabular-nums text-[var(--color-accent-deep)]">{percent}%</span>
	</div>
{:else if used !== undefined}
	<span
		class="text-[11px] tabular-nums text-[var(--color-accent-deep)]"
		title={t(m.ctxWindowUnknown)}
		data-testid="context-consumption"
	>
		≈{formatK(used)} ctx
	</span>
{/if}
