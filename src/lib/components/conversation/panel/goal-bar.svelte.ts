/**
 * GoalBarMachine — the goal-bar CAS wire machine + panel-owned editor
 * state (moved WHOLE from ConversationPanel.svelte, ADR-0022 R2 W4;
 * ADR-0019 move-whole: every line keeps its semantics, comments ride).
 *
 * Goal bar wiring (ADR "The Goal Bar", 2026-09-08, D3 as amended
 * 2026-09-08: actions ride the host's goals/* Remotes — commands/execute
 * does not admit /goal on the web plane). Banner notes arrive via the
 * injected noteCommand (W1's SubmitLadder — injected, never imported).
 */
import { createConversationStore } from '$lib/services/conversation/store.svelte';
import { parseGoalView } from '$lib/utils/goals';

type Store = ReturnType<typeof createConversationStore>;

export class GoalBarMachine {
	/** True while a goals/* verb is in flight — the chip drops re-clicks
	 *  (the CAS ref comes from the CURRENT rendered goal; a stale one loses
	 *  host-side and the next projection delta corrects the bar). */
	goalBusy = $state(false);

	// ── Goal editor state (Goal Editor ADR D2/D4) — panel-owned; GoalBar
	// renders the fields and emits callbacks. ─────────────────────────────
	goalEditor = $state<{ objective: string; maxGoalRounds: number } | null>(null);

	private readonly deps: { store: Store; get sessionId(): string; noteCommand: (kind: 'ok' | 'error', text: string) => void };

	constructor(deps: { store: Store; get sessionId(): string; noteCommand: (kind: 'ok' | 'error', text: string) => void }) {
		this.deps = deps;
	}

	/** Send one goals/<verb> mutation with the goal's CAS ref. The edit
	 *  verb carries the changed-fields payload (Goal Editor ADR D3). */
	async runGoalVerb(
		verb: 'pause' | 'resume' | 'clear' | 'edit',
		payload?: { objective?: string; maxGoalRounds?: number }
	): Promise<void> {
		const goal = this.deps.store.goal;
		if (this.goalBusy || goal === null || goal === undefined) return;
		this.goalBusy = true;
		try {
			const res = await fetch(`/api/dsh/session/${encodeURIComponent(this.deps.sessionId)}/goal`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					verb,
					ref: { id: goal.id, revision: goal.revision },
					...(payload === undefined ? {} : { edit: payload })
				})
			});
			const body = (await res.json().catch(() => null)) as
				| { ok?: boolean; error?: { message?: string } }
				| null;
			if (body?.ok === true) {
				// The RemoteResult's GoalView is HOST truth — apply it now so the
				// chip's phase and CAS ref are fresh before the next poll (a
				// quick second action then carries the new revision, not the
				// stale one the host would honestly refuse).
				const view = parseGoalView((body as { value?: unknown }).value);
				if (view !== undefined) this.deps.store.applyGoal(view);
				if (verb === 'edit') this.goalEditor = null;
				this.deps.noteCommand('ok', `goal ${verb}`);
			} else {
				this.deps.noteCommand('error', body?.error?.message ?? `goal ${verb} failed`);
			}
		} catch (err) {
			this.deps.noteCommand('error', `goal ${verb} failed (${err instanceof Error ? err.message : String(err)})`);
		} finally {
			this.goalBusy = false;
		}
	}

	/** Open the editor, pre-filled from the CURRENT projection. */
	openGoalEditor(): void {
		const goal = this.deps.store.goal;
		if (goal === null || goal === undefined) return;
		this.goalEditor = { objective: goal.objective, maxGoalRounds: goal.maxGoalRounds };
	}

	/** One form field changed — update the panel-owned editor state. */
	editGoalField(field: 'objective' | 'maxGoalRounds', value: string): void {
		if (this.goalEditor === null) return;
		if (field === 'objective') this.goalEditor.objective = value;
		else {
			const parsed = Number(value);
			this.goalEditor.maxGoalRounds = Number.isFinite(parsed) ? parsed : this.goalEditor.maxGoalRounds;
		}
	}

	/** Diff the editor against the CURRENT store goal at submit time (ADR
	 *  D3 — a model-side edit between form-open and submit must not be
	 *  clobbered by an untouched prefill) and submit the changed fields. */
	submitGoalEditor(): void {
		const goal = this.deps.store.goal;
		const editor = this.goalEditor;
		if (editor === null || goal === null || goal === undefined) return;
		const objective = editor.objective.trim();
		const changed: { objective?: string; maxGoalRounds?: number } = {};
		if (objective.length > 0 && objective !== goal.objective) changed.objective = objective;
		const rounds = Number(editor.maxGoalRounds);
		if (Number.isSafeInteger(rounds) && rounds >= 1 && rounds !== goal.maxGoalRounds) {
			changed.maxGoalRounds = rounds;
		}
		if (changed.objective === undefined && changed.maxGoalRounds === undefined) {
			this.deps.noteCommand('error', 'nothing changed — edit the objective or the round cap');
			return;
		}
		void this.runGoalVerb('edit', changed);
	}
}
