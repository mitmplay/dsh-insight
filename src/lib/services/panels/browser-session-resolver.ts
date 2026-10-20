/**
 * browser-session-resolver — the ONE re-bind-or-open seam (The Sticky Glass
 * spec Wave 2 task 2.1; ADR-0030 D1/D4). The chip, the floor placement, and
 * the panel's remount all ask here; none of them POSTs /api/browser open
 * directly. Policy: the persisted localStorage id wins if the registry still
 * lists it live (RE-BIND — reload survival); a dead id falls through to a
 * fresh open, never an error surface. The resolved id is persisted so the
 * NEXT reload re-binds too.
 */

const LS_KEY = 'dsi.browser.sessionId';

/** localStorage guarded — SSR and privacy modes have no window.localStorage. */
function defaultStorage(): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null {
	try {
		return typeof localStorage !== 'undefined' ? localStorage : null;
	} catch {
		return null;
	}
}

export function readPersistedId(storage: Pick<Storage, 'getItem'> | null = defaultStorage()): string | null {
	try {
		return storage?.getItem(LS_KEY) ?? null;
	} catch {
		return null;
	}
}

export function persistId(id: string, storage: Pick<Storage, 'setItem'> | null = defaultStorage()): void {
	try {
		storage?.setItem(LS_KEY, id);
	} catch {
		/* full/quota'd storage must never break an open */
	}
}

// ── The panel's floor slot ────────────────────────────────────────────
// The floor blob does not persist the browser species, so its POSITION
// would drift every reload (the fallback focused-slot depends on what is
// selected at boot). The index rides localStorage next to the session id:
// the page's persistence effect writes it on every floor change, the boot
// auto-restore inserts at exactly that slot.
const IDX_KEY = 'dsi.browser.panelIndex';

export function readPersistedIndex(storage: Pick<Storage, 'getItem'> | null = defaultStorage()): number | null {
	try {
		const raw = storage?.getItem(IDX_KEY);
		const n = raw === null || raw === undefined ? NaN : Number(raw);
		return Number.isInteger(n) && n >= 0 ? n : null;
	} catch {
		return null;
	}
}

export function persistPanelIndex(index: number, storage: Pick<Storage, 'setItem' | 'removeItem'> | null = defaultStorage()): void {
	try {
		if (Number.isInteger(index) && index >= 0) storage?.setItem(IDX_KEY, String(index));
		else storage?.removeItem(IDX_KEY);
	} catch {
		/* quota — the slot memory is best-effort */
	}
}

function clearPersistedId(storage: Pick<Storage, 'removeItem'> | null = defaultStorage()): void {
	try {
		storage?.removeItem(LS_KEY);
	} catch {
		/* nothing to salvage */
	}
}

export interface ResolveDeps {
	fetchImpl?: typeof fetch;
	storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null;
}

export interface ResolveResult {
	id: string;
	/** true = the persisted id was still live and we RE-BOUND (reload
	 *  survival); false = a fresh session was opened. */
	reBound: boolean;
}

/** Re-bind or open — ADR-0030 D4's single policy home. */
export async function resolveBrowserSession(apiBase = '', deps: ResolveDeps = {}): Promise<ResolveResult> {
	const doFetch = deps.fetchImpl ?? fetch;
	const storage = deps.storage === undefined ? defaultStorage() : deps.storage;

	const persisted = readPersistedId(storage);
	if (persisted) {
		try {
			const res = await doFetch(apiBase + '/api/browser');
			if (res.ok) {
				const body = (await res.json()) as { sessions?: { id: string }[] };
				if (body.sessions?.some((s) => s.id === persisted)) {
					return { id: persisted, reBound: true };
				}
			}
		} catch {
			/* list unreachable — fall through to open (same as dead id) */
		}
		// the id is dead on the server — drop it before opening over it
		clearPersistedId(storage);
	}

	const res = await doFetch(apiBase + '/api/browser', { method: 'POST' });
	if (!res.ok) throw new Error('open failed: ' + res.status);
	const info = (await res.json()) as { id: string };
	persistId(info.id, storage);
	return { id: info.id, reBound: false };
}
