<script lang="ts">
	/**
	 * SessionStatus — the shared session-status glyph (extracted from
	 * WorkspaceRowItem, 2026-08-26): running renders THREE ANIMATED BARS —
	 * a stream/equalizer glyph, staggered like the chat
	 * StreamingIndicator (the house pattern for live motion); idle
	 * renders the static grey dot. Same 0.5rem footprint in every host
	 * — the rows' geometry and the title chip alike.
	 *
	 * FRAGMENT BY DESIGN: one root span, no wrapper — the host's flex
	 * gap spaces it like any other child. WorkspaceRowItem renders it as
	 * its leading node; the panel-group title chip renders it beside
	 * the focused panel's name.
	 *
	 * prefers-reduced-motion freezes the bars at staggered static
	 * heights — still a distinct "running" glyph, never moving
	 * (WCAG 2.3.3).
	 *
	 * Palette (2026-08-26): defaults hold contrast on every field the
	 * hosts paint — white spine, the panel group's accent wash (14%),
	 * row hover (18%), the LIGHT selected field (30% accent) — so
	 * hosts override nothing except where meaning demands it (the
	 * dead-row override (--si-idle: red-800) in the panel group's rows
	 * and title chip). Ratios (calibrated script): idle var(--color-slate-neutral)
	 * 6.46/5.52/—/4.54. CSS custom properties (--si-run, --si-idle)
	 * remain the extension point for fields this file does not know.
	 *
	 * Run color is owned app-wide (2026-09-03): app.css defines
	 * --si-run red (var(--si-run)) on :root and this file's fallback matches —
	 * the glyph paints red with or without the app stylesheet. The red
	 * is the palette's calibrated one (ratios under the delegation
	 * section below); the retired teal (#0f867a) measured
	 * 4.46/3.81/3.63/3.14 on the same fields.
	 *
	 * Four-state glyph (2026-08-27 lineage sidebar, ADR D3 — motion = me,
	 * delegation marked, not hue): the `delegated` prop (default false)
	 * marks sub-agents working; since run shares the red family
	 * app-wide, the ×N badge and the accessible name carry the
	 * delegation split:
	 *
	 *   running  delegated  glyph
	 *   –        –          grey dot (idle)
	 *   ✓        –          red bars (working)
	 *   ✓        ✓          red bars + ×N badge — working AND sub-agents
	 *                       working
	 *   –        ✓          red bullet — idle self, delegation live
	 *                       (the fire-and-forget parent: honest in both
	 *                       directions, never fakes motion it lacks)
	 *
	 * The ×N count badge (prop `count`, renders only when > 0) is the
	 * non-color carrier (WCAG 1.4.1 — hue alone can no longer split run
	 * from delegated): absolutely positioned outside the 0.5rem
	 * footprint, aria-hidden (the count also rides the accessible name).
	 * Reduced-motion freezes both states the same way.
	 *
	 * Delegation red var(--si-run) (red-700), calibrated 2026-08-27 — channel
	 * fix vs the first script run ([0,2,4] on bare hex, not [1,3,5]):
	 * 6.47 white / 5.53 wash14 / 5.27 hover18 / 4.55 selected30 —
	 * clears 1.4.11's 3:1 on every field with margin. NOTE: the ADR's
	 * amber fallback #ea580c measures 3.56/3.04/2.90/2.51 — FAILS
	 * hover and selected; it is NOT contrast-viable. If review finds
	 * delegation red confusable with the dead tint (row-level red-800
	 * var(--color-danger-wash-ink): 8.31/7.11/6.77/5.85 — different scope, different shade,
	 * plus the ×N badge), the replacement must be re-measured, never
	 * assumed.
	 */
	let {
		running,
		delegated = false,
		count = 0,
		browser = false
	}: {
		/** Live-turn flag — bars when true, static dot when false. */
		running: boolean;
		/** Delegation live — at least one descendant session running. */
		delegated?: boolean;
		/** Live descendant count — badge renders only when > 0. */
		count?: number;
		/** ADR-0037 D4 — a folded GLASS row: the glyph is a pulsing frame,
		 *  never the stream bars (a browser session is not a chat turn). */
		browser?: boolean;
	} = $props();

	/** Accessible name — four distinct states; the count rides along
	 *  (WCAG 1.4.1: never color alone). */
	const label = $derived(
		browser
			? 'browser session, folded — click to open'
			: running
			? delegated
				? count > 0
					? `running and delegating, ${count} running`
					: 'running and delegating'
				: 'running'
			: delegated
				? count > 0
					? `delegating, ${count} running`
					: 'delegating'
				: 'idle'
	);
</script>

<span
	class="status"
	class:run={running && !browser}
	class:idle={!running && !browser}
	class:browser={browser}
	class:delegated={delegated}
	role="img"
	aria-label={label}
	data-testid="session-status"
>
	{#if browser}<span class="frame" aria-hidden="true"></span>{:else if running}<span class="bar"></span><span class="bar"></span><span class="bar"></span>{/if}{#if count > 0}<span class="badge" aria-hidden="true">×{count}</span>{/if}
</span>

<style>
	/* Same 0.5rem footprint the old dot had: the running bars and the
	   idle dot occupy the exact slot every row's geometry was built
	   around (2026-08-23 column audit) — swapping the glyph changed
	   no x anywhere. */
	.status {
		flex-shrink: 0;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 0.5rem;
		height: 0.5rem;
	}

	/* Running: three stream bars, 2px + 1px gaps = the full 8px slot.
	   var(--si-run) — app.css defines --si-run red on :root (2026-09-03) and
	   the fallback matches, so the glyph is red standalone too. The red
	   is the palette's calibrated one: 3:1 (WCAG 1.4.11) holds on every
	   field the hosts paint — white 6.47, wash 5.53, hover 5.27,
	   selected 4.55. */
	.status.run {
		gap: 0.0625rem;
	}

	.bar {
		width: 0.125rem;
		height: 100%;
		border-radius: 9999px;
		background: var(--si-run, var(--si-run));
		animation: ss-stream 1.1s ease-in-out infinite;
	}

	/* Stagger — the StreamingIndicator cadence (0.2s steps; tightened
	   to 0.18s for the shorter 1.1s loop so the wave never collapses
	   into a single pulse). */
	.bar:nth-child(2) {
		animation-delay: 0.18s;
	}

	.bar:nth-child(3) {
		animation-delay: 0.36s;
	}

	@keyframes ss-stream {
		0%,
		100% {
			height: 30%;
		}
		50% {
			height: 100%;
		}
	}

	/* Reduced motion (WCAG 2.3.3): the wave freezes at staggered
	   heights — a static three-bar glyph that still reads "running",
	   distinct from the idle dot, with zero movement. */
	@media (prefers-reduced-motion: reduce) {
		.bar {
			animation: none;
		}
		.bar:nth-child(1) {
			height: 55%;
		}
		.bar:nth-child(2) {
			height: 100%;
		}
		.bar:nth-child(3) {
			height: 35%;
		}
	}

	/* Idle: the static dot, unchanged geometry — var(--color-slate-neutral) (slate):
	   4.5:1+ on every field (white 6.46, wash 5.52, selected 4.54),
	   replacing the old #6c757d that dipped under 3:1 on the wash.
	   The dead override rides --si-idle from the host. */
	.status.idle::after {
		content: '';
		width: 0.5rem;
		height: 0.5rem;
		border-radius: 9999px;
		background: var(--si-idle, var(--color-slate-neutral));
	}

	/* ── Delegation family (2026-08-27, ADR D3) ──────────────────────
	   Motion stays with .run/.idle; the delegated vars remain the hosts'
	   tint-apart extension point. var(--si-run) on every field:
	   6.47/5.53/5.27/4.55 (calibrated, comment above) — since 2026-09-03
	   run shares this red app-wide, so the ×N badge and the accessible
	   name carry the split. The dead-row override keeps priority: hosts
	   setting --si-idle for dead rows ALSO set --si-idle-delegated
	   there (dead outranks delegation — the work outlived the row, but
	   the row says dead). */
	.status.delegated.run .bar {
		background: var(--si-run-delegated, var(--si-run));
	}

	.status.delegated.idle::after {
		background: var(--si-idle-delegated, var(--si-run));
	}

	/* ×N badge (WCAG 1.4.1 non-color carrier): absolute, right of the
	   footprint — hosts spacing rows around 0.5rem see no layout shift.
	   8px text at weight 600 on whatever field the host paints; the
	   count also rides the glyph's accessible name, so the badge itself
	   is aria-hidden. min-width keeps single digits round; ×N uses the
	   multiplication sign, the ADR's literal. */
	.status {
		position: relative;
	}

	.badge {
		position: absolute;
		top: -0.375rem;
		left: 0.4375rem;
		min-width: 0.5rem;
		padding: 0 0.0625rem;
		border-radius: 9999px;
		background: var(--si-run);
		color: #fff;
		font-size: 0.5rem;
		font-weight: 600;
		line-height: 0.625rem;
		text-align: center;
	}

	/* ADR-0037 D4 — the glass glyph: a small framed viewport that
	   breathes (opacity pulse) — motion says 'alive', the frame says
	   'browser', and neither borrows the stream-bars grammar. Same
	   0.5rem footprint; prefers-reduced-motion freezes the pulse. */
	.frame {
		width: 0.55rem;
		height: 0.45rem;
		border: 1.5px solid var(--si-run, #c92a2a);
		border-radius: 1px;
		animation: glass-breathe 1.6s ease-in-out infinite;
	}
	@keyframes glass-breathe {
		0%, 100% { opacity: 1; }
		50% { opacity: 0.35; }
	}
	@media (prefers-reduced-motion: reduce) {
		.frame { animation: none; }
	}
</style>
