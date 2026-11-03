/**
 * SlashMenu's exported pure helpers, in a plain .ts module so BOTH
 * svelte-check (svelte2tsx) AND raw tsc see the named exports — the
 * wildcard `declare module '*.svelte'` ambient has no named members,
 * so module-script exports of a .svelte file are invisible to tsc.
 * SlashMenu.svelte re-exports these from its <script module> (ONE
 * source of truth; existing importers keep their import paths).
 */

/**
 * slashMenuMatches — the menu's And-filter, exported so the HOST
 * counts matched rows for its keyboard guard with the SAME matcher
 * (ONE source of truth; the menu and the ladder-guard never drift).
 *
 * Strip parity: split the query on `;` and whitespace, lowercase,
 * drop empties; EVERY term must hit the row's display text
 * (`name + description`), case-insensitive. A bare `/` (query with
 * no terms) matches everything — the open menu lists the whole
 * vocabulary before the operator narrows it.
 */
export function slashMenuMatches(
	row: { name: string; description: string; display?: string },
	query: string
): boolean {
	const terms = query
		.slice(1)
		.toLowerCase()
		.split(/[;\s]+/)
		.filter(Boolean);
	if (terms.length === 0) return true;
	// The Shelf Voice W1 fix (RCA 2026-09-20): the DISPLAY token is what
	// the operator types — a gesture whose name differs from its display
	// ('skillshelf' vs '/dsi-skills') must still be findable by the
	// visible prefix, so the display rides the haystack.
	const hay = `${row.name} ${row.display ?? ''} ${row.description}`.toLowerCase();
	return terms.every((t) => hay.includes(t));
}

/**
 * slashMenuScrollIntoView — the keyboard-follow rule (2026-09-03 bug
 * fix): arrowing past the menu's viewport must carry the active row
 * into view, or the operator steers blind past the cap. PURE so the
 * math is pinned by plain-number unit tests; the component's effect
 * applies the returned scrollTop to the menu container only — never
 * an ancestor scroller (the page must not move because the menu
 * arrowed).
 *
 * @param activeTop the active row's offsetTop (the container is the
 *                  rows' offsetParent — it is position:absolute).
 * @param activeBottom activeTop + the row's offsetHeight.
 * @param scrollTop the container's current scrollTop.
 * @param clientHeight the container's visible height.
 * @returns the new scrollTop when the row sits outside the view
 *          (minimum movement: align the breached edge), null when the
 *          row is already fully visible — no scroll, no jump.
 */
export function slashMenuScrollIntoView(
	activeTop: number,
	activeBottom: number,
	scrollTop: number,
	clientHeight: number
): number | null {
	if (activeTop < scrollTop) return activeTop;
	if (activeBottom > scrollTop + clientHeight) return activeBottom - clientHeight;
	return null;
}
