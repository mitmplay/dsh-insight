<script lang="ts">
	import { t } from '$lib/services/locale/locale-state.svelte';
	import * as m from '$lib/paraglide/messages';
	import SegmentedTabs from '$lib/components/common/tabs/SegmentedTabs.svelte';

	/**
	 * SettingsSkillsHeaderTabs — the shelf's tab pill (The Shelf
	 * Chrome, D3; Plugin Rack amendment IV 2026-10-31): the joined-pill
	 * grammar now lives ONCE in the shared SegmentedTabs (Tailwind) —
	 * this is a thin adapter speaking the shelf's native tab names.
	 * Presentational: the panel owns the tab state.
	 */
	let {
		/** The active tab — the panel's state. */
		tab = 'install',
		/** Tab intent — the panel bridges it to its state. */
		ontabchange
	}: {
		tab?: 'install' | 'uninstall';
		ontabchange?: (tab: 'install' | 'uninstall') => void;
	} = $props();
</script>

<!-- The joined-pill grammar (SegmentedTabs, amendment IV): Install | Uninstall. -->
<SegmentedTabs
	active={tab}
	groupTestid="shelf-tab-group"
	ariaLabel={t(m.skillsShelfTitle)}
	onchange={(id) => ontabchange?.(id === 'uninstall' ? 'uninstall' : 'install')}
	tabs={[
		{ id: 'install', label: t(m.skillsShelfTabInstall), testid: 'shelf-tab-install' },
		{ id: 'uninstall', label: t(m.skillsShelfTabUninstall), testid: 'shelf-tab-uninstall' }
	]}
/>
