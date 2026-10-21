import { parseCommand } from '$lib/services/chat/command-parser';
import { MENU_GESTURES } from '$lib/services/chat/command-help';
import type { SlashDirectory } from '$lib/services/chat/slash-directory.svelte';
import { slashMenuMatches } from '../menu/SlashMenu.svelte';

/** One matched row over the composite index — gestures first, then
 *  commands, then skills (ADR "The Slash Menu" §1.1 layers A→B→C). */
export type SlashRow =
	| { kind: 'gesture'; name: string; seed: string }
	| { kind: 'command'; name: string; hint: boolean }
	| { kind: 'skill'; name: string };

/** Cross-surface gates the shell injects (ADR-0020 D2): precedence is the
 *  SHELL's contract — the controller may not import its siblings. */
export interface SlashGates {
	/** The strip's trigger is active (the strip outranks the menu). */
	stripTriggerActive(): boolean;
	/** The help card is visible / a ?-shape is on the line. */
	helpVisible(): boolean;
	helpShape(): boolean;
}

/** Pick callbacks the shell forwards (props in, frozen contract D5).
 *  focusInsert replicates the pre-move pickInsert re-focus (queued
 *  microtask: caret to the draft's end + focus); focusExecute is the
 *  pre-move pickExecute re-focus (direct element focus). */
export interface SlashCallbacks {
	onpickcommand?: (line: string) => boolean | Promise<boolean>;
	onpickcommandwithhint?: (name: string) => void;
	onpickskill?: (name: string) => void;
	focusInsert(): void;
	focusExecute(): void;
}

/**
 * SlashController — the slash menu's surface machine (ADR-0020 D1, moved
 * verbatim from Composer.svelte's 2026-08-30 block).
 *
 * Carries, unchanged: the parser stand-down trigger (menu opens only on a
 * / draft parseCommand DECLINES), the dismissed-draft memo (Esc or a pick
 * memo-closes the exact draft; a LONGER draft is fresh intent; trigger
 * gone clears the memo), the composite matched rows over all three
 * sections via the SAME exported matcher the menu renders with, the
 * per-keystroke highlight reset, and the kind-aware picks (insert vs
 * execute, the two-press rule, BC-A3 admission on execute).
 *
 * Per-mount by construction (ADR-0020 D1). The shell keeps the LADDER
 * (D2): this controller answers handles()/onKey() — the IME/modifier
 * gates and rung ORDER stay in Composer.svelte.
 */
export class SlashController {
	#draft: { getValue(): string; setValue(v: string): void };
	#getCatalog: () => SlashDirectory | null;
	#gates: SlashGates;
	#cb: SlashCallbacks;

	/** Dismiss memo: the exact draft Esc/pick closed. */
	#dismissedQuery = $state<string | null>(null);
	/** Highlighted row — arrows wrap, query change resets to the top. */
	index = $state(0);

	constructor(
		draft: { getValue(): string; setValue(v: string): void },
		getCatalog: () => SlashDirectory | null,
		gates: SlashGates,
		callbacks: SlashCallbacks
	) {
		this.#draft = draft;
		this.#getCatalog = getCatalog;
		this.#gates = gates;
		this.#cb = callbacks;
		// The two pre-move inline effects, verbatim, in one root (W1's
		// $effect.root lesson): trigger gone clears the memo; every query
		// move resets the highlight to the top.
		$effect.root(() => {
			$effect(() => {
				if (!this.trigger) this.#dismissedQuery = null;
			});
			$effect(() => {
				void this.draft;
				this.index = 0;
			});
		});
	}

	/** The trimmed draft — query and trigger share parseCommand's
	 *  normalization, so the stand-down is decided on the same bytes the
	 *  submit ladder will judge. */
	get draft() {
		return this.#draft.getValue().trim();
	}

	/** Parser stand-down (Resolved decision 6): a / draft parseCommand
	 *  DECLINES — parser-owned gestures keep their menu-free journeys. */
	get trigger() {
		const d = this.draft;
		return d.startsWith('/') && parseCommand(d) === null;
	}

	/** The THIRD floating surface — the strip's ?/! and the help card
	 *  keep their triggers via the shell-injected gates. */
	get open() {
		return (
			this.trigger &&
			!this.#gates.stripTriggerActive() &&
			!this.#gates.helpVisible() &&
			!this.#gates.helpShape() &&
			this.draft !== this.#dismissedQuery
		);
	}

	/** Matched rows over ALL THREE sections — loading/failed/absent
	 *  catalog ⇒ no rows ⇒ Enter falls through (loading rows never
	 *  intercept). */
	get rows(): SlashRow[] {
		if (!this.open) return [];
		const catalog = this.#getCatalog();
		if (catalog === null || catalog.state !== 'ready') return [];
		const d = this.draft;
		return [
			...MENU_GESTURES.filter((r) => slashMenuMatches(r, d)).map((r) => ({
				kind: 'gesture' as const,
				name: r.name,
				seed: r.seed
			})),
			...catalog.commands
				.filter((r) => slashMenuMatches(r, d))
				.map((r) => ({ kind: 'command' as const, name: r.name, hint: r.input?.hint !== undefined })),
			...catalog.skills
				.filter((r) => slashMenuMatches(r, d))
				.map((r) => ({ kind: 'skill' as const, name: r.name }))
		];
	}

	/** The keydown rung's gate — IME/modifier gates stay the shell's. */
	handles(): boolean {
		return this.open;
	}

	/** Cycle the highlighted row over the MATCHED set (wraps). */
	cycle(delta: number): void {
		const n = this.rows.length;
		if (n === 0) return;
		this.index = (((this.index + delta) % n) + n) % n;
	}

	/** The menu's own Esc: memoize the exact draft (keydown rung + the
	 *  broadcast's syncDismissSlash both land here). */
	memoize(): void {
		this.#dismissedQuery = this.draft;
	}

	/** A LONGER draft is fresh intent — the memo unlocks (handleInput's
	 *  rule, verbatim; the shell forwards every input event). */
	noteInput(): void {
		const d = this.draft;
		if (this.#dismissedQuery !== null && d.length > this.#dismissedQuery.length) {
			this.#dismissedQuery = null;
		}
	}

	/** The line a command pick executes: the draft VERBATIM when its first
	 *  token already names the row (case-insensitive), else the row's
	 *  canonical name + the draft's raw remainder. Arguments are never
	 *  re-parsed — the host owns every grammar decision (ADR §4.4). */
	slashLineFor(name: string): string {
		const d = this.draft;
		const at = d.search(/\s/);
		const token = at === -1 ? d : d.slice(0, at);
		if (token.slice(1).toLowerCase() === name.toLowerCase()) return d;
		return `/${name}${at === -1 ? '' : d.slice(at)}`;
	}

	/** Insert pick (gesture seed / hint command / skill): the seed lands
	 *  as THE draft with the caret after it; the menu memo-closes on the
	 *  new draft so the operator's own Enter is press 2. */
	pickInsert(seed: string, fire?: (picked: string) => void, refocus = true): void {
		this.#draft.setValue(seed);
		this.#dismissedQuery = this.draft;
		this.index = 0;
		if (refocus) this.#cb.focusInsert();
		fire?.(seed);
	}

	/** Execute pick (hint-less command): the draft clears only on an
	 *  ADMITTED execution (BC-A3); a miss keeps the draft and memo-closes
	 *  the menu — the honest banner note is the receipt. */
	async pickExecute(name: string, refocus = true): Promise<void> {
		if (this.#cb.onpickcommand === undefined) return;
		const line = this.slashLineFor(name);
		this.index = 0;
		const cleared = await this.#cb.onpickcommand(line);
		if (cleared !== false) {
			this.#draft.setValue('');
			this.#dismissedQuery = null;
		} else {
			this.#dismissedQuery = this.draft;
		}
		if (refocus) this.#cb.focusExecute();
	}

	/** Pick the highlighted row (Enter/Tab press 1) — the same kind-aware
	 *  branch both keys run (Tab-accept parity; Shift+Tab cycles instead). */
	pickHighlighted(): void {
		const row = this.rows[this.index];
		if (row === undefined) return;
		if (row.kind === 'gesture') {
			this.pickInsert(row.seed);
		} else if (row.kind === 'skill') {
			this.pickInsert(`/${row.name} `, () => this.#cb.onpickskill?.(row.name));
		} else if (row.hint) {
			this.pickInsert(`/${row.name} `, () => this.#cb.onpickcommandwithhint?.(row.name));
		} else {
			void this.pickExecute(row.name);
		}
	}
}
