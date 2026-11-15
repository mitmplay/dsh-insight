<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import { t } from '$lib/services/locale/locale-state.svelte';
	import { CHORD_WINDOW_MS } from '@deepseek-insight/container-base';
	import { ChordPaletteOverlay } from '@deepseek-insight/container-base';
	/**
	 * ChordPalette — the DSI RENDERER over the package's overlay (ADR-0062
	 * W4, D8): the overlay face (centered box, rows, decay ticker) lives
	 * in @deepseek-insight/container-base; THIS file supplies only DSI's
	 * vocabulary — the paraglide labels naming the armed prefix and the
	 * CHORD_WINDOW_MS action window (ADR-0052). The armed prefix never
	 * enters the package (D5); no stores, no key handlers here.
	 */
	let {
		open,
		rows,
		since,
		prefix,
		onexpire
	}: {
		/** True between the arming chord and the fire / disarm / decay. */
		open: boolean;
		/** The live options, already filtered by the reducer helper. */
		rows: { key: string; label: string }[];
		/** Date.now() of the arming — the decay clock's zero. */
		since: number;
		/** The armed prefix — the palette names it (Alt+S or Alt+T, ADR-0052). */
		prefix: 's' | 't';
		/** Fired once at 100% — the route resets the chord. */
		onexpire: () => void;
	} = $props();
</script>

<ChordPaletteOverlay
	{open}
	{rows}
	{since}
	windowMs={CHORD_WINDOW_MS}
	title={t(() => m.chordArmedTitle({ prefix }))}
	ariaLabel={t(() => m.chordArmedLabel({ prefix }))}
	{onexpire}
/>
