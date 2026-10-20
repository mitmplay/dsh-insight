<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import { t } from '$lib/services/locale/locale-state.svelte';
	/**
	 * OpenParentButton — the conversation header's jump back to the fork
	 * source (2026-09-01). A forked session's ledger is the inherited
	 * transcript of its parent, and the host records that link durably
	 * (`parentSession`); this button turns the recorded edge into one
	 * click: the parent session joins the floor through the panel
	 * registry (the family clamp lands it at the family head, LEFT of
	 * the child). Self-contained like ForkButton — it speaks to the
	 * registry (BC-2) and reports nothing upward; with no floor mounted
	 * the seed navigation fallback applies (SidebarSessions parity).
	 *
	 * The button reads the floor's live set from the workspace context:
	 * when the parent already holds a panel the button is DISABLED and
	 * grayed (the sidebar's panel list is the selector — a second jump
	 * would only duplicate what the reader can already reach).
	 *
	 * Hidden entirely when the session has no parent (a root) — there is
	 * nowhere to jump.
	 */
	import { ArrowLeft } from '@lucide/svelte';
	import { addPanelFromSidebar } from '$lib/services/panels/panel-registry';
	import { conversationSeedUrl } from '$lib/utils/seed-url';
	import { getWorkspaceState } from '$lib/services/conversation/workspace-context.svelte';

	let {
		parentSessionId
	}: {
		/** The fork source's session id (the spine row's parentSessionId);
		 *  null hides the button (roots have no parent to open). */
		parentSessionId: string | null;
	} = $props();

	const ws = $derived(getWorkspaceState());
	/** Parent already on the floor — the button parks (gray + disabled). */
	const parentOpen = $derived(
		parentSessionId !== null &&
			(ws?.rows ?? []).some(
				(r) => r.panel.kind === 'conversation' && r.panel.sessionId === parentSessionId
			)
	);

	function openParent(): void {
		if (parentSessionId === null || parentOpen) return;
		const added = addPanelFromSidebar({
			sessionId: parentSessionId,
			agentPreset: null, // the spine heals the chip (agentFor's merge)
			focus: true
		});
		if (!added) {
			// Off-floor fallback — the pre-floor behavior (ForkButton parity).
			window.location.assign(
				conversationSeedUrl(parentSessionId, getWorkspaceState()?.profile ?? null)
			);
		}
	}
</script>

{#if parentSessionId !== null}
	<button
		type="button"
		class="flex shrink-0 items-center rounded-md p-1 disabled:cursor-not-allowed {parentOpen ? 'text-text-muted' : 'text-text-secondary hover:bg-surface-alt'}"
		disabled={parentOpen}
		data-testid="parent-button"
		aria-label={t(m.openParentSession)}
		aria-disabled={parentOpen}
		title={parentOpen ? 'Parent session is already open' : 'Open the parent session (fork source)'}
		onclick={openParent}
	>
		<ArrowLeft size={12} aria-hidden="true" />
	</button>
{/if}
