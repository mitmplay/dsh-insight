<script lang="ts">
	/**
	 * ConversationFloatingAnchor — the conversation page's floating action
	 * stack (OCI Floating Host port, 2026-08-23; extracted from the page
	 * 2026-08-24): jump and scroll actions beside the transcript they act
	 * on — the User Messages button (self-contained with its popup jumper
	 * since 2026-08-26; renders only when prompt groups exist) and the
	 * far-edge jump. Purely presentational — the viewport and turn groups
	 * arrive as props.
	 */
	import FloatingAnchor from '$lib/components/common/containers/FloatingAnchor.svelte';
	import UserMessagesButton from '$lib/components/common/buttons/UserMessagesButton.svelte';
	import BackToTheEdgeButton from '$lib/components/common/buttons/BackToTheEdgeButton.svelte';
	import PlanButton from '$lib/components/anchor/plan/PlanButton.svelte';
	import JobsButton from '$lib/components/anchor/job/JobsButton.svelte';
	import InjectedShelfButton from '$lib/components/anchor/inject/InjectedShelfButton.svelte';
	import { groupTurns } from '$lib/utils/turn-grouping';
	import type { TodoItem } from '$lib/utils/todo-lists';
	import type { DsiEntry } from '$lib/types';

	let {
		groups,
		container,
		onloadall,
		onleavebottom,
		todos = null,
		jobsessionid = '',
		shelfentries = undefined,
		shelfsessionid = '',
		shelfworkspace = null,
		shelfpanelid = null,
		onshelfnote
	}: {
		/** Derived turn groups — the jumper lists their prompt rows. */
		groups: ReturnType<typeof groupTurns>;
		/** The transcript scroll element (bindable through from the page). */
		container: HTMLElement | undefined;
		/** Drain every remaining older page (Shift+click far-edge jump,
		 *  2026-08-26) — the panel's loadAllOlder; awaited before the jump. */
		onloadall?: () => Promise<void>;
		/** The far-edge up jump's release report — the panel flips the
		 *  stick toggle OFF before the viewport moves (2026-09-08). */
		onleavebottom?: () => void;
		/** The host's live todos projection — the Current Plan button's
		 *  readout; null/undefined renders nothing (no current plan). */
		todos?: TodoItem[] | null;
		/** The conversation's sessionId — the JobsButton's roster key;
		 *  '' renders no jobs button (hosts outside a conversation). */
		jobsessionid?: string;
		/** The conversation's dispatched entries — the Injected shelf
		 *  derives from them (Loadinjected ADR D6); undefined renders no
		 *  shelf button (hosts outside a conversation panel). */
		shelfentries?: readonly DsiEntry[];
		/** The shelf's conversation (the dedupe pair's source half). */
		shelfsessionid?: string;
		/** The session workspace cwd — joins the copy affordance's full
		 *  path (Loadinjected ADR D6/D7). */
		shelfworkspace?: string | null;
		/** The owning floor panel — the executor's floor gate reads it. */
		shelfpanelid?: string | null;
		/** The executor's honest notes (usage / no-match) for shelf picks. */
		onshelfnote?: (ok: boolean, note: string) => void;
	} = $props();
</script>

{#if container !== undefined}
	<FloatingAnchor>
		<PlanButton todos={todos ?? []} />
		<JobsButton sessionId={jobsessionid} />
		{#if shelfentries !== undefined}
			<InjectedShelfButton
				entries={shelfentries}
				sessionId={shelfsessionid}
				workspace={shelfworkspace}
				panelId={shelfpanelid}
				onnote={onshelfnote}
			/>
		{/if}
		<UserMessagesButton {groups} {container} />
		<BackToTheEdgeButton {container} {onloadall} {onleavebottom} />
	</FloatingAnchor>
{/if}
