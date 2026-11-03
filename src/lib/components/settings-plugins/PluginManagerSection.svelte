<script module lang="ts">
	/** Shared rack wire types — the section renders one source's rows;
	 * the panel (state owner) derives the filtered list and hands it in. */
	export interface RackPlugin {
		n: string;
		id: string;
		group?: 'owned' | 'external'; // v2 wire: owned = plugins/ scan, external = reff
		description?: string | null;
		version?: string | null;
		dn?: string; // display number, e.g. 1.1 (source number . row number)
		authorUrl?: string | null;
		repo: string;
		author: string | null;
		installed: boolean;
	}
	export interface RackSource {
		n?: string;
		name?: string;
		id: string;
		author: string | null;
		repo: string;
		plugins: RackPlugin[];
	}
</script>

<script lang="ts">
	import { t } from '$lib/services/locale/locale-state.svelte';
	import * as m from '$lib/paraglide/messages';
	import { ChevronDown, ChevronRight } from '@lucide/svelte';
	import PluginManagerStars from './PluginManagerStars.svelte';

	interface Props {
		/** One source (repo group) with its already tab/search-filtered rows. */
		source: RackSource;
		/** Shelf Chrome: sources ship COLLAPSED; the chevron opens one repo's rows. */
		collapsed: boolean;
		/** GitHub stargazers per plugin id (best-effort; absent = badge off). */
		stars: Record<string, number>;
		/** The shelf's tab grammar: BOTH doors speak the selection grammar
		 *  (Plugin Rack amendment IV 2026-10-31) — install rows select for
		 *  install, installed rows select for remove; the per-row verb and
		 *  the Installed badge are deleted (the badge only ever rendered on
		 *  the tab where every row is installed). */
		tab: 'install' | 'uninstall';
		/** Shelf selection grammar (3.3): one Set keyed by row n. */
		selected: ReadonlySet<string>;
		ontoggle: () => void;
		ontoggleselect: (n: string) => void;
	}
	let { source, collapsed, stars, tab, selected, ontoggle, ontoggleselect }: Props = $props();
</script>

<div class="rack-source" data-testid={'rack-source-' + source.id.replace(/[^a-zA-Z0-9-]/g, '-')}>
	<button
		type="button"
		class="rack-source-head"
		data-testid={'rack-source-head-' + source.id.replace(/[^a-zA-Z0-9-]/g, '-')}
		aria-expanded={collapsed ? 'false' : 'true'}
		onclick={ontoggle}
	>
		<span class="rack-source-chevron">{#if collapsed}<ChevronRight size={12} aria-hidden="true" />{:else}<ChevronDown size={12} aria-hidden="true" />{/if}</span>
		<span class="rack-source-num">{source.n}.</span>
		{#if source.author}
		<span class="rack-source-author">by {source.author}</span>
		{:else}
		<span class="rack-source-name">{source.name ?? source.id}</span>
		{/if}
		<PluginManagerStars id={source.id} repo={source.repo} author={source.author} plugins={source.plugins} {stars} />
	</button>
	{#if !collapsed}
		<ul class="rack-rows" data-testid={'rack-rows-' + source.id.replace(/[^a-zA-Z0-9-]/g, '-')}>
			{#each source.plugins as plugin (plugin.n)}
				<li class="rack-row" class:rack-row-selected={selected.has(plugin.n)} data-testid={'rack-row-' + plugin.id}>
					{#if tab === 'uninstall' || !plugin.installed}
						<input
							type="checkbox"
							class="rack-check"
							data-testid={'rack-select-' + plugin.n}
							checked={selected.has(plugin.n)}
							onchange={() => ontoggleselect(plugin.n)}
						/>
					{/if}
					<span class="rack-n">{plugin.dn}</span>
					<span class="rack-id">
						{plugin.id}
					</span>
					{#if plugin.description}
						<span class="rack-desc">{plugin.description}</span>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
</div>
<style>
	.rack-source {
		display: flex;
		flex-direction: column;
	}
	.rack-source-head {
		display: flex;
		align-items: center;
		gap: 0.3rem;
		white-space: nowrap;
		width: 100%;
		background: none;
		border: 0;
		padding: 0.15rem 0.3rem;
		cursor: pointer;
		color: inherit;
		font-weight: 600;
		text-align: left;
	}
	.rack-source-head:hover {
		background: color-mix(in srgb, currentcolor 6%, transparent);
	}
	.rack-source-chevron {
		display: inline-flex;
		align-items: center;
	}
	.rack-source-chevron :global(svg) {
		display: block;
	}
	.rack-source-num {
		opacity: 0.55;
		font-variant-numeric: tabular-nums;
		padding-right: 0.15rem;
	}
	.rack-source-name {
		display: inline;
	}
	.rack-source-author {
		display: inline;
		font-weight: 400;
		opacity: 0.75;
	}
	.rack-rows {
		list-style: none;
		margin: 0;
		padding: 0 0 0 1.1rem;
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}
	.rack-row {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		padding: 0.12rem 0 0 1.4rem;
		border-radius: 6px;
	}
	.rack-row:hover {
		background: color-mix(in srgb, currentcolor 6%, transparent);
	}
	.rack-row-selected,
	.rack-row:has(.rack-check:checked) {
		background: color-mix(in srgb, var(--color-accent-blue, #3b82f6) 10%, transparent);
	}
	.rack-check {
		appearance: none;
		width: 0.9rem;
		height: 0.9rem;
		margin: 0;
		border: 1.5px solid var(--color-surface-border, #8b949e);
		border-radius: 3px;
		background: var(--color-surface, var(--color-surface-elevated));
		cursor: pointer;
		flex-shrink: 0;
		display: inline-block;
		vertical-align: middle;
	}
	.rack-check:checked {
		background: var(--color-accent-blue, #3b82f6);
		border-color: var(--color-accent-blue, #3b82f6);
		box-shadow: inset 0 0 0 2px var(--color-surface, var(--color-surface-elevated));
	}
	.rack-n {
		opacity: 0.55;
		font-variant-numeric: tabular-nums;
		padding-right: 0.15rem;
	}
	.rack-id {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		min-width: 0;
	}
	.rack-desc {
		color: var(--color-text-muted, #888);
		font-size: 0.78rem;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		flex: 1;
		min-width: 0;
	}
</style>
