/**
 * chord-machine — the armed two-stroke keyboard chord reducer (ADR-0006a
 * port; container-base W5, ADR-0062 D5: the MACHINE moves, the PREFIX
 * TABLES stay consumer config).
 *
 * A PURE reducer: every transition is (state, event, facts) -> { state,
 * action }. No DOM, no stores, no timers — the caller owns the clock
 * (now) and the wiring (which element heard the key).
 *
 * Grammar: press-and-release the arming key within CHORD_WINDOW_MS; a
 * digit fires { apply, n }; a verb letter fires { verb } through the
 * consumer's table; any other key or the expiring window disarms.
 *
 * D5 (the consumer-table rule): the machine never learns WHICH letters
 * are verbs or what a terminal prefix maps to — the consumer passes
 * ChordTables. The arming prefixes (Alt+first / Alt+second) and the
 * digit lanes are machine semantics; "the arming key names the prefix;
 * the prefix owns the follow-up table" is the ADR-0052 D1 rule the
 * tables express.
 */
export declare const CHORD_WINDOW_MS = 2000;
export type ChordPrefix = 's' | 't';
export interface ChordState {
    /** True between the arming release and the digit / disarm. */
    armed: boolean;
    /** Date.now() of the arming keyup — the window clock. */
    since: number;
    /** Which prefix owns this chord — the prefix names the follow-up table. */
    prefix: ChordPrefix;
}
export declare const IDLE_CHORD: ChordState;
export interface ChordOptionRow {
    key: string;
    label: string;
}
export type ChordAction = {
    type: 'none';
} | {
    type: 'disarm';
} | {
    type: 'apply';
    n: number;
} | {
    type: 'verb';
    verb: string;
    prefix: ChordPrefix;
};
/** Minimal key shape the wiring feeds in (a real KeyboardEvent fits). */
export interface ChordKey {
    key: string;
    /** PHYSICAL key identity — the layout-independent match site. Holding
     *  Alt remaps letters on macOS (Option+S types key='ß'), so e.key
     *  matching never arms on a real keyboard. Match e.code; key stays as
     *  the no-code fallback. */
    code?: string;
    altKey: boolean;
    ctrlKey: boolean;
    metaKey: boolean;
    /** string, not the union — a real KeyboardEvent.type IS a string and
     *  the wiring passes the event whole (no lossy adapter). */
    type: string;
}
/** The consumer's chord tables (D5): WHICH letters are verbs under the
 *  plain prefix, and what the terminal prefix's letters map to. Absence
 *  of a letter in the terminal map disarms; a letter outside `verbs`
 *  disarms. An empty default table keeps the machine neutral — the
 *  consumer's config module owns the real table. */
export interface ChordTables {
    /** Letters that fire `{ type: 'verb', verb: letter }` under the
     *  plain (first) prefix. */
    verbs: string;
    /** The terminal prefix's letter → verb-name map (a verb name the
     *  host dispatches; the machine never interprets it). */
    terminal?: Record<string, string>;
    /** Which prefix is the terminal one (default 't'). */
    terminalPrefix?: ChordPrefix;
}
/** True when the chord can arm at all — any preset slot on any lane. */
export declare function hasAnyPreset(p: {
    agent: Record<number, unknown>;
    glass: Record<number, unknown>;
    sidebar: Record<number, unknown>;
    zoom?: Record<number, unknown>;
}): boolean;
/** Is the event target an editable surface? The wiring calls this FIRST —
 *  typing "1" in a composer must never fire a preset. */
export declare function isEditableTarget(t: unknown): boolean;
/** One key event through the machine. now is injectable for tests.
 *
 *  ARM ON KEYDOWN — keyup is unreachable through window keydown wiring,
 *  and an arm-on-keyup rule would eat the chord it just armed: keyups
 *  pass through untouched. */
export declare function chordKey(state: ChordState, ev: ChordKey, canArm: boolean, now?: number, tables?: ChordTables): {
    state: ChordState;
    action: ChordAction;
};
/** The capture-first decision as a PURE function so the route adapter
 *  stays three lines and the capture rules unit-test without DOM.
 *  Ordering IS the contract: (1) a clean arming keydown captures
 *  everywhere; (2) an armed chord captures the next keydown everywhere;
 *  (3) anything else — including an un-armed digit on an editable
 *  target — passes. preventDefault is the swallowing the composer must
 *  never see. */
export declare function decideChordKeydown(state: ChordState, ev: ChordKey, canArm: boolean, now?: number, tables?: ChordTables): {
    state: ChordState;
    action: ChordAction;
    preventDefault: boolean;
};
