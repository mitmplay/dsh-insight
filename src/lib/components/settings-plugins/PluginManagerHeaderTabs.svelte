<script lang="ts">
	/**
	 * PluginManagerHeaderTabs - the rack's install/uninstall tab pill
	 * (The Plugin Rack ADR, 2026-09-27, D1; amendment IV 2026-10-31):
	 * the joined-pill grammar now lives ONCE in the shared
	 * SegmentedTabs (Tailwind) — this is a thin adapter speaking the
	 * rack's native tab vocabulary and keeping the rack testids.
	 * Presentational - tab state lives in PluginManagerPanel.
	 */
	import { t } from '$lib/services/locale/locale-state.svelte';
	import * as m from '$lib/paraglide/messages';
	import SegmentedTabs from '$lib/components/common/tabs/SegmentedTabs.svelte';

	interface Props {
		tab: 'install' | 'uninstall';
		ontabchange: (tab: Props['tab']) => void;
	}
	let { tab, ontabchange }: Props = $props();
</script>

<!-- The joined-pill grammar (SegmentedTabs, amendment IV): Install | Uninstall. -->
<SegmentedTabs
	active={tab}
	groupTestid="rack-tabs"
	ariaLabel={t(m.pluginRackTitle)}
	onchange={(id) => ontabchange(id === 'uninstall' ? 'uninstall' : 'install')}
	tabs={[
		{ id: 'install', label: t(m.pluginRackInstall), testid: 'rack-tab-install' },
		{ id: 'uninstall', label: t(m.pluginRackUninstall), testid: 'rack-tab-uninstall' }
	]}
/>
