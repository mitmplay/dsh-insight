/**
 * Page prefs — the workspace route's layout state, service-owned
 * (ADR-0018 D2/D4 wave 2; spec "Component Standard Enforcement" 2.1).
 *
 * SINGLETON by design: one page load = one desk. Owns the numbers that
 * were inline `$state` in `src/routes/+page.svelte` (the prefs block
 * and the sidebar block) so the route's remaining script is floor
 * ownership, not storage plumbing.
 *
 * Persistence split (honest, not hidden):
 * - sidebar prefs: fully owned here — `installSidebarAutoSave()` (call
 *   during component init; the `$effect` needs an owner context).
 * - the FLOOR blob stays persisted by the route's one R2 effect: it
 *   mixes these fields with `panels`/`selectedPanelId`/`terminalDeskMirrors`
 *   which remain floor-owned. The service only owns the numbers.
 */
import {
	clampPanelWidth,
	clampPanelZoom,
	clampTermFontSize,
	clampTreePct,
	loadPanelPrefs
} from '$lib/utils/panel-prefs';
import { loadSidebarPrefs, saveSidebarPrefs } from '$lib/utils/sidebar-prefs';

class PagePrefs {
	/** Width preset for the next conversation panel (clamped). */
	panelWidth = $state(0);
	/** Floor zoom (clamped). */
	zoom = $state(1);
	/** Explorer Layout split (clamped). */
	treePct = $state(0);
	/** Explorer hide/show (2026-10-31 toggle RCA): $state is REQUIRED —
	 *  a plain field swallowed the toggle click silently (no re-render). */
	explorerHidden = $state(false);
	/** Terminal base font in px (ADR-0041 Am.4): the TermFontSlider's
	 *  truth. Zoom multiplies on top — this is the preference NUMBER. */
	termFontSize = $state(12);
	/** Sidebar rail state (OCI ControlRail port). */
	sidebarCollapsed = $state(false);
	sidebarWidth = $state(0);
	/** Sidebar width-badge phase (Movable Rail ADR amendment 2026-10-30):
	 *  'live' while the gutter drag moves, 'fading' through the 10s
	 *  afterglow, null otherwise. GESTURE state, never persisted — the
	 *  save whitelist below carries only collapsed + width. */
	sidebarBadge = $state<'live' | 'fading' | null>(null);

	#profile: string | null = null;
	#initialised = false;
	/** Non-reactive: the afterglow timer id (drag.svelte.ts dragRefs
	 *  pattern — timers never belong in reactive state). */
	#afterglowTimer: ReturnType<typeof setTimeout> | null = null;

	/** Seed every field from the persisted blobs — exactly once, BEFORE
	 *  the route reads any field (makePanel reads panelWidth during the
	 *  seed reset). Intentional initial capture per the route's old
	 *  "svelte-ignore state_referenced_locally" comments: prefs seed the
	 *  layout once; later writes go through the save effects. */
	init(profile: string | null): void {
		// One MOUNT = one desk: the route's old inline $state seeded from
		// localStorage on every component init (a fresh page load each
		// time), so init always re-seeds — the singleton exists to share
		// the values with the route's save effect, not to dedupe loads.
		this.#initialised = true;
		this.#profile = profile;
		const floor = loadPanelPrefs(profile);
		this.panelWidth = clampPanelWidth(floor.panelWidth);
		this.zoom = clampPanelZoom(floor.zoom);
		this.treePct = clampTreePct(floor.treePct);
		this.explorerHidden = floor.explorerHidden === true;
		this.termFontSize = clampTermFontSize(floor.termFontSize);
		const sidebar = loadSidebarPrefs(profile);
		this.sidebarCollapsed = sidebar.collapsed;
		this.sidebarWidth = sidebar.width;
	}

	get profile(): string | null {
		return this.#profile;
	}

	/** Sidebar persistence (the route's old sidebar save effect). Call
	 *  during component initialisation — $effect needs an owner. */
	installSidebarAutoSave(): void {
		$effect(() => {
			saveSidebarPrefs(
				{ collapsed: this.sidebarCollapsed, width: this.sidebarWidth },
				this.#profile
			);
		});
	}

	/** The badge afterglow (10s linear fade, mirroring the floor's
	 *  drag.svelte.ts:118-128): called at gutter mouseup — freezes the
	 *  phase into 'fading', then null. A drag that starts before the
	 *  timer fires cancels it (the chip goes back to live instantly,
	 *  never a 10s fade-in). */
	armSidebarAfterglow(): void {
		this.sidebarBadge = 'fading';
		if (this.#afterglowTimer !== null) clearTimeout(this.#afterglowTimer);
		this.#afterglowTimer = setTimeout(() => {
			this.sidebarBadge = null;
			this.#afterglowTimer = null;
		}, 10_000);
	}

	/** A new gutter drag cancels any armed afterglow. */
	cancelSidebarAfterglow(): void {
		if (this.#afterglowTimer !== null) {
			clearTimeout(this.#afterglowTimer);
			this.#afterglowTimer = null;
		}
		this.sidebarBadge = 'live';
	}
}

export const pagePrefs = new PagePrefs();
