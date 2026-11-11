/**
 * connection/normalize — pure normalizers + stream helpers (ADR-0022 W1,
 * ADR-0019 move-whole): session-row/model-directory/preset normalizers,
 * follow/page record expansion, stream-id helper. No state, no I/O.
 */
import type { DshSessionEvent } from '$lib/server/dsh-connection';
import type { DsiModelSelection, DsiModelGroup, DsiModelDirectory } from '$lib/types';

/** Wire event form (SessionWireEvent as received over follow/page records). */
export type DshSessionEventLike = {
type: string;
seq?: number;
time?: number;
data?: Record<string, unknown>;
};

/** The follow-<sessionId>-<streamSeq> logical stream id (one per generation). */
export function followStreamId(sessionId: string, streamSeq: number): string {
	return `follow-${sessionId}-${String(streamSeq)}`;
}

/**
 * Expand ONE follow/page event payload into its ring-buffer form
 * (single-element list — ledger v2 serves every record as a plain event).
 */
export function expandEntry(e: DshSessionEventLike): DshSessionEvent[] {
	return [
		{
			type: e.type,
			seq: typeof e.seq === 'number' ? e.seq : -1,
			time: typeof e.time === 'number' ? e.time : 0,
			data: e.data
		}
	];
}

/** Expand one page/snapshot record ({type:'event', event}) into its member
 *  events; a record without an event payload contributes nothing. */
export function expandRecord(record: { type?: string; event?: DshSessionEventLike } | undefined): DshSessionEvent[] {
	if (record === undefined || record.event === undefined) return [];
	return expandEntry(record.event);
}

/** Expand a records array into a flat event list. */
export function expandRecords(records: Array<{ type?: string; event?: DshSessionEventLike }>): DshSessionEvent[] {
	return records.flatMap((record) => expandRecord(record));
}

/** The last member time of one compact stream record, or undefined when
 *  the record carries no readable time (malformed members stay silent —
 *  the baseline is presentation seed data, never re-validated truth). */
export function compactRecordTailTime(record: Record<string, unknown>): number | undefined {
	if (record.type === 'chunk') {
		return typeof record.time === 'number' ? record.time : undefined;
	}
	if (record.type === 'text-chunks' || record.type === 'reasoning-chunks' || record.type === 'tool-call-chunks') {
		const time0 = typeof record.time0 === 'number' ? record.time0 : undefined;
		const dt = Array.isArray(record.dt) ? record.dt : [];
		if (time0 === undefined || dt.some((g) => typeof g !== 'number')) return undefined;
		return dt.reduce((t, g) => t + (g as number), time0);
	}
	return undefined;
}

/** session.rename receipt value: {title (normalized), seq (title event)}. */
export interface RenameResult {
	title: string;
	seq: number;
}

export function normalizeModelSelection(v: unknown): DsiModelSelection | null {
	if (v === null || typeof v !== 'object') return null;
	const sel = v as { provider?: unknown; model?: unknown; reasoningEffort?: unknown };
	if (typeof sel.provider !== 'string' || typeof sel.model !== 'string') return null;
	return {
		provider: sel.provider,
		model: sel.model,
		...(typeof sel.reasoningEffort === 'string' ? { reasoningEffort: sel.reasoningEffort } : {})
	};
}

/**
 * Conservative normalize of a SessionModels value: structural reads only,
 * never throws, never invents data (task 3.2-T: a garbage catalog → empty
 * groups + empty failures, honest `routable`/`current` — the selector can
 * still show the current selection and say nothing is listed). Reasoning
 * efforts are flattened to opaque ids (the adapter owns their meaning).
 */
export function normalizeModelDirectory(raw: unknown): DsiModelDirectory {
	const empty: DsiModelDirectory = { current: null, routable: false, groups: [], failures: [] };
	if (raw === null || typeof raw !== 'object') return empty;
	const dir = raw as {
		current?: unknown;
		default?: unknown;
		routable?: unknown;
		routableProviders?: unknown;
		groups?: unknown;
		failures?: unknown;
	};
	const groups = Array.isArray(dir.groups) ? modelGroupsOf(dir.groups) : [];
	const failures = Array.isArray(dir.failures) ? modelFailuresOf(dir.failures) : [];
	// 0.1.2 ModelCatalog: `default` replaces the per-session current and
	// routableProviders lists routable provider ids (empty + groups = routable).
	if (dir.current === undefined && dir.default !== undefined) {
		return {
			current: normalizeModelSelection(dir.default),
			routable: Array.isArray(dir.routableProviders)
				? dir.routableProviders.length > 0 || groups.length > 0
				: true,
			groups,
			failures
		};
	}
	return {
		current: normalizeModelSelection(dir.current),
		routable: dir.routable === true,
		groups,
		failures
	};
}

/** ModelCatalog provider groups → DsiModelGroup rows (conservative). */
function modelGroupsOf(groups: unknown[]): DsiModelGroup[] {
	return groups.flatMap((g) => {
		if (g === null || typeof g !== 'object') return [];
		const grp = g as { id?: unknown; name?: unknown; models?: unknown };
		if (typeof grp.id !== 'string' || grp.id.length === 0) return [];
		const models = Array.isArray(grp.models)
			? grp.models.flatMap((m) => {
				if (m === null || typeof m !== 'object') return [];
				const mod = m as {
					id?: unknown;
					name?: unknown;
					reasoning?: { efforts?: Array<{ id?: unknown }> } | null;
				};
				if (typeof mod.id !== 'string' || mod.id.length === 0) return [];
				return [
					{
						id: mod.id,
						name: typeof mod.name === 'string' ? mod.name : null,
						...(Array.isArray(mod.reasoning?.efforts)
							? {
									reasoningEfforts: mod.reasoning.efforts.flatMap((e) =>
										typeof e?.id === 'string' ? [e.id] : []
									)
								}
							: {})
					}
				];
			})
			: [];
		return [{ id: grp.id, name: typeof grp.name === 'string' ? grp.name : null, models }];
	});
}

/** ModelCatalog provider failures → diagnostic rows (conservative). */
function modelFailuresOf(failures: unknown[]): DsiModelDirectory['failures'] {
	return failures.flatMap((f) => {
		if (f === null || typeof f !== 'object') return [];
		const fail = f as { id?: unknown; name?: unknown; message?: unknown };
		if (typeof fail.id !== 'string' || fail.id.length === 0) return [];
		return [
			{
				id: fail.id,
				name: typeof fail.name === 'string' ? fail.name : null,
				message: typeof fail.message === 'string' ? fail.message : null
			}
		];
	});
}

export interface RawSessionRow {
	sessionId: string;
	updatedAt?: number;
	running?: boolean;
	blank?: boolean;
	cwd?: string;
	agentPreset?: string;
	parentSessionId?: string;
	/** Coarse durable origin (DSH session.list passthrough) — 'subagent'
	 *  marks spawned sessions; 'scheduled' marks scheduler-born ones
	 *  (ADR-0057 D1); absent on user-created ones. */
	origin?: 'subagent' | 'scheduled';
	/** Host stats block on the session.list projection (2026-08-25 a2a
	 *  watermark — Watcher ADR §2); absent on hosts/rows without stats. */
	sessionStats?: { turns?: unknown };
	projections?: {
		asOfSeq?: number;
		values?: Record<string, unknown>;
	};
}

export type ListResult = { items: ReturnType<typeof normalizeSessionRow>[] };

export function normalizeSessionRow(row: RawSessionRow): DsiSessionSummaryPlus {
	return {
		sessionId: row.sessionId,
		// Subagent rows lead with the delegation's descriptor label ("Find
		// DSH /api/respond handler"), not the generic prompt-derived session
		// title — the label is how a spawned session is findable in a long list.
		title:
			row.origin === 'subagent'
				? (readSubagentLabel(row) ?? readTitle(row))
				: readTitle(row),
		// 0.1.2: agentPreset lives in projections.values (list rows carry no
		// top-level field) — readTitle's pattern, extended.
		agentPreset: readAgentPreset(row) ?? row.agentPreset ?? null,
		running: Boolean(row.running),
		blank: Boolean(row.blank),
		updatedAt: row.updatedAt ?? 0,
		workspace: typeof row.cwd === 'string' && row.cwd.length > 0 ? row.cwd : null,
		turns: readTurns(row),
		// Lineage passthrough (2026-08-27 lineage sidebar, task 1.3): the
		// host stamps every spawned session; absent → null (never undefined,
		// never a guess). Fork lineage (parentSessionId without origin
		// 'subagent') passes through untouched — consumers discriminate.
		parentSessionId: row.parentSessionId ?? null,
		origin: row.origin ?? null
	};
}

export interface DsiSessionSummaryPlus {
	sessionId: string;
	title: string | null;
	agentPreset: string | null;
	running: boolean;
	blank: boolean;
	updatedAt: number;
	/** Session workspace — the host row's cwd (full path); null when absent. */
	workspace: string | null;
	/** a2a watermark (2026-08-25): completed-turn count, absent-tolerant. */
	turns: number | null;
	/** Spawner session id (fork/spawn lineage passthrough); null for roots. */
	parentSessionId: string | null;
	/** 'subagent' when the harness spawned this session, 'scheduled'
	 *  when the scheduler opened it (ADR-0057 D1); null for user-made. */
	origin: 'subagent' | 'scheduled' | null;
}

function readTitle(row: RawSessionRow): string | null {
	const title = row.projections?.values?.['title'];
	return typeof title === 'string' && title.length > 0 ? title : null;
}

/** projections.values.subagent.label (the child descriptor's creation label;
 *  one-shot children may omit it — structural read, null when unreadable). */
function readSubagentLabel(row: RawSessionRow): string | null {
	const identity = row.projections?.values?.['subagent'];
	const label =
		identity !== null && typeof identity === 'object'
			? (identity as { label?: unknown }).label
			: undefined;
	return typeof label === 'string' && label.length > 0 ? label : null;
}

/** projections.values.agentPreset (0.1.2 home of the preset id on list rows). */
function readAgentPreset(row: RawSessionRow): string | null {
	const preset = row.projections?.values?.['agentPreset'];
	return typeof preset === 'string' && preset.length > 0 ? preset : null;
}

/** `sessionStats.turns` (0.1.2: projections.values.sessionStats) — integer-strict, null on absent/junk. */
function readTurns(row: RawSessionRow): number | null {
	const stats = row.projections?.values?.['sessionStats'];
	const turns = (stats !== null && typeof stats === 'object' ? (stats as { turns?: unknown }).turns : row.sessionStats?.turns);
	if (typeof turns !== 'number' || !Number.isInteger(turns) || turns < 0) return null;
	return turns;
}

// ── POC-2 W3 — agentPreset.list normalization ─────────────────────────

/** A picker-facing preset row (agentPreset.list value → DsiPreset). */
export interface DshPreset {
	id: string;
	name: string | null;
	description: string | null;
	isDefault: boolean;
}

/** agentPreset.list raw row (live-probed 2026-08-21, PRD §1.2). */
export interface RawPresetRow {
	id?: unknown;
	name?: unknown;
	description?: unknown;
	trust?: unknown;
	isDefault?: unknown;
}

/**
 * English display copy for the host's SHIPPED presets, keyed by the stable
 * preset id. The wire's `name`/`description` are the UNLOCALIZED metadata a
 * preset publishes (DSH `PresetDisplaySource`), and the four built-ins ship
 * Simplified Chinese there — DSH localizes them only inside its own web UI
 * (`packages/preset/agent-presets/src/display.ts` folds trust:'system' + id →
 * locale dictionary keys). This app has no host locale seat, so the overlay
 * mirrors that fold in English: trust:'system' + a known id → the English
 * copy; every other row (user presets, unknown future ids) keeps the host's
 * name verbatim — user metadata is never translated, and an unknown id falls
 * back honestly. Operator-tunable off via ~/.dsi/settings.yaml
 * `dsh.presetEnglish: false` (readDshPresetEnglishConfig — no cache, so the
 * next listPresets fetch picks an edit up). Keep the strings in step with DSH
 * `packages/client/ui-agent-preset/src/client/locales.ts` (the `en` bundle).
 */
const SHIPPED_PRESET_ENGLISH: Readonly<Record<string, { readonly name: string; readonly description: string }>> = {
	standard: {
		name: 'Standard mode',
		description:
			'Full coding agent with file editing, shell, file and web search, skills, planning, goals, subagents, and workflows.'
	},
	ptc: {
		name: 'PTC mode',
		description:
			'Full coding agent without the workflow tool; other tools are exposed through the PTC mode SDK so the model can combine multi-step operations in one TypeScript program.'
	},
	minimal: {
		name: 'Minimal mode',
		description: 'Two-tool coding agent with persistent bash and str_replace_editor.'
	},
	cordis: {
		name: 'Creator mode',
		description:
			'Built for creating custom agent presets, with all Standard mode capabilities plus runtime inspection, plugin experiments, and preset-authoring guidance.'
	}
};

/**
 * Conservative normalize: unknown shapes keep their id but never invent data.
 * The one English overlay seat (SHIPPED_PRESET_ENGLISH) applies before the
 * host fallbacks — a shipped preset's label is locale-resolved here, never
 * the wire's unlocalized text. Operator-tunable via
 * ~/.dsi/settings.yaml `dsh.presetEnglish` (read live per listPresets
 * call, passed through here): false hands the wire name through untouched.
 */
export function normalizePreset(row: RawPresetRow, overlayEnglish = true): DshPreset {
	const id = typeof row.id === 'string' ? row.id : String(row.id ?? '');
	const shipped = overlayEnglish && row.trust === 'system' ? SHIPPED_PRESET_ENGLISH[id] : undefined;
	return {
		id,
		name: shipped?.name ?? (typeof row.name === 'string' ? row.name : null),
		description: shipped?.description ?? (typeof row.description === 'string' ? row.description : null),
		isDefault: row.isDefault === true
	};
}
