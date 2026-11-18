/**
 * R10 SC#1 fix 3 (operator 2026-11-19): no SSR on the playground route.
 *
 * The desk lives in localStorage — the server can only render DEFAULTS
 * (Notes selected), so every reload painted the default desk first and
 * visibly flashed to the saved one when hydration corrected it (the
 * boot-register block already makes the CLIENT first render the saved
 * desk; SSR HTML kept beating it to first paint on the dev bundle).
 * With ssr=false the first paint IS the client render: boot register +
 * localStorage read at init, no flash by construction. The theme applier
 * stays inline in app.html, so there is still no theme flash.
 */
export const ssr = false;
