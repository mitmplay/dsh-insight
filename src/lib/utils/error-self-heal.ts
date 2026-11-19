/**
 * Error-page self-heal gate (ADR-0075): in dev ONLY, a 500 error page
 * reloads itself exactly once after 1500ms — the dev server's HMR
 * invalidation window returns 500s for ~5s after every file edit, and
 * the operator's open tab should recover without action. Prod is dead
 * code here (the `dev` constant is build-time), and non-500 statuses
 * (404 reaped session / 503 host down / 409 ownership) never reload:
 * those are real states whose evidence a reload would erase.
 */

/** The gate — true iff this error page should reload itself. */
export function shouldSelfHeal(status: number, dev: boolean): boolean {
	return dev && status === 500;
}

/**
 * Arm the one-shot reload. Returns the disarm function (cleared on
 * unmount). `reload` is injectable so tests never touch location.
 */
export function armSelfHeal(
	status: number,
	dev: boolean,
	reload: () => void = () => location.reload()
): () => void {
	if (!shouldSelfHeal(status, dev)) return () => {};
	const timer = setTimeout(reload, 1500);
	return () => clearTimeout(timer);
}
