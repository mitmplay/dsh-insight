/**
 * action-registry — the generic leaf-to-root action channel (ADR-0062 W3,
 * D8: split from DSI's panel-registry; the payload unions stay in the
 * consumer). Shape follows the OCI ControlRail precedent: register(name,
 * fn | null) slots owned by the host's mount/destroy lifecycle, invoke
 * returning boolean (false = no handler, graceful no-op — never a crash
 * in a leaf). Payload-agnostic: actions are string-keyed, arguments
 * variadic, the table never inspects a payload.
 */
type AnyHandler = (...args: never[]) => unknown;
export interface ActionTable {
    /** Set (or overwrite) an action's handler; null unregisters. */
    register(action: string, handler: AnyHandler | null): void;
    /** True when a handler is currently registered for the action. */
    has(action: string): boolean;
    /** Run the action's handler if registered.
     *  @returns true when a handler ran; false otherwise. */
    invoke(action: string, ...args: unknown[]): boolean;
    /** Like invoke, but returns the HANDLER'S OWN return value — undefined
     *  when no handler is registered. For result-carrying actions (e.g. a
     *  handler that reports a miss) where 'did it run' and 'what did it
     *  say' are different questions. */
    invokeForResult(action: string, ...args: unknown[]): unknown;
    /** True when ANY handler is registered (a host is mounted). */
    isActive(): boolean;
    /** Clear every slot (isolation between tests / host destroy). */
    reset(): void;
}
export declare function createActionTable(): ActionTable;
export {};
