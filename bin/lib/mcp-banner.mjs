// mcp-banner — A6 D7d: when --playwright-mcp is present, say out loud what
// the operator just chose, in plain language, BEFORE any child spawns.
// Extracted as a module so the exact text is unit-pinned (T3-T).

/** @param {boolean} devFloor - true when a --dev mode was chosen
 * @returns {string[]} banner lines (never empty; the caller prints each) */
export function brainBannerLines(devFloor) {
	const blast = devFloor
		? 'a brain failure can now touch this dev floor server.'
		: 'a brain failure can now touch this page server — not just the glass.';
	return [
		'',
		'────────── playwright-mcp: in-process browser brain ──────────',
		'You asked for the browser-assist brain to run INSIDE the DSI page',
		'server instead of as its own separate background helper.',
		'',
		'What that means:',
		'  + one less background process on your machine, faster start',
		'  - ' + blast,
		'    Before, it could only lose the glass panel, never the server.',
		'',
		'Drop the --playwright-mcp flag to go back to the old helper process.',
		'───────────────────────────────────────────────────────────────',
		''
	];
}
