/**
 * subagent-clock — the first-sight elapsed registry (Subagent Anchor ADR
 * D3, Wave 3). The wire carries no startedAt for spawned sessions, so DSI
 * measures what it can see: the first poll tick that sighted a RUNNING
 * sub-agent starts its clock; on settle the elapsed freezes at the
 * last-seen delta; ids gone from the spine expire with their sample.
 *
 * HONEST LANES: a sub-agent first seen already settled, or never sighted,
 * has NO sample — elapsedMs returns null and the popup renders a dash,
 * never a guess. MEMORY ONLY: nothing here ever touches localStorage —
 * a page reload resets every clock (the popup's footnote says so).
 *
 * Reactive grammar: $state fields on a class instance (Svelte 5 runes in
 * .svelte.ts); the singleton feeds every open popup; tests build fresh
 * instances from the exported class.
 */

/** The spine facts the clock needs — a DsiSubagentRow subset. */
export interface SubagentSighting {
	sessionId: string;
	running: boolean;
}

export class SubagentClock {
	/** sessionId → first-sight epoch ms (running rows only). */
	private firstSeen = $state<Record<string, number>>({});
	/** sessionId → frozen elapsed ms, set once at the settle observation. */
	private frozen = $state<Record<string, number>>({});
	/** The tick's reading — read by elapsedMs so a live tick re-renders. */
	private now = $state(Date.now());

	/** Feed one spine tick: register unseen running ids, freeze settled
	 *  ones, expire ids gone from the feed. Call on every fetch (the
	 *  button's poll cadence), not on a timer — this IS the sighting lane. */
	observe(rows: readonly SubagentSighting[]): void {
		const t = Date.now();
		const seen = new Set<string>();
		for (const row of rows) {
			seen.add(row.sessionId);
			if (row.running && this.firstSeen[row.sessionId] === undefined) {
				this.firstSeen[row.sessionId] = t; // first sight = clock start
			}
			if (
				!row.running &&
				this.firstSeen[row.sessionId] !== undefined &&
				this.frozen[row.sessionId] === undefined
			) {
				this.frozen[row.sessionId] = t - this.firstSeen[row.sessionId]; // settle freeze
			}
		}
		for (const id of Object.keys(this.firstSeen)) {
			if (!seen.has(id)) {
				delete this.firstSeen[id]; // gone from the spine — sample goes with it
				delete this.frozen[id];
			}
		}
		this.now = t;
	}

	/** Live tick — the open popup calls this on its 1s interval so a
	 *  running row's elapsed advances between polls. */
	tick(): void {
		this.now = Date.now();
	}

	/** Elapsed ms for one id: the frozen settle delta, or now − firstSeen
	 *  for a running row, or null when there is NO honest sample (never
	 *  sighted running, or first seen already settled). */
	elapsedMs(id: string): number | null {
		const frozen = this.frozen[id];
		if (frozen !== undefined) return frozen;
		const t0 = this.firstSeen[id];
		if (t0 === undefined) return null;
		return Math.max(0, this.now - t0);
	}

	/** Does the id carry any sample at all (frozen or live)? */
	sighted(id: string): boolean {
		return this.frozen[id] !== undefined || this.firstSeen[id] !== undefined;
	}
}

/** The desk-lifetime singleton — one registry per page visit (ADR D3). */
export const subagentClock = new SubagentClock();
