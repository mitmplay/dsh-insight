/**
 * dsh-rpc — the single choke point for DSH wire bytes (BC-6).
 *
 * Every RPC fact below is pinned by the gateway guide
 * (dev/gateways/dsh-gateway-live-streaming.md) and the harness sources it
 * cites (packages/client/connection/src/client/rpc.ts — envelope;
 * packages/host/apiproxy/src/api/rpc-map.ts — POST /api/{method} paths;
 * api/rpc.ts — RpcResult ok/false error union; api/sessions.ts — payloads).
 *
 * Live-verified 2026-08-21: session.list and session.history round-trip,
 * events.mux open → session/subscribed baseline with lastSeq.
 */

import { dshBaseUrl } from '$lib/config';
import { readDshAuthConfig } from './insight-config';

/**
 * Wire endpoints this app calls (0.1.2-alpha.1 wire: slash paths, args
 * envelopes). The closed set grows only by spec change (BC-6). Arg names are
 * each endpoint's declared parameter name — exact-match validated by the
 * host descriptor (extra/missing keys → arguments-invalid).
 *
 * Live-verified 2026-08-29 against dsh-0.1.2-alpha.1 (cd5ef81481):
 * session/list, session/create, session/prompt, session/rename,
 * session/selectModel, session/modelCatalog, session/page, session/cancel,
 * session/attachment, agentPresets/list, workspace/create, commands/list
 * (verified on the wire, never called by DSI — no DSH_METHODS entry),
 * commands/execute, directoryPicker/pick. DSH_METHODS below is the canonical
 * set this app calls.
 *
 * Grown by spec 2026-08-30 (BC-6): the Slash Menu ADR
 * (dev/architectural-decission/2026-08-30 - The Slash Menu — The Composer
 * Reads the Host's Own Directory.md) adds commandsList + skillsList — DSI
 * becomes a reader of the host's command/skill catalogs. Both endpoints
 * live-pinned 2026-08-30 against dsh web 0.1.2 (see tests/unit/dsh-rpc.test.ts
 * — the recorded round-trip: envelope payload:{args}, skills 10 rows,
 * commands 5 rows).
 */
export const DSH_METHODS = {
	/** args `{}` — `_request` is reserved-empty (acceptsUndefined). */
	list: 'session/list',
	/** args `{request:{address,throughSeq,beforeSeq?,maxMessages?}}` → `{records,hasMore}`. */
	page: 'session/page',
	prompt: 'session/prompt',
	cancel: 'session/cancel',
	create: 'session/create',
	/**
	 * args `{request:{sessionId,atSeq?}}` → `{sessionId}` (the fork child).
	 * Host contract (harness packages/api/session-controller/src/types.ts
	 * SessionForkRequest/Value): `atSeq` omitted cuts at the source's last
	 * completed turn; a given `atSeq` anchors to the first `turn/end` at or
	 * after it — an anchor inside an open turn refuses `session/fork-unavailable`,
	 * never clips. Refusals: `session/not-found`, `session/fork-unavailable`,
	 * `session/workspace-attach-failed`. Live-pinned 2026-09-01 against
	 * dsh-0.1.2-alpha.3: the args descriptor exact-matches `{request:{sessionId}}`
	 * (a bare sessionId → gateway/arguments-invalid: missing "request") and a
	 * turn-less source refuses fork-unavailable ("has no completed turn to
	 * fork from"). The success path (child id) is pinned by the harness
	 * client fixture (connection/src/client/fixture.ts case 'session/fork').
	 */
	fork: 'session/fork',
	presets: 'agentPresets/list',
	rename: 'session/rename',
	/** args `{}` → ModelCatalog {default,routableProviders,groups,failures}. */
	modelCatalog: 'session/modelCatalog',
	selectModel: 'session/selectModel',
	workspaceCreate: 'workspace/create',
	/**
	 * args `{request:{workspaceId,title}}` → Workspace view. Refusals:
	 * `workspace/not-found`, `workspace/name-conflict` (details carry the
	 * conflicting name). A no-op title (trimmed-equal) succeeds silently and
	 * emits NO follow frame — semantics pinned against the harness client
	 * fixture (connection fixture.client.spec.ts:1187-1216). Chip Menu ADR D3.
	 */
	workspaceRename: 'workspace/rename',
	/**
	 * args `{request:{workspaceId}}` → removed workspaceId. Removes ONLY the
	 * registry row (sessions survive, ungrouped) and emits a remove frame on
	 * workspace/follow — pinned at connection fixture.client.spec.ts:1292-1303.
	 * Chip Menu ADR D3.
	 */
	workspaceDelete: 'workspace/delete',
	listDirectory: 'directoryPicker/list',
	pickDirectory: 'directoryPicker/pick',
	/**
	 * args `{agentId,line,submittedAttachments}` → CommandExecution | null
	 * (agentId = sessionId). 0.1.3-alpha.1 renamed the wire arg — the Typert
	 * descriptor binds the implementation's parameter name, and
	 * CommandRuntime.execute's third parameter became `submittedAttachments`
	 * (mixed image/file submissions); the old `images` envelope now rejects
	 * `gateway/arguments-invalid` (probed live 2026-09-05).
	 */
	commandExecute: 'commands/execute',
	/** args `{agentId}` → DshCommandRow[] name-sorted (Slash Menu ADR §2; live-pinned 2026-08-30). */
	commandsList: 'commands/list',
	/** args `{request:{sessionId}}` → DshSkillList (user-invocable only; Slash Menu ADR §2; live-pinned 2026-08-30). */
	skillsList: 'skills/list',
	attachment: 'session/attachment',
/**
 * args `{workspaceFileScopeId, path, range?}` - WorkspaceFileText
 * {offset,text,lines,eof,absolutePath,version,bytes?} (Workspace Explorer
 * W2 task 2.1). The scope wire key was `agentId` until the host's
 * 2026-09-09 session-roots fix (7214a97723, first shipped 0.1.5-alpha.2)
 * registered the `workspaceFileScope` lookup with
 * `wire: 'workspaceFileScopeId'` (packages/api/workspace-files/src/index.ts:204
 * at 0.1.5-rc.1) — sending `agentId` now rejects gateway/arguments-invalid
 * (observed live 2026-09-10). Refusals (RemoteErrorDetailsMap, types.ts):
 * workspace-file/not-found, outside-workspace, too-large, not-text,
 * not-regular-file.
 */
	workspaceFileRead: 'workspaceFiles/read',
	/**
	 * args `{workspaceFileScopeId, path, range}` → WorkspaceFileBytes —
	 * readBytes(workspaceFileScope, path, range) on the same descriptor: raw
	 * bytes (base64 on the wire),
	 * no text decoding and no binary refusal. Binary previews (images)
	 * read through this (2026-09-10): `read` refuses non-text with
	 * workspace-file/not-text. Same refusals as read.
	 */
	workspaceFileReadBytes: 'workspaceFiles/readBytes',
	workspaceFileList: 'workspaceFiles/list',
	/**
	 * Jobs (ADR-0026 D2/D3, Job Badge Wave 1): the per-session roster and the
	 * human kill — host job-controller (dsh-v0.2.1-alpha.4). job/list answers
	 * one JobListFrame (whole-set jobs replacement); job/kill is the pure
	 * RPC passthrough answering {outcome: 'requested' | 'already-finished'}.
	 * Wire names mirror the host remote namespace job (job.list / job.kill →
	 * slash form, same convention as session/list). Args use the request
	 * wrapper like skillsList; live-pinning lands with the route probe.
	 */
	// jobList: retired DSI-side (ADR 2026-10-17, The Roster Mirror) — the
	// host serves job/list stream-only; DSI consumes the stream, never a
	// unary call. Name kept for wire-map completeness only.
	jobList: 'job/list',
	jobKill: 'job/kill'
} as const;

/** Per-endpoint args-key layout: the JS parameter name on the wire (0.1.2). */
export type DshArgs = { [K in keyof typeof DSH_METHODS]: Record<string, unknown> };

/** Args builders — one per endpoint, pinned to the live-probed shapes. */
export const DSH_ARGS = {
	list: (): Record<string, unknown> => ({ _request: {} }),
	page: (request: Record<string, unknown>): Record<string, unknown> => ({ request }),
	prompt: (request: Record<string, unknown>): Record<string, unknown> => ({ request }),
	cancel: (request: Record<string, unknown>): Record<string, unknown> => ({ request }),
	create: (request: Record<string, unknown>): Record<string, unknown> => ({ request }),
	fork: (request: Record<string, unknown>): Record<string, unknown> => ({ request }),
	presets: (): Record<string, unknown> => ({}),  // agentPresets/list: no args (verified live)
	rename: (request: Record<string, unknown>): Record<string, unknown> => ({ request }),
	modelCatalog: (): Record<string, unknown> => ({}),
	selectModel: (request: Record<string, unknown>): Record<string, unknown> => ({ request }),
	workspaceCreate: (request: Record<string, unknown>): Record<string, unknown> => ({ request }),
	workspaceRename: (workspaceId: string, title: string): Record<string, unknown> => ({ request: { workspaceId, title } }),
	workspaceDelete: (workspaceId: string): Record<string, unknown> => ({ request: { workspaceId } }),
	listDirectory: (path: string | undefined): Record<string, unknown> =>
		path === undefined ? {} : { path },
	pickDirectory: (): Record<string, unknown> => ({}),
	// 0.1.3-alpha.1: the third arg is `submittedAttachments` (descriptor-bound
	// parameter name) — `images` rejects gateway/arguments-invalid.
	commandExecute: (agentId: string, line: string, submittedAttachments: readonly unknown[]): Record<string, unknown> => ({
		agentId,
		line,
		submittedAttachments
	}),
	commandsList: (agentId: string): Record<string, unknown> => ({ agentId }),
	skillsList: (sessionId: string): Record<string, unknown> => ({ request: { sessionId } }),
	attachment: (request: Record<string, unknown>): Record<string, unknown> => ({ request }),
	/** Flat args — the descriptor has NO request wrapper: scope wire
	 *  workspaceFileScopeId (2026-09-09 rename, was agentId), json path/range. */
	workspaceFileRead: (
		sessionId: string,
		path: string,
		range?: { offset?: number; limit?: number }
	): Record<string, unknown> =>
		// The descriptor's args match EXACTLY — an absent `range` key is
		// rejected `gateway/arguments-invalid` (live evidence 2026-09-09,
		// route-relayed). `{}` = the host's page defaults.
		({ workspaceFileScopeId: sessionId, path, range: range ?? {} }),
	/** Flat args like the read — the descriptor scopes workspaceFileScopeId on the wire. */
	workspaceFileList: (sessionId: string, path: string): Record<string, unknown> => ({
		workspaceFileScopeId: sessionId,
		path
	}),
	/** Flat args like the read — WorkspaceByteRange {offset, length}, 0-based
	 *  bytes; {} = the host's window defaults. */
	workspaceFileReadBytes: (
		sessionId: string,
		path: string,
		range?: { offset?: number; length?: number }
	): Record<string, unknown> => ({ workspaceFileScopeId: sessionId, path, range: range ?? {} }),
	/** Jobs (Job Badge Wave 1): request-wrapped like skillsList —
	 *  job/list {request:{sessionId}}, job/kill {request:{sessionId, jobId}}. */
	jobList: (sessionId: string): Record<string, unknown> => ({ request: { sessionId } }),
	jobKill: (sessionId: string, jobId: string): Record<string, unknown> => ({
		request: { sessionId, jobId }
	})
} as const;

/**
 * commands/execute receipt value (packages/interaction/commands types):
 * {commandId, result: {kind:'success', text?} | {kind:'error', text}}.
 * An admission miss (malformed line / unknown command name) answers
 * ok:true with NO value — represented as null (the command never ran).
 */
export interface DshCommandReceipt {
	commandId: string;
	result: { kind: 'success'; text?: string } | { kind: 'error'; text?: string };
}

/**
 * commands/list row (Slash Menu ADR §2; live-pinned 2026-08-30 — 5 rows on
 * the app-dev preset: compact, export, feedback, permission, plan).
 * `input` marks a command that takes arguments: `hint` renders in the menu,
 * `images` true = the command accepts image attachments. Host answer is
 * name-sorted; DSI renders host order verbatim (never re-sorts).
 */
export interface DshCommandRow {
	name: string;
	description: string;
	input?: { hint: string; images?: boolean };
}

/**
 * skills/list row (Slash Menu ADR §2; live-pinned 2026-08-30 — 10 rows on
 * the app-dev preset). `whenToUse` is optional on the wire (absent on every
 * live row); `modelInvocable` false = operator-invocable only — the menu
 * still lists it (the user-invocable filter is host-side).
 */
export interface DshSkillRow {
	name: string;
	description: string;
	whenToUse?: string;
	modelInvocable: boolean;
}

/** skills/list receipt value: the user-invocable skill catalog. */
export interface DshSkillList {
	skills: DshSkillRow[];
}

/**
 * workspaceFiles/read receipt value (Workspace Explorer W2 task 2.1) —
 * one page of a workspace text file, mirrored verbatim from the host's
 * WorkspaceFileText (packages/api/workspace-files/src/types.ts). Lines are
 * 1-based, end at a terminator; text is page content without the trailing
 * terminator; bytes rides when the backend reports the file size.
 */
export interface DshWorkspaceFileText {
	/** First line of the page, as requested. */
	offset: number;
	/** The page's lines joined by a terminator, without one after the last. */
	text: string;
	/** How many lines the page holds; 0 when offset lies past the file's last line. */
	lines: number;
	/** Whether the page includes the file's last line. */
	eof: boolean;
	/** Absolute path in the host's execution world, symlinks resolved. */
	absolutePath: string;
	/** Opaque freshness token at the read; never parsed. */
	version: string;
	/** Complete file's byte size, when the backend reports it. */
	bytes?: number;
}

/**
 * workspaceFiles/readBytes receipt value (2026-09-10 image previews) — one
 * byte window of a workspace file, mirrored from the host's
 * WorkspaceFileBytes (packages/api/workspace-files/src/types.ts): the
 * window's bytes base64-encoded, no text decoding, no binary refusal.
 */
export interface DshWorkspaceFileBytes {
	/** First byte of the window, as requested. */
	offset: number;
	/** The window's bytes in base64; empty at/past the file's end. */
	data: string;
	/** Whether the window includes the file's last byte. */
	eof: boolean;
	/** Absolute path in the host's execution world, symlinks resolved. */
	absolutePath: string;
	/** Opaque freshness token at the read; never parsed. */
	version: string;
	/** Complete file's byte size, when the backend reports it. */
	bytes?: number;
}

/**
 * workspaceFiles/list receipt value (Workspace Explorer bugfix 2026-09-09)
 * — one directory level inside the session's workspace, mirrored verbatim
 * from the host's WorkspaceDirectoryListing (workspace-files types.ts).
 * `path` is WORKSPACE-RELATIVE and empty for the root itself; a child's
 * path is this value joined with the entry name by "/". `type` is the
 * host's containment-checked truth — DSI renders it, never guesses.
 */
export interface DshWorkspaceDirectoryListing {
	/** The listed directory as a workspace path ('' = the root). */
	path: string;
	entries: ReadonlyArray<{
		/** Basename inside the listed directory. */
		name: string;
		/** The child's resolved type; `read` still refuses a symlink. */
		type: 'file' | 'directory' | 'other';
		/** Byte size, regular files only, when the backend reports it. */
		size?: number;
	}>;
	/** Whether the entry cap dropped children. */
	truncated: boolean;
}

/**
 * The ONE stream carrier (0.1.2): `/api/remote.mux` WebSocket multiplexing
 * logical streams — `{type:'open',streamId,endpoint,payload}` opens one,
 * `{type:'item'|'end'|'error',streamId,…}` frames carry it (stream-protocol.ts).
 * Cookie-authenticated like every /api surface. The old events.mux/events.host
 * pair is gone (404).
 */
export const DSH_REMOTE_MUX_WS_PATH = '/api/remote.mux';

/** Forwarded-event logical stream endpoint ($events — approvals/questions ride it). */
export const REMOTE_EVENT_STREAM_ENDPOINT = '$events';
/** Empty standard payload that opens the $events stream (stream-protocol.ts). */
export const REMOTE_EVENT_STREAM_PAYLOAD = { args: {} } as const;
/** Waterfall-result unary endpoint answering a forwarded event ($events/result). */
export const REMOTE_EVENT_RESULT_ENDPOINT = '$events/result';

/** Error carrying the DSH RpcError (ok:false result). */
export class DshRpcError extends Error {
	readonly code: string;
	readonly details: unknown;

	constructor(code: string, message: string, details?: unknown) {
		super(`DSH RPC ${code}: ${message}`);
		this.name = 'DshRpcError';
		this.code = code;
		this.details = details;
	}
}

/**
 * api-dsh error mapping (Module Map: dsh-rpc owns error mapping; routes stay DRY
 * with no cross-route imports). DshRpcError → 502 with the host's code; anything
 * else (transport down) → 503 host-unreachable.
 */
export function statusFor(err: unknown): number {
	return err instanceof DshRpcError ? 502 : 503;
}

/**
 * Host codes for the subagent-ownership family (session-controller
 * validateAddress + apiSessionSubagentOwnershipError): the request reached the
 * host and was REJECTED by session policy — the host is fine, the address form
 * or ownership is the problem. Never surfaces as "cannot reach the host".
 * 0.1.2-alpha.2+ wire vocabulary: `<domain>/<reason>` codes (the 2026-08-28
 * RemoteError note in the harness repo renamed them wholesale).
 */
export const SUBAGENT_REJECTION_CODES: ReadonlySet<string> = new Set([
	'session/agent-busy',
	'subagent/unauthorized',
	'subagent/not-found',
	'subagent/catalog-diagnostic'
]);

/** True when the error is a host subagent-ownership rejection (see the code set). */
export function isSubagentRejection(err: unknown): err is DshRpcError {
	return err instanceof DshRpcError && SUBAGENT_REJECTION_CODES.has(err.code);
}

/** Error body for api-dsh routes: machine code + user-facing message.
 *  DshRpcError details ride along when the host sent them — the native
 *  picker fallback branches on details.capability. */
export function mapRpcFailure(err: unknown): {
	ok: false;
	error: { code: string; message: string; details?: unknown };
} {
	if (err instanceof DshRpcError) {
		return {
			ok: false,
			error: {
				code: err.code,
				message: err.message,
				...(err.details !== undefined ? { details: err.details } : {})
			}
		};
	}
	return {
		ok: false,
		error: { code: 'host-unreachable', message: err instanceof Error ? err.message : String(err) }
	};
}

/** Client→server request envelope (rpc.ts ClientRequest). */
export interface ClientRequestEnvelope {
	type: 'client-request';
	rpcId: string;
	method: string;
	payload: Record<string, unknown>;
}

/** Server→client response envelope (rpc.ts ServerResponse). */
export interface ServerResponseEnvelope {
	type: 'server-response';
	rpcId: string;
	result: { ok: true; value: unknown } | { ok: false; error: { code: string; message: string; details?: unknown } };
}

/** Server→client push envelope (rpc.ts ServerRequest — mux/host frames ride this). */
export interface ServerRequestEnvelope {
	type: 'server-request';
	rpcId: string;
	method: string;
	payload: unknown;
}

/**
 * POC-3 W1 — client→server RESPONSE envelope (rpc.ts ClientResponse).
 *
 * Answers to approval/question requested frames ride a DEDICATED CARRIER,
 * not a unary method: POST /api/respond with result = a full RpcResult
 * {ok:true, value: payload} (rpc.schema.ts clientResponseSchema — result is
 * rpcResultSchema, NOT a bare value slot; live-pinned 2026-08-21: a bare
 * {value} body is rejected bad-response). approvals.ts: "respond is a
 * client-response, so it is absent from RpcMethodMap". Hence no
 * DSH_METHODS entry — the closed set grows only by spec change (BC-6).
 */
export interface ClientResponseEnvelope {
	type: 'client-response';
	rpcId: string;
	result: { ok: true; value: unknown };
}

/**
 * POC-3 W1 — receipt for a respond POST (rpc.ts RpcReceipt).
 *
 * NOT an RpcResult: a refused answer is still a successful exchange —
 * {accepted:false, reason:'not-pending'} means another claimant won the
 * race (first-claimant-wins, api-proxy claimQuestion); 'bad-response' means
 * the payload failed validation against the pending request. BC-B: the
 * carrier maps this to HTTP 200 {ok:true, accepted:false, reason} — the
 * card settles "answered elsewhere", never errors.
 */
export type RespondReceipt =
	| { accepted: true }
	| { accepted: false; reason: 'not-pending' | 'bad-response' | string };

/** Build the respond endpoint URL: POST {base}/api/respond (fetch/handler.ts:296). */
export function respondUrl(base: string | undefined): string {
	const b = (base ?? dshBaseUrl()).replace(/\/+$/, '');
	return `${b}/api/respond`;
}

/** Encode a client-response envelope (the answer body for /api/respond).
 * Wire truth (live-pinned 2026-08-21 against rc.8): result is a FULL RpcResult
 * — {ok:true, value: payload} — per rpc.schema.ts clientResponseSchema
 * (result = rpcResultSchema, not a bare value slot). A bare {value} is
 * rejected by the host schema as bad-response.
 */
export function encodeRespond(rpcId: string, payload: Record<string, unknown>): string {
	return JSON.stringify({ type: 'client-response', rpcId, result: { ok: true, value: payload } });
}

/**
 * Parse a respond receipt (RpcReceipt union — NOT an RpcResult envelope).
 * Throws on non-JSON / wrong shape; returns {accepted, reason?} verbatim.
 */
export function parseRespondReceipt(raw: string): RespondReceipt {
	let parsed: { accepted?: unknown; reason?: unknown };
	try {
		parsed = JSON.parse(raw) as { accepted?: unknown; reason?: unknown };
	} catch (cause) {
		throw new Error(`dsh-rpc: respond receipt is not JSON: ${String(cause)}`);
	}
	if (parsed === null || typeof parsed !== 'object' || typeof parsed.accepted !== 'boolean') {
		throw new Error(`dsh-rpc: respond receipt is not an RpcReceipt: ${raw.slice(0, 120)}`);
	}
	if (parsed.accepted) return { accepted: true };
	return { accepted: false, reason: typeof parsed.reason === 'string' ? parsed.reason : 'unknown' };
}

/** Raw event entry from session.history (HistoryEntry: raw event + optional view). */
export interface DshHistoryEntry {
	event: {
		type: string;
		seq: number;
		time: number;
		data?: Record<string, unknown>;
	};
	view?: unknown;
}

/** Prompt content part (sessions.ts PromptContentPart — text and image in v1). */
export type DshPromptContent =
	| { type: 'text'; text: string }
	| { type: 'image'; mediaType: string; data: string; name?: string };

/**
 * Wave 3 (task 3.2) — session.attachment receipt value, mirrored from the
 * host schema (imageAttachmentRefSchema + data). The ref is a durable
 * POINTER; data is canonical base64. Session-authorized by the host: only
 * a session's own client may read its attachments.
 */
export interface DshAttachmentValue {
	attachment: {
		attachmentId: string;
		mediaType: string;
		bytes: number;
		width: number;
		height: number;
		name?: string;
	};
	data: string;
}

/**
 * Wave 2 (task 2.1) — the typed prompt-image surface. Raster media types
 * the version-one wire accepts, pinned to the host schema
 * (imageMediaTypeSchema); the server lane owns its own whitelist — client
 * admission (attachment-service) is a different trust boundary and is
 * never imported here.
 */
export const PROMPT_IMAGE_MEDIA_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const;

/** Narrow media-type union carried by typed prompt image parts. */
export type PromptImageMediaType = (typeof PROMPT_IMAGE_MEDIA_TYPES)[number];

/** A validated prompt image part (media type narrowed, base64 data, optional name). */
export interface PromptImagePart {
	type: 'image';
	mediaType: PromptImageMediaType;
	data: string;
	name?: string;
}

/** Type guard for the wire's raster whitelist (route validation entry). */
export function isPromptImageMediaType(value: string): value is PromptImageMediaType {
	return (PROMPT_IMAGE_MEDIA_TYPES as readonly string[]).includes(value);
}

/**
 * Build ordered session.prompt content — images first, text last (the
 * host composer's own order); the text part is omitted when empty, so an
 * attachments-only send is exactly the image parts (DSH sendSession: the
 * text part appears only for non-empty text).
 *
 * @param text - prompt text, sent verbatim as one text block when non-empty.
 * @param images - validated image parts, in draft order.
 * @returns the content array for the session.prompt payload.
 */
export function buildPromptContent(text: string, images: readonly PromptImagePart[]): DshPromptContent[] {
	return [...images, ...(text === '' ? [] : [{ type: 'text' as const, text }])];
}

/**
 * Encode a client-request envelope.
 * rpcId: caller-supplied correlation id (UUID); response must echo it.
 */
export function encodeRequest(rpcId: string, method: string, payload: Record<string, unknown>): string {
	return JSON.stringify({ type: 'client-request', rpcId, method, payload });
}

/**
 * Parse + validate a server-response envelope against the expected rpcId.
 * Throws: DshRpcError when the result is ok:false; Error on envelope/rpcId mismatch.
 */
export function parseResponse(raw: string, expectedRpcId: string): unknown {
	let parsed: ServerResponseEnvelope;
	try {
		parsed = JSON.parse(raw) as ServerResponseEnvelope;
	} catch (cause) {
		throw new Error(`dsh-rpc: response is not JSON: ${String(cause)}`);
	}
	if (parsed?.type !== 'server-response') {
		throw new Error(`dsh-rpc: expected server-response, got ${JSON.stringify(parsed?.type)}`);
	}
	if (parsed.rpcId !== expectedRpcId) {
		throw new Error(`dsh-rpc: rpcId mismatch — sent ${expectedRpcId}, got ${parsed.rpcId}`);
	}
	const result = parsed.result;
	if (!result || typeof result !== 'object' || !('ok' in result)) {
		throw new Error('dsh-rpc: response result is not an RpcResult');
	}
	if (result.ok) {
		return (result as { ok: true; value: unknown }).value;
	}
	const err = (result as { ok: false; error: { code: string; message: string; details?: unknown } }).error;
	throw new DshRpcError(err.code, err.message, err.details);
}

/**
 * Parse a server-request push envelope (mux/host frames). Returns the frame payload.
 */
export function parseServerRequest(raw: string): { rpcId: string; method: string; payload: unknown } {
	let parsed: ServerRequestEnvelope;
	try {
		parsed = JSON.parse(raw) as ServerRequestEnvelope;
	} catch (cause) {
	 throw new Error(`dsh-rpc: server-request is not JSON: ${String(cause)}`);
	}
	if (parsed?.type !== 'server-request') {
		throw new Error(`dsh-rpc: expected server-request, got ${JSON.stringify(parsed?.type)}`);
	}
	return { rpcId: parsed.rpcId, method: parsed.method, payload: parsed.payload };
}

/** Build the RPC endpoint URL: POST {base}/api/{method} (rpc-map.ts key = wire path). */
export function rpcUrl(base: string | undefined, method: string): string {
	const b = (base ?? dshBaseUrl()).replace(/\/+$/, '');
	return `${b}/api/${method}`;
}


// ── 0.1.2 browser-session auth (cookie carrier) ─────────────────────────────

/** Result of one launch-token exchange (cookie-mint GET /). */
export interface AuthExchangeResult {
	/** Cookie `name=value` pair for request headers / WS handshakes; null = mint failed. */
	cookie: string | null;
}

/** Injectable surface DshAuth uses; tests pass fakes. */
export interface DshAuthOptions {
	baseUrl?: string;
	fetchFn?: typeof fetch;
	log?: (...args: unknown[]) => void;
}

/**
 * DshAuth — the 0.1.2 cookie carrier (server-side singleton state).
 *
 * The upgraded host requires a signed session cookie (30d, HttpOnly,
 * SameSite=Strict, authority-bound) on every /api call and stream; the cookie
 * is minted by ONE GET / with the launch token (the `?token=*** URL `dsh web`
 * prints). The token is per-process; the minted cookie survives host
 * restarts, so the exchange runs once and again only on a 401 (fresh host
 * process). Single-flight: concurrent 401s share one mint.
 */
export class DshAuth {
	private cookie: string | null = null;
	private minting: Promise<string | null> | undefined;
	private readonly baseUrl: string;
	private readonly fetchFn: typeof fetch;
	private readonly log: (...args: unknown[]) => void;

	constructor(opts: DshAuthOptions = {}) {
		this.baseUrl = opts.baseUrl ?? dshBaseUrl();
		this.fetchFn = opts.fetchFn ?? fetch;
		this.log = opts.log ?? (() => {});
	}

	/** Current cookie pair, or null before the first successful mint. */
	current(): string | null {
		return this.cookie;
	}

	/**
	 * Ensure a cookie exists: reuse the minted one, else exchange the operator
	 * token from readDshAuthConfig. No token configured → null (hosts without
	 * the 0.1.2 fence never send 401 and never reach here).
	 */
	async ensureCookie(): Promise<string | null> {
		if (this.cookie !== null) return this.cookie;
		this.minting ??= this.mint();
		try {
			return await this.minting;
		} finally {
			this.minting = undefined;
		}
	}

	/** Forget the cookie (next call re-mints — a 401 means a new host process). */
	invalidate(): void {
		this.cookie = null;
	}

	/** Cookie header value for fetch/WS calls; undefined before any mint. */
	cookieHeader(): string | undefined {
		return this.cookie ?? undefined;
	}

	private async mint(): Promise<string | null> {
		const { authToken } = readDshAuthConfig();
		if (authToken === null) {
			this.log('dsh-auth: no token configured — calling the host unauthenticated');
			return null;
		}
		const url = new URL(this.baseUrl);
		url.pathname = '/';
		url.search = '';
		const exchange = `${url.origin}${url.pathname}?token=${encodeURIComponent(authToken)}`;
		try {
			const response = await this.fetchFn(exchange, { redirect: 'manual' });
			const setCookie = response.headers.get('set-cookie');
			if (response.status === 303 && setCookie !== null) {
				this.cookie = setCookie.split(';')[0] ?? null;
				this.log('dsh-auth: cookie minted');
				return this.cookie;
			}
			this.log(`dsh-auth: exchange failed (HTTP ${String(response.status)}) — stale token?`);
			return null;
		} catch (err) {
			this.log('dsh-auth: exchange transport failure', err);
			return null;
		}
	}
}