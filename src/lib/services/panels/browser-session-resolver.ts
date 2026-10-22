import { writable } from 'svelte/store';

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

// ── The browser slot LIST (Amendment 3: one glass per opener) ────────
// The slot began as a single {index} (the glass was a singleton), grew a
// width (RCA 2026-10-22) and an openedBy (ADR-0036 D4) — and now holds a
// LIST, one entry per glass, each carrying its own sessionId so the boot
// restore re-binds N glasses to N live sessions. Legacy shapes parse:
// a plain number (the original slot) and the single-object form both
// upgrade into the list; junk entries drop field-wise, never throw.

/** One persisted glass: floor position, dragged width, opener
 *  provenance, and the browser-session id the boot restore re-binds to
 *  (absent fields are legacy/junk degrades). */
export interface BrowserSlot {
	index: number;
	width?: number;
	openedBy?: string;
	sessionId?: string;
	/** ADR-0037 D3: the glass is FOLDED — off the floor but its session
	 *  was live at the last tick. The boot auto-restore SKIPS folded
	 *  entries (a glass never comes back to life uninvited, ADR-0029 D8);
	 *  the sidebar row and the summon verb own the bring-back. Mounted
	 *  glasses persist without the flag — remounting clears it. */
	folded?: boolean;
}

/** Read the persisted glass list; every legacy shape upgrades, junk
 *  drops. Sorted by floor position (restore order = floor order). */
export function readBrowserSlots(storage: Pick<Storage, 'getItem'> | null = defaultStorage()): BrowserSlot[] {
	try {
		const raw = storage?.getItem(IDX_KEY);
		if (raw === null || raw === undefined) return [];
		const parsed: unknown = JSON.parse(raw);
		const list: unknown[] = Array.isArray(parsed)
			? parsed
			: parsed !== null && typeof parsed === 'object' && Array.isArray((parsed as { slots?: unknown[] }).slots)
				? (parsed as { slots: unknown[] }).slots
				: [parsed];
		const out: BrowserSlot[] = [];
		for (const item of list) {
			if (typeof item === 'number') {
				if (Number.isInteger(item) && item >= 0) out.push({ index: item });
				continue;
			}
			if (item === null || typeof item !== 'object') continue;
			const o = item as Record<string, unknown>;
			if (!Number.isInteger(o.index) || (o.index as number) < 0) continue;
			const slot: BrowserSlot = { index: o.index as number };
			if (typeof o.width === 'number' && Number.isFinite(o.width) && o.width > 0) slot.width = o.width;
			if (typeof o.openedBy === 'string' && o.openedBy.length > 0) slot.openedBy = o.openedBy;
			if (typeof o.sessionId === 'string' && o.sessionId.length > 0) slot.sessionId = o.sessionId;
			if (o.folded === true) slot.folded = true;
			out.push(slot);
		}
		return out.sort((a, b) => a.index - b.index);
	} catch {
		return [];
	}
}

/** Write the whole glass list; an empty list clears the key. Also
 *  mirrors the written list into the reactive store — the sidebar's
 *  folded-glass rows derive from it (ADR-0037 D4). */
export function persistBrowserSlots(slots: BrowserSlot[], storage: Pick<Storage, 'setItem' | 'removeItem'> | null = defaultStorage()): void {
	try {
		if (slots.length > 0) storage?.setItem(IDX_KEY, JSON.stringify(slots));
		else storage?.removeItem(IDX_KEY);
	} catch {
		/* quota — the slot memory is best-effort */
	}
	browserSlotStore.set([...slots]);
}

/** Reactive mirror of the persisted glass list (Svelte store — the
 *  plain .ts module stays rune-free). Rows and the route derive the
 *  folded set from it; persistBrowserSlots is the only writer. */
export const browserSlotStore = writable<BrowserSlot[]>([]);

/** Seed the mirror from storage (boot). */
export function primeBrowserSlotStore(storage: Pick<Storage, 'getItem'> | null = defaultStorage()): void {
	browserSlotStore.set(readBrowserSlots(storage));
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