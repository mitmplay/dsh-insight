<script lang="ts">
	/**
	 * PluginManagerHeaderActions - the rack header's action cluster,
	 * the shelf HeaderActions' grammar (SettingsSkillsHeaderActions,
	 * The Shelf Chrome ADR): the reload verb + the lineage-fold pill
	 * (collapse-all / expand-all, sits AFTER the reload verb).
	 * Presentational: every verb and all state are owned by
	 * PluginManagerPanel.
	 */
	import { t } from '$lib/services/locale/locale-state.svelte';
	import * as m from '$lib/paraglide/messages';
	import { ChevronsDownUp, ChevronsUpDown } from '@lucide/svelte';
	import PluginManagerReloadButton from './PluginManagerReloadButton.svelte';

	interface Props {
		loading: boolean;
		floorBounce: boolean;
		onreload: () => void;
		oncollapseall: () => void;
		onexpandall: () => void;
	}
	let { loading, floorBounce, onreload, oncollapseall, onexpandall }: Props = $props();
</script>

<div class="rack-header-actions">
	<PluginManagerReloadButton disabled={loading || floorBounce} {onreload} />
	<!-- The fold pill grammar (SidebarOpenPanelTree): ONE joined pill,
	     icon-only segments; sits AFTER the reload verb (Shelf Chrome). -->
	<div class="seg-group" role="group" aria-label={t(m.pluginRackTitle)} data-testid="rack-fold-toggle">
		<button
			type="button"
			class="seg left"
			data-testid="rack-collapse-all"
			onclick={oncollapseall}
		>
			<ChevronsDownUp size={12} aria-hidden="true" />
		</button>
		<button
			type="button"
			class="seg right"
			data-testid="rack-expand-all"
			onclick={onexpandall}
		>
			<ChevronsUpDown size={12} aria-hidden="true" />
		</button>
	</div>
</div>

<style>
	.rack-header-actions {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		flex-shrink: 0;
	}
	.seg-group {
		flex-shrink: 0;
		display: flex;
		align-items: stretch;
	}
	.seg {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		border: 1px solid color-mix(in srgb, var(--color-accent-blue, #3b82f6) 35%, var(--color-surface-elevated));
		background: transparent;
		color: var(--color-slate-neutral);
		line-height: 1;
		padding: 0.15rem 0.275rem;
		cursor: pointer;
		transition:
			color 0.15s ease,
			border-color 0.15s ease,
			background-color 0.15s ease;
	}
	.seg :global(svg) {
		display: block;
	}
	.seg.left {
		border-top-right-radius: 0;
		border-bottom-right-radius: 0;
		border-top-left-radius: 9999px;
		border-bottom-left-radius: 9999px;
	}
	.seg.right {
		border-top-left-radius: 0;
		border-bottom-left-radius: 0;
		border-top-right-radius: 9999px;
		border-bottom-right-radius: 9999px;
		border-left-width: 0;
	}
	.seg:not(:disabled):hover {
		border-color: color-mix(in srgb, var(--color-accent-blue, #3b82f6) 50%, var(--color-navy-focus));
		color: color-mix(in srgb, var(--color-accent-blue, #3b82f6) 50%, var(--color-navy-focus));
		background: color-mix(in srgb, var(--color-accent-blue, #3b82f6) 12%, var(--color-surface-elevated));
	}
	.seg:focus-visible {
		outline: 2px solid var(--color-navy-focus);
		outline-offset: -2px;
	}
</style>
