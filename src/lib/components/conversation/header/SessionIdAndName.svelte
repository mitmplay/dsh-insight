<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import { t } from '$lib/services/locale/locale-state.svelte';

	import { copyWithFeedback } from '$lib/utils/clipboard.js';

	import DisplayWorkspace from '$lib/components/conversation/header/DisplayWorkspace.svelte';
	import EditingTitle from '$lib/components/conversation/header/EditingTitle.svelte';
	import SessionAccess from '$lib/components/conversation/header/SessionAccess.svelte';

	/**
	 * SessionIdAndName — the header's identity cluster (extracted from the
	 * conversation page, 2026-08-23): BOTH title states inside one
	 * container —
	 *
	 *   display  — the rename trigger button (title="Rename this session")
	 *   editing  — the inline form (input + Save + Cancel + error line)
	 *
	 * Workspace chip (2026-08-24, extracted 2026-08-26): DisplayWorkspace
	 * renders the Folder + basename chip BEFORE the badge and title — the
	 * full path rides the tooltip. The copy-session-id button moved to the
	 * floor's PanelHeader (2026-08-25) — the raw id there labels the
	 * column; here the id remains the container's data-session-id
	 * attribute (test/automation identity) and the no-title fallback text.
	 *
	 * Access badge (2026-08-25, extracted 2026-08-26): renders
	 * SessionAccess right after the workspace chip — one bracketed char
	 * (R/W/F, C for Custom) for the session's permission mode in its most
	 * compact form; the presentation lives in the child component.
	 *
	 * Rename is owned by EditingTitle (extracted 2026-08-26): draft,
	 * in-flight lock, the POST (session.rename via the page's /api/dsh
	 * route), the error surface, and the accept rule (adopt the host's
	 * NORMALIZED title; a reject keeps the old one). The page learns about
	 * a successful rename through ontitlechange — it owns the
	 * <svelte:head> document title.
	 */
	let {
		sessionId,
		title,
		initialTitle,
		ontitlechange,
		workspace = null,
		workspaces = [],
		access = null,
		subagent = false,
		onOpenExplorer = undefined
	}: {
		/** Session id — container identity attribute + fallback title text. */
		sessionId: string;
		/** Current title truth (page-owned: seeds cold load, updates here). */
		title: string | null;
		/** Cold-load projection seed — the page's `data.title`. */
		initialTitle: string | null;
		/** Fired when a rename is ACCEPTED (host-normalized title). */
		ontitlechange?: (title: string) => void;
		/** The session's workspace (cwd from session.list); null = none. */
		workspace?: string | null;
		/** Host workspace registry — DisplayWorkspace's title-first label +
		 *  ghost authority (ADR D5 parity with the sidebar, 2026-09-07). */
		workspaces?: import('$lib/types').DsiWorkspaceSummary[];
		/** Access mode — the permission preset's current value
		 *  (read-only | workspace-write | danger-full-access | custom);
		 *  null/unknown renders no badge. */
		access?: string | null;
		/** True for sub-agent sessions — the title renders read-only
		 *  (the host fences session.rename with agent-busy). */
		subagent?: boolean;
		/** Workspace-chip click intent (Workspace Explorer ADR D4): the
		 *  page's open/focus-explorer action, pre-bound to this session. */
		onOpenExplorer?: (sessionId: string, workspace: string) => void;
	} = $props();

	/**
	 * The session's on-disk directory (The Session Full Path, ADR D4):
	 * fetched from /api/dsh/session/{id}/path on mount and whenever the
	 * id changes (fork). Null until a 200 answers — the button stays
	 * HIDDEN (no visible-disabled guess state); a 404 (directory absent,
	 * remote-host DSI) keeps it hidden too. HTTP is the only UI↔server
	 * seam; no fs here (client-side).
	 */
	let sessionPath = $state<string | null>(null);
	let copied = $state(false);

	$effect(() => {
		const id = sessionId;
		let stale = false;
		fetch(`/api/dsh/session/${id}/path`)
			.then(async (res) => {
				if (stale) return;
				sessionPath = res.ok ? ((await res.json()) as { path: string }).path : null;
			})
			.catch(() => {
				if (!stale) sessionPath = null;
			});
		return () => {
			stale = true;
		};
	});
</script>

<!-- flex-1: the cluster occupies the header's remaining width (back link ←
     cluster → right status), so the editing input's flex-1 has real room to
     grow into — long titles edit without horizontal scrolling inside the
     field. min-w-0 keeps it shrinkable past content width. -->
<div
	class="flex min-w-0 flex-1 items-center gap-1"
	data-testid="session-id-and-name"
	data-session-id={sessionId}
>
	<!-- Copy-path button (The Session Full Path, ADR D4): the identity
	     cluster's FIRST child. Renders only when the route answered 200 —
	     the clipboard always receives the session DIRECTORY path, never a
	     guessed one. Distinct testid from the floor's panel-header-copy-id
	     (which keeps copying the raw id, untouched). -->
	{#if sessionPath !== null}
		<button
			type="button"
			class="shrink-0 rounded p-0.5 text-text-muted transition-colors hover:text-slate-200"
			data-testid="conversation-header-copy-path"
			aria-label={t(m.copySessionPath)}
			title={t(m.copySessionPath)}
			onclick={() => {
				if (sessionPath === null) return;
				void copyWithFeedback(sessionPath, (ok) => (copied = ok));
			}}
		>
			<svg
				class="h-3.5 w-3.5"
				viewBox="0 0 16 16"
				fill="none"
				stroke="currentColor"
				stroke-width="1.5"
				aria-hidden="true"
			>
				{#if copied}
					<path d="M3 8.5 6.5 12 13 4.5" stroke-linecap="round" stroke-linejoin="round" />
				{:else}
					<rect x="5.5" y="5.5" width="7" height="8" rx="1.2" />
					<path d="M10.5 5.5v-1a1.2 1.2 0 0 0-1.2-1.2H4.7A1.2 1.2 0 0 0 3.5 4.5v6a1.2 1.2 0 0 0 1.2 1.2h.8" stroke-linecap="round" />
				{/if}
			</svg>
		</button>
	{/if}

	<!-- Workspace chip (extracted 2026-08-26): DisplayWorkspace renders
	     the Folder + basename chip; hidden when the session has no
	     workspace (the child decides). -->
	<DisplayWorkspace
		{workspace}
		{workspaces}
		onOpenExplorer={
			workspace && onOpenExplorer ? () => onOpenExplorer(sessionId, workspace) : undefined
		}
	/>

	<!-- Access badge (extracted 2026-08-26): SessionAccess renders the
	     bracketed mode letter AFTER the workspace chip; hidden for unknown
	     modes (the child decides, never guesses). -->
	<SessionAccess {access} />

	<!-- Title cluster (extracted 2026-08-26): EditingTitle owns BOTH
	     states — the display button and the inline rename form — plus
	     the rename POST, the error surface, and the accept rule. -->
	<EditingTitle {sessionId} {title} {ontitlechange} {subagent} />
</div>
