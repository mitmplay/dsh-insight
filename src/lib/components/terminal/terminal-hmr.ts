/**
 * terminal-hmr — the HMR LEASE detector (Surviving Shell ADR amendment
 * 2026-11-04, dev-only). A vite hot swap disposes the panel WITHOUT a
 * pagehide, so the teardown ladder's plain-unmount clause ("panel close
 * IS terminal close") would kill the session on every hot swap. This
 * seam surfaces vite's `import.meta.hot` so the panel can arm the lease,
 * and so tests can pin both shapes: hot present (dev) and hot absent
 * (production — the ladder stays byte-identical).
 *
 * TWO arming mechanisms, because HMR has two teardown paths:
 * - dispose hook — fires only when THIS module is invalidated.
 * - vite:beforeUpdate / vite:afterUpdate — vite BROADCASTS these to every
 *   hot context for ANY update in the graph; an ancestor self-accepting
 *   boundary (e.g. the desk) stops invalidation propagation but the
 *   broadcast still reaches us, BEFORE its child panels are torn down.
 *   afterUpdate disarms, so the lease window covers exactly the swap's
 *   teardown and a later deliberate panel × still closes (fact 11).
 */
export interface ViteHot {
	dispose(cb: () => void): void;
	on(event: string, cb: (payload?: unknown) => void): void;
}

export function panelHot(): ViteHot | undefined {
	return (import.meta as unknown as { hot?: ViteHot }).hot;
}
