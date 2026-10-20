/**
 * Prompt Sync — the broadcast channel between the sidebar footer's shared
 * composer box (SidebarPromptSync) and the checked panel composers
 * (ADR "The Prompt Sync", 2026-09-04).
 *
 * The shape, in one line: the box is the ONE writer of a shared draft; every
 * checked panel mirrors it into its own draft; Submit walks the checked set
 * and asks each panel's own submit ladder to send what it shows; Cancel
 * restores the drafts each panel had when it was checked.
 *
 * Decisions this module embodies (ADR D-numbers):
 *  - D1 — membership is keyed by SESSION id (panel ids die at /new swaps;
 *    the recipient of a prompt is the conversation).
 *  - D2 — module-scope runes state read directly by both ends (the
 *    stick-to-bottom / workspace-context precedent); no prop threading.
 *  - D3 — the mirror is one-way, sidebar → panels; panels never write.
 *  - D4 — a check never wipes: `setSyncChecked(id, true)` snapshots the
 *    panel's draft into `pristine` and claims the panel only when the box
 *    holds text; claimed sessions mirror verbatim — '' included, so
 *    clearing the box clears their panels (amended 2026-09-04); Cancel
 *    writes the snapshots back.
 *  - D5 — `submitAll` awaits each member's `submit()` sequentially in
 *    check order; a refusal (streaming / locked / a `!` macro line /
 *    empty) keeps the panel's mirrored draft and lands it in `kept` (the
 *    pass ends the claims, so the post-pass empty never mirrors over a
 *    kept draft).
 *  - D6 — checks are session-scoped: `pruneSync` drops sessions that left
 *    the floor; `resetSync` runs in the route's destroy lifecycle.
 *
 * Plain TS + module runes — reactive for every consumer, no component
 * imports. The callers (Composer, SidebarPromptSync) hold the UI locks;
 * the store holds no timers and no fetches.
 */

import { SvelteSet } from 'svelte/reactivity';
import type { DsiCommandRow, DsiGestureRow, DsiSkillRow } from '$lib/types';
import type { SuggestedPrompt, TriggerMode } from './prompt-trigger.js';

/** One member's live strip view — the rows its own fetch produced, the
 *  borrowed highlight index, and the query/mode that shaped them. The
 *  broadcast box renders this view verbatim (amended 2026-09-04). */
export interface SyncStripView {
	rows: SuggestedPrompt[];
	index: number;
	query: string;
	mode: TriggerMode;
}

/** One member's live slash-menu view (amended 2026-09-04 — the third
 *  surface joins the box): the raw catalogs ITS session's directory
 *  serves, the menu lifecycle, the whole `/`-draft query, and the
 *  highlighted index over the member's own matched composite. The box
 *  renders SlashMenu from this view verbatim — it never fetches, ranks,
 *  or owns a catalog (§7.1's no-second-composer rule, unchanged). */
export interface SyncSlashView {
	gestures: readonly DsiGestureRow[];
	commands: readonly DsiCommandRow[];
	skills: readonly DsiSkillRow[];
	state: 'idle' | 'loading' | 'ready' | 'failed';
	query: string;
	index: number;
}

/** One panel composer's hand the store may take (D2's member contract). */
export interface SyncMember {
	/** The composer's current draft — the snapshot's source of truth. */
	getText(): string;
	/** Replace the composer's draft (mirror pushes, cancel restores). */
	setText(text: string): void;
	/** The panel's own submit ladder; true when a prompt was dispatched. */
	submit(): Promise<boolean>;
}

/**
 * One panel composer's optional strip hand (amended 2026-09-04 — the
 * broadcast strip): members that own a SuggestStrip implement it, and the
 * box's keyboard grammar fans out through these very methods. The grammar
 * stays the member's own — the store only replays intents.
 */
export interface SyncStripMember extends SyncMember {
	/** The member's live strip view — null while no rows show. */
	syncStripState(): SyncStripView | null;
	/** Move the strip highlight (the member's wrap/row-count guards apply). */
	syncCycleStrip(delta: number): void;
	/** Accept the highlighted row — the member's own accept semantics
	 *  (find inserts, run runs), without stealing the operator's focus. */
	syncAcceptStrip(): void;
	/** Dismiss the strip — the member's own Esc semantics (query memoized). */
	syncDismissStrip(): void;
}

/** Narrow a registered member to the optional strip hand. */
function asStripMember(member: SyncMember | undefined): SyncStripMember | null {
	return member !== undefined && typeof (member as SyncStripMember).syncStripState === 'function'
		? (member as SyncStripMember)
		: null;
}

/**
 * One panel composer's optional slash-menu hand (amended 2026-09-04 —
 * the third surface joins the box): the same replay shape as the strip
 * hand — the member reports its live menu view and performs its own
 * cycle/dismiss/accept semantics; the store only replays intents.
 */
export interface SyncSlashMember extends SyncMember {
	/** The member's live slash-menu view — null while the menu is closed. */
	syncSlashState(): SyncSlashView | null;
	/** Move the menu highlight (the member's own matched set + guards). */
	syncCycleSlash(delta: number): void;
	/** Dismiss the menu — the member's own Esc semantics (memoized). */
	syncDismissSlash(): void;
	/** Land an INSERT pick's seed as the member's draft — the member's
	 *  own pickInsert semantics (menu memo-closed, press 2 is the
	 *  operator's), without stealing the operator's focus. */
	syncAcceptSlashInsert(text: string): void;
	/** Execute an EXECUTE pick (hint-less command) — the member's own
	 *  draft is the line (its args ride verbatim); the member's own
	 *  ladder runs it host-side, its own banner is the receipt. */
	syncAcceptSlashExecute(name: string): void | Promise<void>;
}

/** Narrow a registered member to the optional slash hand. */
function asSlashMember(member: SyncMember | undefined): SyncSlashMember | null {
	return member !== undefined && typeof (member as SyncSlashMember).syncSlashState === 'function'
		? (member as SyncSlashMember)
		: null;
}

/** What one broadcast pass did — the box's honest receipt (D5). */
export interface SyncSubmitResult {
	/** Members whose ladder admitted the send. */
	dispatched: number;
	/** Sessions whose ladder refused (or whose member was gone) — each
	 *  keeps its mirrored draft, visible for a manual send. */
	kept: string[];
}

// ── Module-scope state ─────────────────────────────────────────────────
/** Registered composers by session id — imperative plumbing, not UI state. */
const members = new Map<string, SyncMember>();
/** Checked sessions — SvelteSet because $state does NOT proxy built-in
 *  collections: a plain `new Set()` inside $state keeps `has`/`add`/`size`
 *  inert (probe-pinned 2026-09-04 — the checkmark flipped the store but no
 *  template ever re-ran). Every reader below is reactive through it. */
let checked = new SvelteSet<string>();
/** The broadcast draft — the box's textarea writes through to this (D3). */
let sharedText = $state('');
/** Bumped on every push / check / uncheck-all so mirror effects re-run
 *  even when the text itself did not change. */
let rev = $state(0);
/** Sessions the broadcast has CLAIMED: the box held text at check time,
 *  or a non-empty push landed while checked (D4 as amended 2026-09-04).
 *  Claimed sessions mirror `sharedText` verbatim — '' included, so
 *  clearing the box clears their panels; an unclaimed check keeps its
 *  draft. SvelteSet so the mirror effects track the claims. */
const mirroring = new SvelteSet<string>();
/** Pre-broadcast drafts captured at check time (D4) — Cancel's promise.
 *  Keyed by session id; dropped on uncheck, submit, prune, reset. */
const pristine = new Map<string, string>();

// ── Membership ──────────────────────────────────────────────────────────
/**
 * Register a panel composer for its session. Returns the disposer — the
 * registration effect's cleanup unregisters on unmount (panel close,
 * /new remount).
 */
export function registerSyncMember(
	sessionId: string,
	member: SyncMember | SyncStripMember | SyncSlashMember
): () => void {
	members.set(sessionId, member);
	return () => {
		if (members.get(sessionId) === member) members.delete(sessionId);
	};
}

// ── Reads (reactive) ────────────────────────────────────────────────────
/** Is this session in the checked set? (the checkmark's state) */
export function isSyncChecked(sessionId: string): boolean {
	return checked.has(sessionId);
}

/** How many panels the box drives — the box's visibility (D7). */
export function syncCheckedCount(): number {
	return checked.size;
}

/** The broadcast draft (the box's textarea binds through to the store). */
export function readSharedText(): string {
	return sharedText;
}

/**
 * The panel mirror's verdict for this session: `undefined` writes nothing
 * (unchecked, or checked but not yet claimed — D4's "a check never
 * wipes"); any string — '' included — is what the panel's draft becomes
 * (claimed sessions mirror verbatim, D4 as amended 2026-09-04). Reads
 * `rev` so a mirror effect keyed on this re-runs on every store
 * transition.
 */
export function mirrorTextFor(sessionId: string): string | undefined {
	void rev; // mirror effects must re-run per store transition
	if (!checked.has(sessionId) || !mirroring.has(sessionId)) return undefined;
	return sharedText;
}

// ── Writes ──────────────────────────────────────────────────────────────
/**
 * Check (join the broadcast) or uncheck (leave it). Checking snapshots the
 * member's current draft into `pristine` BEFORE anything mirrors (D4) and
 * claims the panel only when the box holds text — checking mid-broadcast
 * picks the shared text up, checking an empty box claims nothing (a check
 * is an intent to receive, not permission to erase). The claim bump rides
 * `rev`, so a member checked mid-sync mirrors the current shared text.
 * Unchecking keeps the panel's text as-is and drops its snapshot and
 * claim; the set emptying clears the shared text — the box hides and
 * forgets.
 */
export function setSyncChecked(sessionId: string, on: boolean): void {
	if (checked.has(sessionId) === on) return;
	if (on) {
		pristine.set(sessionId, members.get(sessionId)?.getText() ?? '');
		if (sharedText !== '') mirroring.add(sessionId);
		checked.add(sessionId);
		rev++;
		return;
	}
	checked.delete(sessionId);
	pristine.delete(sessionId);
	mirroring.delete(sessionId);
	if (checked.size === 0) {
		sharedText = '';
		rev++;
	}
}

/**
 * The box typed: one writer, many readers (D3). A non-empty push claims
 * every checked session — from that keystroke they mirror verbatim, ''
 * included, so emptying the box empties them (D4 as amended 2026-09-04).
 */
export function pushSharedText(text: string): void {
	sharedText = text;
	if (text !== '') for (const sessionId of checked) mirroring.add(sessionId);
	rev++;
}

/**
 * The first checked strip member's live strip view — the box's row-gated
 * keyboard guard reads this, and the box renders it as its own strip
 * (null: no live strip anywhere, the box's keys keep their plain
 * grammar). All checked members show the same query's rows; a member
 * whose strip died (dismissed, locked, failed fetch) sits out the fanout
 * and keeps its draft.
 */
export function syncStripState(): SyncStripView | null {
	for (const sessionId of checked) {
		const strip = asStripMember(members.get(sessionId))?.syncStripState() ?? null;
		if (strip !== null) return strip;
	}
	return null;
}

/** Fan the box's cycle out to every checked strip member — indices move
 *  in lockstep; each member's own guards absorb the no-ops. */
export function cycleSyncStrip(delta: number): void {
	for (const sessionId of checked) asStripMember(members.get(sessionId))?.syncCycleStrip(delta);
}

/** Fan the accept out — the box's Tab, and (run mode only, amended
 *  2026-09-04) its Enter. A find accept leaves the broadcast alone: the
 *  pick wrote through the mirror and the send is still press 2 away. A
 *  run accept ENDS the broadcast — the macro fired in each live member's
 *  own executor (D5), the shared draft is consumed: claims and snapshots
 *  drop, the box clears (submitAll's tail, minus the pass — no member
 *  was asked to admit anything). */
export function acceptSyncStrip(mode: SyncStripView['mode']): void {
	for (const sessionId of checked) asStripMember(members.get(sessionId))?.syncAcceptStrip();
	if (mode === 'run') {
		mirroring.clear();
		sharedText = '';
		pristine.clear();
		rev++;
	}
}

/** Fan the dismiss out — the box's Esc. */
export function dismissSyncStrip(): void {
	for (const sessionId of checked) asStripMember(members.get(sessionId))?.syncDismissStrip();
}

/** The first checked slash member's live menu view — the box's row-gated
 *  keyboard guard reads this, and the box renders SlashMenu from it
 *  verbatim (null: no live menu anywhere, the box's keys keep their
 *  plain grammar). All checked members hold the same mirrored draft, so
 *  the surface kind is uniform; a member whose menu is dismissed sits
 *  out the fanout and keeps its draft. */
export function syncSlashState(): SyncSlashView | null {
	for (const sessionId of checked) {
		const slash = asSlashMember(members.get(sessionId))?.syncSlashState() ?? null;
		if (slash !== null) return slash;
	}
	return null;
}

/** Fan the box's menu-cycle out to every checked slash member — each
 *  moves its OWN highlight over its OWN matched set (per-session
 *  catalogs may rank differently; the box shows the first live view). */
export function cycleSyncSlash(delta: number): void {
	for (const sessionId of checked) asSlashMember(members.get(sessionId))?.syncCycleSlash(delta);
}

/** Fan the box's menu-dismiss out — the box's Esc. */
export function dismissSyncSlash(): void {
	for (const sessionId of checked) asSlashMember(members.get(sessionId))?.syncDismissSlash();
}

/** Fan an INSERT pick (gesture / hinted command / skill): the seed lands
 *  as every member's draft, each menu memo-closed (press 2 is the
 *  operator's own Enter). The broadcast STAYS ALIVE — the box's shared
 *  text is the caller's write (pushSharedText), the pick only seeds it. */
export function acceptSyncSlashInsert(text: string): void {
	for (const sessionId of checked) asSlashMember(members.get(sessionId))?.syncAcceptSlashInsert(text);
}

/** Fan an EXECUTE pick (hint-less command): each member runs its OWN
 *  draft line through its own host-command rung — its args ride
 *  verbatim, its banner is the receipt. The run consumed the intent, so
 *  the broadcast ends with it (the run-accept's rule): claims and
 *  snapshots drop, the box clears. */
export function acceptSyncSlashExecute(name: string): void {
	for (const sessionId of checked) void asSlashMember(members.get(sessionId))?.syncAcceptSlashExecute(name);
	mirroring.clear();
	sharedText = '';
	pristine.clear();
	rev++;
}

/**
 * Submit to every checked panel, sequentially in check order (D5). Each
 * member's OWN ladder decides — a streaming, locked, `!`-macro-shaped, or
 * empty composer refuses (returns false) and keeps its mirrored draft.
 * After the pass: the claims end first (a kept panel's draft must survive the
 * post-pass empty), shared text clears, snapshots drop (there is nothing
 * left to undo — the sends happened or were honestly refused), and the
 * checked group survives for the next broadcast. Callers hold the
 * re-entrancy lock (the box disables its submit while a pass runs).
 */
export async function submitAll(): Promise<SyncSubmitResult> {
	const kept: string[] = [];
	let dispatched = 0;
	for (const sessionId of [...checked]) {
		const member = members.get(sessionId);
		const ok = member === undefined ? false : await member.submit();
		if (ok) dispatched++;
		else kept.push(sessionId);
	}
	mirroring.clear();
	sharedText = '';
	pristine.clear();
	rev++;
	return { dispatched, kept };
}

/**
 * Cancel the broadcast: every checked panel's draft goes back to exactly
 * what it was when the panel was checked (D4), the shared text clears.
 * The claims end with the broadcast — the restores are not echoes. Panels
 * never pushed to are untouched (their snapshot is their text).
 */
export function cancelSync(): void {
	for (const [sessionId, text] of pristine) {
		members.get(sessionId)?.setText(text);
	}
	mirroring.clear();
	pristine.clear();
	sharedText = '';
	rev++;
}

/**
 * Floor-membership hygiene (D1/D6): a session that left the floor — closed,
 * /new-swapped, family-removed — holds no check and no snapshot. Call the
 * floor owner's effect with the open sessions; the count hitting 0 also
 * clears the shared text (the box hides with nothing up its sleeve).
 */
export function pruneSync(activeSessionIds: ReadonlySet<string>): void {
	let removed = false;
	for (const sessionId of [...checked]) {
		if (!activeSessionIds.has(sessionId)) {
			checked.delete(sessionId);
			pristine.delete(sessionId);
			mirroring.delete(sessionId);
			removed = true;
		}
	}
	if (removed && checked.size === 0 && sharedText !== '') {
		sharedText = '';
		rev++;
	}
}

/** Full teardown — the route's destroy lifecycle (D6). */
export function resetSync(): void {
	members.clear();
	checked.clear();
	mirroring.clear();
	pristine.clear();
	sharedText = '';
	rev++;
}

/** Test-only: identical to resetSync (isolation between unit-test files). */
export function resetPromptSyncForTests(): void {
	resetSync();
}
