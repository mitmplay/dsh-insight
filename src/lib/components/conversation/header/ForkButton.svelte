<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import { t } from '$lib/services/locale/locale-state.svelte';
	/**
	 * ForkButton — one-click session fork in the conversation header
	 * (The Fork Button ADR, 2026-09-01). A thin shell over the shared
	 * fork spine (`$lib/services/conversation/fork-session`): it omits
	 * `atSeq`, so the host cuts at the source's LAST COMPLETED TURN (open
	 * turns are never inherited — the host refuses, never clips). The
	 * spine places the child directly BELOW the source panel through the
	 * panel registry (after-source placement: the source keeps its slot,
	 * the child takes index+1); off-floor, the seed navigation fallback
	 * applies.
	 *
	 * The shell owns only its surface: the `forking` lock (the
	 * NewChatButton `creating` pattern) and the transient refusal chip —
	 * the host's refusal message surfaces verbatim, the lock releases,
	 * and nothing opens. The turn-level variant with an `atSeq` anchor is
	 * ForkHereButton (The Fork-Here Button ADR, 2026-09-02).
	 *
	 * Sub-agent panels hide the button: their transcripts render
	 * read-only (the title's treatment).
	 *
	 * Lens disable (The Panel Loupe ADR D8, 2026-09-04): inside the
	 * loupe the button renders visible-disabled beside the forking
	 * lock — fork's outcome is a floor edit (the spine places the child
	 * through the registry), so it never fires from the reading lens.
	 */
	import { GitBranch } from '@lucide/svelte';
	import { forkFromSession } from '$lib/services/conversation/fork-session';
	import { getLensMode } from '$lib/services/conversation/lens-context.svelte';

	let {
		sessionId,
		title = null,
		agentPreset = null,
		subagent = false
	}: {
		/** The source session — the fork's cut source. */
		sessionId: string;
		/** Live source title — seeds the child's best-effort " (fork)"
		 *  rename; null/blank skips the rename (nothing to disambiguate). */
		title?: string | null;
		/** Raw preset id carried onto the opened child panel's chip
		 *  (the host composes the child's real preset from the source). */
		agentPreset?: string | null;
		/** Sub-agent sessions hide the button (read-only transcript view). */
		subagent?: boolean;
	} = $props();

	/** One fork at a time (the NewChatButton `creating` lock pattern). */
	let forking = $state(false);
	/** Lens flag (ADR D8), read once at init — a fork never fires from
	 *  inside the loupe. */
	const lens = getLensMode();
	/** Transient refusal/failure text — verbatim host message when the
	 *  host refused; auto-clears so the header self-heals. */
	let errorMessage = $state<string | null>(null);
	let errorTimer: ReturnType<typeof setTimeout> | undefined;

	function showError(message: string): void {
		errorMessage = message;
		clearTimeout(errorTimer);
		errorTimer = setTimeout(() => (errorMessage = null), 4000);
	}

	async function fork(): Promise<void> {
		if (forking) return;
		forking = true;
		errorMessage = null;
		const outcome = await forkFromSession({ sessionId, title, agentPreset });
		if (!outcome.ok) showError(outcome.message);
		forking = false;
	}
</script>

{#if !subagent}
	<button
		type="button"
		class="flex shrink-0 items-center gap-1 rounded-md p-1 text-text-muted hover:bg-surface-alt hover:text-text-secondary disabled:cursor-not-allowed disabled:opacity-50"
		disabled={lens || forking}
		data-testid="fork-button"
		aria-label={t(m.forkSession)}
		title={t(m.forkSessionLong)}
		onclick={() => void fork()}
	>
		<GitBranch size={12} aria-hidden="true" />
		{#if forking}
			<span class="text-[10px] leading-none">forking…</span>
		{/if}
	</button>
	{#if errorMessage}
		<span
			class="max-w-56 truncate rounded bg-danger-wash px-1.5 py-0.5 text-[10px] text-status-fail"
			data-testid="fork-error"
			role="alert"
			title={errorMessage}
		>
			{errorMessage}
		</span>
	{/if}
{/if}
