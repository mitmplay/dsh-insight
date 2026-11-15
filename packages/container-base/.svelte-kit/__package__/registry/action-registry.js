/**
 * action-registry — the generic leaf-to-root action channel (ADR-0062 W3,
 * D8: split from DSI's panel-registry; the payload unions stay in the
 * consumer). Shape follows the OCI ControlRail precedent: register(name,
 * fn | null) slots owned by the host's mount/destroy lifecycle, invoke
 * returning boolean (false = no handler, graceful no-op — never a crash
 * in a leaf). Payload-agnostic: actions are string-keyed, arguments
 * variadic, the table never inspects a payload.
 */
export function createActionTable() {
    const slots = new Map();
    return {
        register(action, handler) {
            if (handler === null)
                slots.delete(action);
            else
                slots.set(action, handler);
        },
        has(action) {
            return slots.has(action);
        },
        invoke(action, ...args) {
            const handler = slots.get(action);
            if (handler === undefined)
                return false;
            // The table is payload-agnostic by construction; the consumer's
            // register-time types are the contract, invoke erases shape.
            handler(...args);
            return true;
        },
        invokeForResult(action, ...args) {
            const handler = slots.get(action);
            if (handler === undefined)
                return undefined;
            return handler(...args);
        },
        isActive() {
            return slots.size > 0;
        },
        reset() {
            slots.clear();
        }
    };
}
