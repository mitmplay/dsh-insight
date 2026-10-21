/**
 * heartbeat-scope — THE one owner of heartbeat watch calls (ADR-0034 D2).
 *
 * Wanted set = always (active panels ∪ current conversation) ∪ scope rows:
 *  - viewport-cap: the rows on screen (the sidebar's IntersectionObserver
 *    reports them, ±200px hysteresis);
 *  - ticker-cap:   every spine session (today's behavior, ADR-0034 D1).
 *
 * A collapsed sidebar renders no rows, so its viewport set is empty and the
 * heartbeat collapses to panels + current — a natural consequence, not a
 * special case (D5). Ids leaving the wanted set are evicted after a grace
 * of one tick cycle so viewport-edge wobble cannot re-fetch (D6). New ids
 * arm via jobsRoster.armMany — NO per-id singular fetch; the scope's own
 * debounced batch covers them (D3).
 *
 * The service owns watches with refs armed at 1; badge-side watch() calls
 * (ticker mode only) are free extra refs on top. BC-7: no client timers —
 * everything here runs on observer/tick-driven calls.
 */
import { jobsRoster } from './roster-store.svelte';

/** Evict grace in ms — just over one default tick so edge-wobble re-arms
 *  from cache instead of re-fetching. */
const GRACE_MS = 6_000;

/** Debounce for scroll-burst arming (D3) — coalesces fast scrolls into one
 *  batch GET. */
const ARM_DEBOUNCE_MS = 200;

class HeartbeatScope {
	/** The ids that must always be watched: paneled sessions ∪ current. */
	private always = new Set<string>();
	/** Ids currently reported on screen (viewport-cap). */
	private viewport = new Set<string>();
	/** Every spine id (ticker-cap). */
	private spine = new Set<string>();
	/** The active mode — fed from app-config by the wiring effect. */
	private mode: 'viewport-cap' | 'ticker-cap' = 'viewport-cap';
	/** Ids armed by the scope (its own watch refs). */
	private armed = new Set<string>();
	/** Pending eviction timers (grace, D6). */
	private graceTimers = new Map<string, ReturnType<typeof setTimeout>>();
	/** Pending arming debounce timer (D3). */
	private armTimer: ReturnType<typeof setTimeout> | undefined;
	/** Ids waiting inside the arming debounce. */
	private pendingArm = new Set<string>();

	setAlways(ids: string[]): void {
		this.always = new Set(ids.filter(Boolean));
		this.rebuild();
	}

	setViewport(ids: string[]): void {
		this.viewport = new Set(ids.filter(Boolean));
		this.rebuild();
	}

	setSpine(ids: string[]): void {
		this.spine = new Set(ids.filter(Boolean));
		this.rebuild();
	}

	setMode(mode: 'viewport-cap' | 'ticker-cap'): void {
		if (this.mode === mode) return;
		this.mode = mode;
		this.rebuild();
	}

	/** Test seam — drop every arm/grace/debounce so a fresh scope starts.
	 *  Releases the store watches the scope armed (unwatch per id), because
	 *  armMany skips ids that already carry a watch entry. */
	reset(): void {
		for (const id of this.armed) jobsRoster.unwatch(id);
		this.always.clear();
		this.viewport.clear();
		this.spine.clear();
		this.armed.clear();
		this.pendingArm.clear();
		for (const timer of this.graceTimers.values()) clearTimeout(timer);
		this.graceTimers.clear();
		if (this.armTimer !== undefined) {
			clearTimeout(this.armTimer);
			this.armTimer = undefined;
		}
	}

	/** The wanted set under the current mode (D1). */
	private wanted(): Set<string> {
		const wanted = new Set(this.always);
		if (this.mode === 'ticker-cap') {
			for (const id of this.spine) wanted.add(id);
		} else {
			for (const id of this.viewport) wanted.add(id);
		}
		return wanted;
	}

	/** Diff the wanted set against the armed set and apply the delta. */
	rebuild(): void {
		const wanted = this.wanted();
		// new ids → debounce-arm, then ONE batch GET covers the burst (D3)
		for (const id of wanted) {
			if (this.armed.has(id)) continue;
			this.pendingArm.add(id);
			this.cancelGrace(id);
		}
		if (this.pendingArm.size > 0 && this.armTimer === undefined) {
			this.armTimer = setTimeout(() => {
				this.armTimer = undefined;
				const ids = [...this.pendingArm].filter((id) => this.wanted().has(id));
				this.pendingArm.clear();
				for (const id of ids) {
					this.armed.add(id);
				}
				jobsRoster.armMany(ids);
			}, ARM_DEBOUNCE_MS);
			this.armTimer.unref?.();
		}
		// gone ids → evict after grace (D6)
		for (const id of [...this.armed]) {
			if (wanted.has(id)) continue;
			if (this.graceTimers.has(id)) continue;
			const timer = setTimeout(() => {
				this.graceTimers.delete(id);
				if (this.wanted().has(id)) return;
				this.armed.delete(id);
				jobsRoster.unwatch(id);
			}, GRACE_MS);
			timer.unref?.();
			this.graceTimers.set(id, timer);
		}
		// back within grace → cancel the pending eviction
		for (const id of wanted) this.cancelGrace(id);
	}

	private cancelGrace(id: string): void {
		const timer = this.graceTimers.get(id);
		if (timer === undefined) return;
		clearTimeout(timer);
		this.graceTimers.delete(id);
	}
}

export const heartbeatScope = new HeartbeatScope();
