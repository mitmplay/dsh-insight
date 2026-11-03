<script lang="ts">
	import { t } from '$lib/services/locale/locale-state.svelte';
	import * as m from '$lib/paraglide/messages';
	import SegmentedTabs from '$lib/components/common/tabs/SegmentedTabs.svelte';

	/**
	 * WorkspaceFileTabGroup — the File Eye toggle (ADR D6; Plugin Rack
	 * amendment IV 2026-10-31): the joined-pill grammar now lives ONCE
	 * in the shared SegmentedTabs (Tailwind) — a thin adapter speaking
	 * the File Eye's edit/diff vocabulary and keeping the dirty-buffer
	 * lock on the Diff segment (ADR D3). Presentational: the parent
	 * owns the view state and the change intent.
	 */
	let {
		/** The File Eye view — the panel's derived authority (ADR D6). */
		view = 'edit',
		/** View intent — the parent bridges it to the owner. */
		onviewchange
	}: {
		view?: 'edit' | 'diff';
		onviewchange?: (view: 'edit' | 'diff') => void;
	} = $props();
</script>

<!-- The File Eye toggle (SegmentedTabs, amendment IV): Preview | Diff.
     The Single Edit ADR D1 (2026-10-31): the first segment reads
     "Preview", not "Edit" — that word belongs to the mode verb — and
     both segments stay clickable in every state (D4). -->
<SegmentedTabs
	active={view}
	groupTestid="file-view-toggle"
	ariaLabel={t(m.fileEyeToggleLabel)}
	onchange={(id) => onviewchange?.(id === 'diff' ? 'diff' : 'edit')}
	tabs={[
		{ id: 'edit', label: t(m.fileEyePreview), testid: 'file-view-edit' },
		{ id: 'diff', label: t(m.fileEyeDiff), testid: 'file-view-diff' }
	]}
/>
