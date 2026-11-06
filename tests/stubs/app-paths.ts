/**
 * Test stub for $app/paths (SvelteKit runtime module) — the spine row's
 * seed deep link passes conversationSeedUrl() through resolve() (RowSessionItem,
 * "The Birth Path Sends workspaceId" wave). Under vitest there is no router,
 * so resolve is the identity: the seed URL is already an absolute path.
 */
export const base = '';
export const assets = '';

export function resolve(value: string): string {
	return value;
}

export function resolveRoute(value: string, params?: unknown): string {
	void params;
	return value;
}
