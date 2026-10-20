<script lang="ts">
	/**
	 * ConversationHeader — the conversation page's top bar (extracted
	 * from the page, 2026-08-24): the identity cluster (SessionIdAndName:
	 * copy-id prefix, workspace chip, title display, inline rename) on
	 * the left; the agent chip, the running/idle status, the session
	 * fork (2026-09-01), and the conversation capture on the right
	 * (ToolsAndStatusHeader, extracted 2026-08-24). Purely presentational
	 * — title state and the streaming flag arrive as props; writes report
	 * upward.
	 */
	import SessionIdAndName from './SessionIdAndName.svelte';
	import ToolsAndStatusHeader from './ToolsAndStatusHeader.svelte';
	import OpenBrowserButton from './OpenBrowserButton.svelte';
	import * as m from '$lib/paraglide/messages';

	let {
		sessionId,
		title,
		initialTitle,
		ontitlechange,
		workspace = null,
		workspaces = [],
		access = null,
		agent,
		agentId = null,
		isStreaming,
		transcript = null,
		subagent = false,
		plan = null,
		parentSessionId = null,
		focused = false,
		onOpenExplorer = undefined,
		onOpenBrowser = undefined
	}: {
		sessionId: string;
		/** Live title — page-owned state; rename writes report upward. */
		title: string | null;
		/** Cold-load title (tail-page projections) — seeds the rename form. */
		initialTitle: string | null;
		ontitlechange: (t: string) => void;
		/** The session's workspace (cwd) — the identity cluster's chip. */
		workspace?: string | null;
		/** Host workspace registry — the chip's title-first label + ghost
		 *  authority (ADR D5 parity with the sidebar, 2026-09-07). */
		workspaces?: import('$lib/types').DsiWorkspaceSummary[];
		/** Access mode (permission preset current) — the cluster's [R/W/F] badge. */
		access?: string | null;
		/** Agent chip label — display name when the host catalog carries one,
		 *  else the preset id (floor owner resolves; null = chip hidden). */
		agent: string | null;
		/** Raw preset id — the chip's copy-id prefix value; null = none. */
		agentId?: string | null;
		/** True while a turn is streaming — the status pill's running state. */
		isStreaming: boolean;
		/** The transcript viewport — the capture button's target (OCI parity). */
		transcript?: HTMLElement | null;
		/** True for sub-agent sessions — the title renders read-only
		 *  (the host fences session.rename with agent-busy). */
		subagent?: boolean;
		/** The host's plan-mode projection — the header's plan pill
		 *  (null = not delivered → hidden). */
		plan?: import('$lib/services/conversation/plan-projection').DsiPlanProjection | null;
		/** The fork source's session id — the parent button's jump target;
		 *  null renders no button (roots have no parent to open). */
		parentSessionId?: string | null;
		/** This panel is the floor's focused panel — the header tints
		 *  oldlace (the footer's focus tint, 2026-08-28): with N
		 *  conversations side by side, the column you would type into
		 *  reads as one tinted frame, top and bottom. */
		focused?: boolean;
		/** Workspace-chip click intent (Workspace Explorer ADR D4) —
		 *  pass-through to SessionIdAndName's cluster. */
		onOpenExplorer?: (sessionId: string, workspace: string) => void;
		/** Browser-chip click intent (The Glass Browser spec W2) — the
		 *  singleton browser panel's opener; absent renders no chip. */
		onOpenBrowser?: () => void;
	} = $props();
</script>

<header
	class="flex items-center gap-3 border-b border-surface-border px-2 py-1 {focused ? 'bg-header-wash' : 'bg-surface-elevated'}"
	data-testid="conversation-header"
	data-focused={focused ? 'true' : 'false'}
>
	<!-- Identity cluster (2026-08-23): workspace chip + access badge +
	     title display + the inline rename form — SessionIdAndName. -->
	<SessionIdAndName
		{sessionId}
		{title}
		{initialTitle}
		{ontitlechange}
		{workspace}
		{workspaces}
		{access}
		{subagent}
		{onOpenExplorer}
	/>
		{#if onOpenBrowser}
			<OpenBrowserButton {onOpenBrowser} />
		{/if}
	<!-- Right cluster (2026-08-24): agent chip + running/idle pill +
	     session fork (2026-09-01) + conversation capture (2026-08-25). -->
	<ToolsAndStatusHeader {agent} {agentId} {isStreaming} {transcript} {plan} {sessionId} {title} {parentSessionId} {subagent} />
</header>