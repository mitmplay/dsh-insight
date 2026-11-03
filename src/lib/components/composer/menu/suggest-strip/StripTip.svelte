<script lang="ts">
	/**
	 * StripTip — the multiline full-text preview tooltip of one suggestion
	 * row (OCI's StripMultiline lineage, its own component again).
	 *
	 * Presentational: chip anchor + live flags + raw text in, one portaled
	 * tooltip out. Visible while its chip is the active (keyboard-
	 * highlighted) row and no ⋯ menu is open anywhere on the strip (the
	 * host threads menuOpen/anyMenuOpen). 2026-10-29 amendment: the old
	 * multiline-only gate (text.includes('\n')) is GONE — a single-line
	 * active row shows its one-line preview too, or the operator reads
	 * the selection as broken (the `?yt` bug: chip active, tip absent,
	 * row looks unselected). Newline still renders verbatim when present.
	 *
	 * 2026-10-29: renders PRE-formatted PLAIN text, not markdown — macros
	 * are command text; the markdown render collapsed single newlines and
	 * turned `/load …` lines into list bullets (ADR-0044-adjacent fix,
	 * operator screenshot). textContent renders verbatim, no {@html}.
	 */

	let {
		/** The chip root element — the tooltip's position anchor; its
		 *  parentElement IS the host .suggest-strip. */
		anchor,
		/** True while this chip is the active (keyboard-highlighted) row. */
		active = false,
		/** True while THIS chip's ⋯ menu is open — hides the tooltip. */
		menuOpen = false,
		/** True while ANY chip's ⋯ menu is open — hides the tooltip. */
		anyMenuOpen = false,
		/** The row's raw text — multiline is the tooltip's reason to exist. */
		text
	}: {
		anchor?: HTMLElement;
		active?: boolean;
		menuOpen?: boolean;
		anyMenuOpen?: boolean;
		text: string;
	} = $props();

	/** Tooltip box; null = hidden. Mirrors the STRIP's horizontal geometry
	 *  — same left edge, same width — regardless of which chip is active;
	 *  y anchors above the whole strip. Hides whenever any ⋯ menu is open. */
	let tipPos = $state<{ x: number; y: number; w: number } | null>(null);
	let tipEl = $state<HTMLDivElement | undefined>();

	// While this chip is the active (keyboard-highlighted) row, anchor the
	// popup above the whole strip. effect.pre: the anchor settles before the
	// popup mounts (no position flash).
	//
	// 2026-11-03 re-anchor amendment: the effect's reactive deps (active/
	// menuOpen/anyMenuOpen/anchor) do NOT include the strip's geometry, so a
	// strip that MOVED without the flags changing — search narrowing from
	// SC#1 rows to SC#2 rows shifts the strip's top — left the tip floating
	// at the stale rect. While visible we now KEEP measuring: a
	// ResizeObserver on the strip (row count changes resize it) plus a
	// window resize listener and a capture-phase scroll listener (the strip
	// can move without resizing — the textarea above it grows). All torn
	// down with the effect when the tip hides.
	function measure(): void {
		if (!anchor) return;
		const strip = anchor.parentElement; // direct parent IS .suggest-strip
		if (!strip) return;
		const sr = strip.getBoundingClientRect();
		tipPos = {
			x: Math.max(0, sr.left),
			y: Math.max(8, sr.top - 4),
			w: sr.width
		};
	}

	$effect.pre(() => {
		if (!active || menuOpen || anyMenuOpen || !anchor) {
			tipPos = null;
			return;
		}
		const strip = anchor.parentElement; // direct parent IS .suggest-strip
		if (!strip) return;
		measure();
		const ro = new ResizeObserver(measure);
		ro.observe(strip);
		window.addEventListener('resize', measure);
		window.addEventListener('scroll', measure, true);
		return () => {
			ro.disconnect();
			window.removeEventListener('resize', measure);
			window.removeEventListener('scroll', measure, true);
		};
	});

	// Portal the tooltip to document.body (BC-7 — same zoom-transform
	// escape as the ⋯ menu popup).
	$effect(() => {
		if (!tipEl) return;
		const el = tipEl; // capture: bind:this nulls tipEl before cleanup runs
		document.body.appendChild(el);
		return () => {
			el.remove();
		};
	});
</script>

{#if active && !menuOpen && !anyMenuOpen && tipPos}
	<!-- Full-text VERBATIM preview while this multiline chip is the
	     active row: fixed above the strip, strip-aligned, kept
	     content-height with a 70vh cap, portaled to document.body
	     (zoom-transform-safe), never interactive (keyboard stays in
	     the prompt textarea). Plain <pre> — macros are command text;
	     every newline renders as itself, no markdown rewriting. -->
	<div
		bind:this={tipEl}
		class="strip-tip"
		role="tooltip"
		style={`left:${tipPos.x}px; top:${tipPos.y}px; width:${tipPos.w}px;`}
	><pre class="strip-tip-pre">{text}</pre></div>
{/if}

<style>
	/* Multiline preview tooltip — fixed to viewport, strip-aligned (left +
	   width set inline from the strip's rect), opening ABOVE the strip.
	   Never interactive: pointer-events none, no focus. Portaled to
	   document.body. */
	.strip-tip {
		position: fixed;
		transform: translateY(-100%);
		z-index: 10002; /* above the ⋯ menu popup (10001) */
		background: var(--color-surface-elevated, #ffffff);
		border: 1px solid var(--color-surface-border, #dee2e6);
		border-radius: 0.375rem;
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
		padding: 0.25rem;
		pointer-events: none;
	}

	.strip-tip-pre {
		margin: 0;
		/* Scale parity with the strip rows: the chip labels render 0.75rem
		   sans; the same 0.75rem in a MONO face draws visibly larger, so the
		   preview steps down one notch (0.6875rem) to sit at the strip's
		   optical size. line-height 1.45 keeps the mono lines airy. */
		font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
		font-size: 0.6875rem;
		line-height: 1.45;
		white-space: pre-wrap;
		word-break: break-word;
		overflow-y: auto;
		max-height: 70vh;
		padding: 0.25rem 0.375rem;
		color: var(--color-text-primary, #212529);
	}
</style>
