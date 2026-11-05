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

/**
 * True when the slot list still carries an UNFOLDED, session-carrying glass
 * - the HMR re-adopt signature (2026-10-30): the floor lost its browser
 * panel without this component instance ever seeing one, yet a slot says a
 * live glass belonged on the floor. A user fold marks entries folded and a
 * trash-bin prunes them, so neither ever reads as a re-adopt candidate.
 */
export function glassReadoptCandidate(slots: readonly BrowserSlot[]): boolean {
	return slots.some((s) => !s.folded && typeof s.sessionId === 'string' && s.sessionId.length > 0);
}

/**
 * Drop the slot entry whose glass session died (The Glass Close Ladder
 * ADR 2026-10-24 D4): the live prune — a dead glass's entry is REMOVED,
 * never folded, so the roster ghost and the spine nest drop with it in
 * the same mirror stroke, no reload. Unknown id = quiet no-op (false).
 */
export function removeBrowserSlot(
	sessionId: string,
	storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> = defaultStorage()!
): boolean {
	const slots = readBrowserSlots(storage);
	const next = slots.filter((s) => s.sessionId !== sessionId);
	if (next.length === slots.length) return false;
	persistBrowserSlots(next, storage);
	return true;
}

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
	/** ADR-0045 amendment 3 D7 — this page's harness session key; sent as
	 *  ownerSessionId on open and checked on re-bind (own glass only). */
	ownerSessionId?: string | null;
	/** ADR-0046 D0 - Shift+Click intent; sent as cloneSignature on the
	 *  open POST. Never set on the re-bind GET path. */
	cloneSignature?: boolean;
}

// RCA 2026-10-30 "The Key That Cleaned Itself Away": +page.svelte strips
// sessionKey from the URL right after hydration, so a component that reads
// location.search LATER (the BrowserPanel's chip-open) sees it already gone
// and the glass is born ownerless. The page therefore CAPTURES the key at
// load — before the strip — and this module holds it as the authority. The
// capture ALSO lands in sessionStorage (per-tab by spec): the cleanup makes
// every F5 a bare-URL load, and without the tab-scoped memory a reload
// would capture null and the NEXT chip-open would still mint ownerless
// glasses (observed twice, 2026-10-30 07:44 and 07:49).
// v2 (RCA 2026-10-30): the v1 key was poisoned fleet-wide by the interim
// shared-blob fallback (16:30-16:43) — it wrote the LAST SAVER's session id
// into every tab's memory. Poison is data; versioning is the only clean
// retirement: v1 entries are never read again.
const SS_KEY = 'dsi.harness.sessionKey.v2';
let capturedKey: string | null = null;

function tabStorage(): Pick<Storage, 'getItem' | 'setItem'> | null {
	try {
		return typeof sessionStorage !== 'undefined' ? sessionStorage : null;
	} catch {
		return null;
	}
}

/** Called once at page init, BEFORE the URL cleanup, with the still-present
 *  sessionKey query param. A real key WINS over any tab memory (the tab was
 *  (re)seeded with a concrete conversation) and is remembered for reloads;
 *  null means "bare load" — fall back to the tab memory, never clear it. */
export function captureHarnessSessionKey(key: string | null): void {
	const ss = tabStorage();
	if (key !== null && key.length > 0) {
		capturedKey = key;
		try {
			ss?.setItem(SS_KEY, key);
		} catch {
			/* private mode — in-memory capture still covers this load */
		}
		return;
	}
	if (!capturedKey) {
		try {
			capturedKey = ss?.getItem(SS_KEY) ?? null;
		} catch {
			capturedKey = null;
		}
	}
}

/** Test seam — the capture is module state and persists across imports. */
export function resetHarnessSessionKeyForTests(): void {
	capturedKey = null;
}

/** The harness conversation session key — the client-side source of the D7
 *  ownership fact. Order: load-time capture → tab memory → live URL.
 *  Null when all three are absent (degraded: legacy behavior). */
export function harnessSessionKey(): string | null {
	if (capturedKey) return capturedKey;
	try {
		const ss = tabStorage();
		const stored = ss?.getItem(SS_KEY) ?? null;
		if (stored) {
			capturedKey = stored;
			return stored;
		}
	} catch {
		/* fall through to the URL */
	}
	try {
		if (typeof location === 'undefined') return null;
		const k = new URLSearchParams(location.search).get('sessionKey');
		return k !== null && k.length > 0 ? k : null;
	} catch {
		return null;
	}
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
				const body = (await res.json()) as { sessions?: { id: string; ownerSessionId?: string | null }[] };
				const hit = body.sessions?.find((s) => s.id === persisted);
				// D7: a session owned by ANOTHER conversation is not ours to
				// re-bind — treat it as dead for this page. Null owner (legacy
				// session opened before the field) keeps the old re-bind.
				const ownerOk =
					!deps.ownerSessionId ||
					!hit ||
					hit.ownerSessionId == null ||
					hit.ownerSessionId === deps.ownerSessionId;
				if (hit && ownerOk) {
					return { id: persisted, reBound: true };
				}
			}
		} catch {
			/* list unreachable — fall through to open (same as dead id) */
		}
		// the id is dead on the server — drop it before opening over it
		clearPersistedId(storage);
	}

	const res = await doFetch(apiBase + '/api/browser', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({
			...(deps.ownerSessionId ? { ownerSessionId: deps.ownerSessionId } : {}),
			...(deps.cloneSignature ? { cloneSignature: true } : {})
		})
	});
	if (!res.ok) throw new Error('open failed: ' + res.status);
	const info = (await res.json()) as { id: string };
	persistId(info.id, storage);
	return { id: info.id, reBound: false };
}
