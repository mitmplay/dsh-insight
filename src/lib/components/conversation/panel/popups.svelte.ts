/**
 * Popups — the panel's chip/peek popup state + think/plan auto-open
 * slots (moved WHOLE from ConversationPanel.svelte, ADR-0022 R2 W2;
 * ADR-0019 move-whole: every line keeps its semantics, comments ride).
 *
 * ONE open chip at a time; peek and chip expansion are mutually
 * exclusive; the two auto-open slots run independently of the manual
 * pick. The sticky plan adoption is a component-lifecycle effect, so it
 * lives in $effect.root + destroy() (proven-gates §1) — the shell calls
 * destroy() from onDestroy.
 */
import { createConversationStore } from '$lib/services/conversation/store.svelte';
import { isTodoTool } from '$lib/utils/todo-lists';
import { newestReasoningId, newestTodoToolId, suppressed } from '$lib/utils/auto-open-slots';

type Store = ReturnType<typeof createConversationStore>;

export class Popups {
	/** Chip popup state (2026-08-22, OCI pattern): ONE open chip at a time —
	 * the id of the expanded entry; detail renders AFTER the chip row.
	 * Per-panel by construction (moved here with the block). */
	openChipId = $state<string | null>(null);

	/** Peek popup state (ToolPeekButton port, 2026-08-22): the run key whose
	 * chip row has its list popup open — ONE at a time, and never while a
	 * chip detail popup is open (OCI mutual-exclusion contract). */
	peekOpenRunKey = $state<string | null>(null);

	private thinkSuppressedId = $state<string | null>(null);
	private planSuppressedId = $state<string | null>(null);

	/** The newest todo_write entry's id, STICKY: adopted only while
	 *  streaming AND stuck (the detection window), then kept across newer
	 *  thinks, turn end, and scroll-away — the plan stays on screen until
	 *  a newer todo_write supersedes it or the user collapses it. */
	private autoPlanIdRaw = $state<string | null>(null);

	private readonly deps: { store: Store; get stick(): boolean };
	private readonly stopPlanEffect: () => void;

	constructor(deps: { store: Store; get stick(): boolean }) {
		this.deps = deps;
		// The sticky plan adoption runs on the panel's lifecycle: a root so
		// the effect can live outside component init, a stop so unmount-time
		// reads never warn derived_inert (proven-gates §1).
		this.stopPlanEffect = $effect.root(() => {
			$effect(() => {
				if (!this.deps.store.isStreaming || !this.deps.stick) return;
				const found = newestTodoToolId(this.deps.store.renderEntries, isTodoTool);
				if (found !== null) this.autoPlanIdRaw = found;
			});
		});
	}

	/** Stop the plan-adoption effect — the shell calls this from onDestroy. */
	destroy(): void {
		this.stopPlanEffect();
	}

	/** The newest reasoning entry's id (wire order) while streaming AND
	 *  stuck to the live end, else null — the transient think target. */
	get autoThinkTargetId(): string | null {
		if (!this.deps.store.isStreaming || !this.deps.stick) return null;
		return newestReasoningId(this.deps.store.renderEntries);
	}

	/** Suppression-aware think target: null while the user kept THIS think
	 *  collapsed (a newer think id simply stops matching). */
	get autoThinkId(): string | null {
		return suppressed(this.autoThinkTargetId, this.thinkSuppressedId);
	}

	/** Suppression-aware plan target (same id-tied rule as the think). */
	get autoPlanId(): string | null {
		return suppressed(this.autoPlanIdRaw, this.planSuppressedId);
	}

	toggleChip(id: string, autoOpen = false): void {
		// Collapsing an AUTO-OPENED chip suppresses that slot until a newer
		// target appears (the suppression is id-tied — stale ids never match).
		if (autoOpen) {
			if (id === this.autoPlanId) this.planSuppressedId = id;
			else if (this.autoThinkId !== null && id === `r:${this.autoThinkId}`) this.thinkSuppressedId = this.autoThinkId;
			return;
		}
		this.openChipId = this.openChipId === id ? null : id;
		this.peekOpenRunKey = null; // peek and chip expansion are mutually exclusive
	}

	togglePeek(runKey: string): void {
		this.peekOpenRunKey = this.peekOpenRunKey === runKey ? null : runKey;
		if (this.peekOpenRunKey !== null) this.openChipId = null;
	}
}
