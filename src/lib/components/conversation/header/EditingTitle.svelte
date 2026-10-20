<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import { t } from '$lib/services/locale/locale-state.svelte';
	/**
	 * EditingTitle (2026-08-26) — the header’s title cluster, extracted
	 * from SessionIdAndName: BOTH title states inside one component —
	 *
	 *   display  — the rename trigger button (title="Rename this session")
	 *   editing  — the inline form (input + Save + Cancel + error line)
	 *
	 * Rename is fully owned here: draft, in-flight lock, the POST
	 * (session.rename via the page’s /api/dsh route), the error surface,
	 * and the accept rule (adopt the host’s NORMALIZED title; a reject
	 * keeps the old one). The page learns about a successful rename
	 * through ontitlechange — it owns the <svelte:head> document title.
	 */

	let {
		sessionId,
		title,
		ontitlechange,
		subagent = false
	}: {
		/** Session id — the no-title fallback text’s prefix. */
		sessionId: string;
		/** Current title truth (page-owned: seeds cold load, updates here). */
		title: string | null;
		/** Fired when a rename is ACCEPTED (host-normalized title). */
		ontitlechange?: (title: string) => void;
		/** True for sub-agent sessions: the host's subagent routing owns
		 *  the child's lifecycle, so session.rename rejects `agent-busy`
		 *  ("owned by subagent routing") — the title renders as plain
		 *  text: no rename trigger, no inline form. */
		subagent?: boolean;
	} = $props();

	/** Inline rename state (POC-3 W3 3.1 — moved from the page, extracted
	 *  2026-08-26 with the form). */
	let editingTitle = $state(false);
	let titleDraft = $state('');
	let renaming = $state(false);
	/** Rename failure message — shown until the next edit attempt. */
	let renameError = $state<string | null>(null);
	/** The editor input — refocused after the clear button empties the draft. */
	let renameInput = $state<HTMLInputElement | null>(null);

	/** Select the whole seed the moment the form opens (click → focus →
	 *  select all): overwriting the seed is the default gesture, not
	 *  caret-editing inside it. */
	function focusSelectAll(node: HTMLInputElement): void {
		node.focus();
		node.select();
	}

	/** Save the edit: POST rename → adopt the host’s NORMALIZED title.
	 * Reject (HTTP or RPC error) keeps the old title and shows the message. */
	async function submitRename(): Promise<void> {
		const next = titleDraft.trim();
		if (renaming || next.length === 0) return;
		if (next === renameBaseline) {
			// No-op edit — close quietly (no wire round-trip for nothing).
			// Baseline is the SEED (title, else the full id): blur auto-submits,
			// so an untouched form must never write its seed back.
			editingTitle = false;
			return;
		}
		renaming = true;
		renameError = null;
		try {
			const url = `/api/dsh/session/` + encodeURIComponent(sessionId) + `/rename`;
			const res = await fetch(url, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ title: next })
			});
			const body = (await res.json().catch(() => null)) as {
				ok?: boolean;
				title?: string;
				error?: { code?: string; message?: string };
			} | null;
			if (!res.ok || !body?.ok) {
				// Reject keeps the old title: the projection never moved —
				// only the error shows.
				renameError = body?.error?.message ?? `rename failed (${res.status})`;
				return;
			}
			const accepted = body.title ?? next; // host's NORMALIZED title
			editingTitle = false;
			ontitlechange?.(accepted);
		} catch (err) {
			renameError = err instanceof Error ? err.message : String(err);
		} finally {
			renaming = false;
		}
	}

	/** Cancel the edit: draft discarded, old title stays (never a wire call). */
	function cancelRename(): void {
		if (renaming) return;
		editingTitle = false;
		renameError = null;
	}

	/** Display text: the title, or the id prefix when none exists yet.
	 *  The DISPLAY may truncate the fallback for layout — the EDITOR may
	 *  not: the seed and the no-op baseline read the FULL id (2026-09-04
	 *  fix — the truncated display prefix once seeded the form, and the
	 *  blur auto-submit permanently saved it over a null title). */
	/** Optional-chained (2026-09-18): probe-mounted floors render the
	 *  title with NO session yet — a bare sessionId.slice crashed the
	 *  whole panel tree as an unhandled exception. Empty-string fallback
	 *  renders a blank title chip instead of crashing. */
	const displayTitle = $derived(title ?? (sessionId ? sessionId.slice(0, 12) + '…' : ''));
	/** What an untouched draft equals: the current title, else the FULL id. */
	const renameBaseline = $derived(title ?? sessionId ?? '');
</script>

{#if editingTitle}
	<!-- Inline title edit (POC-3 W3 3.1): Esc/Cancel discard the draft;
	     a rejected rename keeps the old title. The wrapper owns the flex
	     sizing so the clear icon can anchor inside the input's right edge;
	     pr-7 stays regardless of the icon, so the field never shifts when
	     the icon appears. -->
	<div class="relative min-w-0 flex-1">
		<input
			bind:value={titleDraft}
			bind:this={renameInput}
			use:focusSelectAll
			data-testid="rename-input"
			aria-label={t(m.sessionTitle)}
			class="w-full rounded-md border border-surface-border pr-7 text-sm focus:border-text-muted focus:outline-none"
			maxlength="200"
			onkeydown={(e) => {
				if (e.key === 'Enter') void submitRename();
				if (e.key === 'Escape') cancelRename();
			}}
			onblur={() => void submitRename()}
		/>
		{#if titleDraft.length > 0 && !renaming}
			<!-- Clear (2026-09-05): empties the draft, form stays open. The
			     mousedown preventDefault keeps focus in the input — the blur
			     auto-submit must never fire with the pre-clear draft. -->
			<button
				type="button"
				data-testid="rename-clear"
				aria-label={t(m.clearTitle)}
				tabindex={-1}
				class="absolute right-1.5 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-full text-text-muted hover:bg-surface-hover hover:text-text-secondary"
				onmousedown={(e) => e.preventDefault()}
				onclick={() => {
					titleDraft = '';
					renameInput?.focus();
				}}
			>
				<svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
					<path d="M1 1l8 8M9 1l-8 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
				</svg>
			</button>
		{/if}
	</div>
	{#if renameError}
		<span class="text-xs text-status-fail" data-testid="rename-error" role="alert">{renameError}</span>
	{/if}
	<button
		type="button"
		class="rounded-md bg-slate-800 text-xs font-medium text-white hover:bg-slate-700 disabled:opacity-50"
		disabled={renaming || titleDraft.trim().length === 0 || titleDraft.trim() === renameBaseline}
		data-testid="rename-save"
		onclick={() => void submitRename()}
	>
		{renaming ? t(m.saving) : t(m.save)}
	</button>
	<button
		type="button"
		class="rounded-md border border-surface-border text-xs font-medium text-text-secondary hover:bg-surface-alt disabled:opacity-50"
		disabled={renaming}
		data-testid="rename-cancel"
		onclick={() => cancelRename()}
	>
		{t(m.cancel)}
	</button>
{:else if subagent}
	<!-- Sub-agent session (2026-08-27): the host fences session.rename
	     (agent-busy, "owned by subagent routing") — the title is plain
	     text with the rename trigger's exact layout classes, so the
	     header's geometry never shifts between session kinds. -->
	<span
		class="min-w-0 flex-1 truncate text-left text-sm font-medium text-text-primary"
		data-testid="session-title"
		title={t(m.subagentTitleOwns)}
	>
		{displayTitle}
	</span>
{:else}
	<!-- No max-width (2026-08-23): the cluster owns the header’s remaining
	     width (flex-1) — the title fills it; ellipsized text before empty
	     space made no sense. min-w-0 + truncate only engage when the right
	     cluster genuinely squeezes the row. -->
	<button
		type="button"
		class="min-w-0 flex-1 truncate rounded-md text-left text-sm font-medium text-text-primary hover:bg-surface-alt"
		data-testid="session-title"
		title={t(m.renameThisSession)}
		onclick={() => {
			// Seed the FULL identity — never the display's truncated prefix.
			titleDraft = renameBaseline;
			renameError = null;
			editingTitle = true;
		}}
	>
		{displayTitle}
	</button>
{/if}
