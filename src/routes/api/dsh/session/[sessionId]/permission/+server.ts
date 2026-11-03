/**
 * api-dsh — POST /api/dsh/session/[sessionId]/permission (ADR-0007 R5; fixed 2026-08-25)
 *
 * Body {line} → the line executed VERBATIM through commands/execute — the
 * NATIVE slash-command surface the host's own web GUI uses (Typert Gateway
 * remote). session.prompt has NO slash interception (verified live, 2026-08-25
 * RCA: a /permission line sent through it is admitted as a chat prompt and
 * reaches the model); this route no longer touches it.
 *
 * Receipts are honest:
 *   - success  → {ok, accepted, commandId, text?} — knob events WILL land in
 *     the ledger (command/run + permission/preset + sandbox/mode +
 *     approval/policy + command/done); the chip's poll fold confirms.
 *   - command reported an error (unknown preset, blocked by open terminals…)
 *     → 200 {ok:false, code:'command-error', message} — the pick never landed.
 *   - admission miss (no registered command) → 200 {ok:false, code:'command-miss'}.
 *
 * The slash-line syntax lives HERE, never in a component: the chip calls
 * `onpermission('read-only')`, the composer forwards the user's line — the
 * panel builds neither command string beyond this route's contract.
 */

import { json } from '@sveltejs/kit';
import { getDshConnection } from '$lib/server/dsh-connection';
import { mapRpcFailure, statusFor } from '$lib/server/dsh-rpc';
import { permissionFromProjection } from '$lib/services/conversation/permission-state';

import type { RequestHandler } from './$types';

/** GET — the session's RESOLVED access mode (the chord n-verb's read side,
 *  2026-10-31): the same fold the cold page performs — history-tail
 *  projections, overridden by the live projection baseline when subscribe
 *  delivers one. { ok, permission: DsiPermission | null } — null when the
 *  session carries no permission projection at all (the caller then skips
 *  the inheritance; there is nothing truthful to copy). */
export const GET: RequestHandler = async ({ params }) => {
	const sessionId = params.sessionId;
	try {
		const conn = getDshConnection();
		conn.ensureDownlinks();
		conn.subscribe(sessionId);
		const historyPage = await conn.history(sessionId);
		const tail = historyPage.projections?.values ?? {};
		const live = await conn.waitForProjections(sessionId).catch(() => null);
		const values = live?.values ?? tail;
		return json({ ok: true, permission: permissionFromProjection(values['permissions']) ?? null });
	} catch (err) {
		return json(mapRpcFailure(err), { status: statusFor(err) });
	}
};

export const POST: RequestHandler = async ({ params, request }) => {
	const sessionId = params.sessionId;

	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return json(
			{ ok: false, error: { code: 'bad-json', message: 'request body is not valid JSON' } },
			{ status: 400 }
		);
	}

	const line = (body as { line?: unknown } | null)?.line;
	if (typeof line !== 'string' || line.trim().length === 0) {
		return json(
			{ ok: false, error: { code: 'empty-line', message: 'line must be a non-empty string' } },
			{ status: 400 }
		);
	}
	// The route owns the command vocabulary it will execute: only the
	// permission command — the exact token, or the token + whitespace.
	// (/permissionx is a different command and does not pass.)
	const normalized = line.trim();
	if (normalized !== '/permission' && !normalized.startsWith('/permission ')) {
		return json(
			{ ok: false, error: { code: 'bad-command', message: 'this route executes only /permission lines' } },
			{ status: 400 }
		);
	}

	try {
		const receipt = await getDshConnection().executeCommand(sessionId, line);
		if (receipt === null) {
			return json({
				ok: false,
				error: { code: 'command-miss', message: 'the host admitted no command for this line' }
			});
		}
		if (receipt.result.kind === 'error') {
			return json({
				ok: false,
				error: { code: 'command-error', message: receipt.result.text ?? 'the command reported an error' }
			});
		}
		return json({
			ok: true,
			accepted: true,
			commandId: receipt.commandId,
			...(receipt.result.text !== undefined ? { text: receipt.result.text } : {})
		});
	} catch (err) {
		return json(mapRpcFailure(err), { status: statusFor(err) });
	}
};
