<script lang="ts">
	/**
	 * DisplayWorkspace (2026-08-26) — the header’s workspace chip,
	 * extracted from SessionIdAndName: when the session runs in a
	 * workspace, a Folder + basename chip labels where the chat lives —
	 * the full path rides the tooltip. Since 2026-09-06 the chip is
	 * WorkspaceChip — the ONE workspace identity shared with the sidebar
	 * rows and the filter header; this host owns only the header-scaled
	 * geometry (roomier padding, wider gap, no width cap). The parent
	 * places it PREFIXED to the access badge and title. Renders nothing
	 * when the session has no workspace.
	 */

	import { workspaceDisplayLabel, isRegisteredWorkspace } from '$lib/utils/session-filters';
	import type { DsiWorkspaceSummary } from '$lib/types';
	import WorkspaceChip from '../../common/WorkspaceChip.svelte';

	let {
		workspace = null,
		workspaces = [],
		onOpenExplorer = undefined
	}: {
		/** The session’s workspace (cwd from session.list); null = none. */
		workspace?: string | null;
		/** Host workspace registry — the title-first label + ghost styling
		 *  authority (ADR D5: a rename shows on EVERY surface that names the
		 *  workspace; 2026-09-07 header-chip parity). Empty = basename chip,
		 *  the pre-parity fallback. */
		workspaces?: DsiWorkspaceSummary[];
		/** Plain-click intent (Workspace Explorer ADR D4): open/focus the
		 *  session's explorer. Absent = the chip stays INERT — sidebar
		 *  surfaces pass nothing, so their click behavior is untouched
		 *  (the header chip has no menu to conflict with). */
		onOpenExplorer?: () => void;
	} = $props();
</script>

{#if workspace}
	<WorkspaceChip
		label={workspaceDisplayLabel(workspace, workspaces)}
		ghost={!isRegisteredWorkspace(workspace, workspaces)}
		iconSize={10}
		testid="session-workspace"
		title={workspace}
		style="--wsc-padding: 0.125rem 0.5rem; --wsc-gap: 0.25rem; --wsc-max-width: none{onOpenExplorer
			? '; cursor: pointer'
			: ''}"
		onclick={onOpenExplorer}
	/>
{/if}
