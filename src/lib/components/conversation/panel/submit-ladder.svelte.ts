/**
 * SubmitLadder — the panel's submit/cancel ladder + command banner
 * (moved WHOLE from ConversationPanel.svelte, ADR-0022 R2 W1;
 * ADR-0019 move-whole: every line keeps its semantics, comments ride).
 *
 * Wave 2: images arrive serialized from the composer (Composer owns
 * the only base64 moment — serialize-at-submit, BC-A2) and ride the
 * widened submit; the boolean admits/denies draft clearing (BC-A3).
 * Commands delegate to the shared executor (Prompt Macro W1 1.2 — one
 * command/send surface for the typed path AND the macro runner); ordinary
 * sends flow through sendPrompt so the /use record guard lives in ONE
 * place (Suggest Strip ADR D5 contract, byte-identical).
 *
 * BC-2: components + services only. The shell injects LIVE accessors
 * (proven-gates §4): ctx (session facts read at call time — the /new
 * successor swap may change them between rungs), the orchestrator, the
 * slash catalog getter, and the macro start callback.
 */
import { createPollingOrchestrator } from '$lib/services/conversation/polling-orchestrator.svelte';
import { parseCommand } from '$lib/services/chat/command-parser';
import {
	executeCommand,
	executeHostCommand,
	resolveHostCommand,
	sendPrompt
} from '$lib/services/chat/command-executor';
import { TYPED_DRAFT_ID } from '$lib/services/chat/macro-runner.svelte';
import { isTypedRun } from '$lib/services/chat/macro-sections';
import type { SlashDirectory } from '$lib/services/chat/slash-directory.svelte';
import type { DsiEntry } from '$lib/types';

/** The executor context this panel's commands run under — live prop
 *  values read at call time (the /new successor swap may change them
 *  between one run's lines and the next). */
export type PanelExecutorCtx = {
	sessionId: string;
	workspace: string | null;
	agent: string | null;
	panelId: string | null;
	entries: DsiEntry[];
};

type Orchestrator = ReturnType<typeof createPollingOrchestrator>;

export class SubmitLadder {
	/** True while the plain-send rung is in flight — the footer's sending flag. */
	submitted = $state(false);

	// ── Slash commands (2026-08-25) — OCI ChatInput banner pattern ──────
	/** Inline command feedback (role=status, auto-dismiss 5s) — the ONLY
	 * command UI surface; the input has already cleared by intercept time.
	 * The wire work lives in command-executor (Prompt Macro W1 1.2): the
	 * /new create+swap, /permission route, and mention delivery are the
	 * SAME bytes the typed path always sent — the panel now renders
	 * outcomes only (banner kind from result.ok). */
	commandNote = $state<{ kind: 'ok' | 'error'; text: string } | null>(null);
	private commandNoteTimer: ReturnType<typeof setTimeout> | undefined;

	constructor(
		private readonly deps: {
			ctx: () => PanelExecutorCtx;
			orchestrator: Orchestrator;
			get slashCatalog(): SlashDirectory | null;
			startMacro: (row: { text: string; id: number }, held: boolean) => void;
		}
	) {}

	/** Inline command feedback — every rung banners through here. */
	noteCommand(kind: 'ok' | 'error', text: string): void {
		this.commandNote = { kind, text };
		if (this.commandNoteTimer !== undefined) clearTimeout(this.commandNoteTimer);
		this.commandNoteTimer = setTimeout(() => (this.commandNote = null), 5_000);
	}

	async onsubmit(text: string, images: readonly { mediaType: string; data: string; name?: string }[]): Promise<boolean> {
		// The Typed Run (2026-09-16, D3): a uniformly directive multi-line
		// draft (every non-blank line starts /, @, or ? and there are at
		// least two) enters the EXISTING runner as a synthetic row — the
		// predicate routes BEFORE parseCommand, whose single whole-draft
		// parse would otherwise bury line 2 in line 1's args. The runner
		// applies slashBoundaries on the synthetic row's behalf (the single
		// call-site divergence, macro-runner start); a refusal (live run,
		// D4) banners through startMacro's existing note path. Single-line
		// and mixed drafts fail the predicate and fall through byte-identical.
		if (isTypedRun(text)) {
			this.deps.startMacro({ text, id: TYPED_DRAFT_ID }, false);
			return true; // dispatch completed — drafts clear (BC-A7)
		}
		// Slash-command intercept (2026-08-25, OCI parser port): known
		// commands run panel-side and never reach the model; unknown lines
		// fall through as ordinary chat (the parser returns null).
		const command = parseCommand(text);
		if (command !== null) {
			// onNote fires at the typed path's ORIGINAL banner points (the
			// mention path notes at the prompt receipt, before the register);
			// the final result covers everything else.
			let bannered = false;
			const result = await executeCommand(command, this.deps.ctx(), (ok, note) => {
				bannered = true;
				this.noteCommand(ok ? 'ok' : 'error', note);
			});
			// The final note re-fires ONLY when no in-flight note landed
			// (mention/permission bannered at their original points — a
			// duplicate final fire would re-set the banner kind).
			if (!bannered && result.note !== undefined) {
				this.noteCommand(result.ok ? 'ok' : 'error', result.note);
			}
			return true; // completed dispatch clears drafts (BC-A7)
		}
		if (text.trim().length === 0 && images.length === 0) return false; // nothing to send
		// Slash Menu ladder rung (Slash Menu ADR §3.2, task 2.3): the parser
		// DECLINED — a first token naming a row of the CACHED command
		// catalog executes through the native command route with the FULL
		// line (arguments never re-parsed). Precedence is structural: the
		// typed-gesture block above ran first; a name shared by a command
		// and a skill resolves to the COMMAND because the ladder consults
		// only the command rows (the native adjudication). result.ok
		// admits/clears: a miss or error keeps the draft (BC-A3) — the
		// honest banner note is the receipt, never a fallback model send.
		const slashCatalog = this.deps.slashCatalog;
		if (slashCatalog?.state === 'ready') {
			const hostCommand = resolveHostCommand(text, slashCatalog.commands);
			if (hostCommand !== null) {
				const result = await executeHostCommand(text, this.deps.ctx(), (ok, note) =>
					this.noteCommand(ok ? 'ok' : 'error', note)
				);
				return result.ok;
			}
		}
		this.submitted = true;
		try {
			const result = await sendPrompt(text, this.deps.ctx(), (t) =>
				// Text-only on the macro path; manual sends with images keep the
				// panel's own orchestration (optimistic bubble + poll cadence).
				this.deps.orchestrator.submit(t, images)
			);
			return result.ok;
		} finally {
			this.submitted = false;
		}
	}

	async oncancel(): Promise<void> {
		await this.deps.orchestrator.cancel();
	}

	/** Menu command pick: the SAME rung the ladder uses (one execution
	 * surface, D2), banner notes through the shared note path; the
	 * boolean admits the composer's draft clearing (BC-A3). */
	async onpickcommand(line: string): Promise<boolean> {
		const result = await executeHostCommand(line, this.deps.ctx(), (ok, note) =>
			this.noteCommand(ok ? 'ok' : 'error', note)
		);
		return result.ok;
	}
}
