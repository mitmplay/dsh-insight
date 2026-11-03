/**
 * api-dsh — GET /api/dsh/session/[sessionId]/attachment?ref=<DsiImageRef JSON>
 *
 * The echo's authorized read (task 3.2, ADR D7): proxies session.attachment
 * — the ledger stores refs; bytes are fetched through this route only when
 * rendered, session-authorized by the host (BC-A5: the echo renders from
 * the ledger, never from the browser draft).
 *
 * 0.2.2 contract (2026-10-29 release jump): the host verifies the SUPPLIED
 * full image ref (attachmentId, mediaType, bytes, width, height) against
 * the stored bytes — read-by-id-alone rejects gateway/input-invalid. The
 * renderer already holds the complete ref (DsiImageRef, folded from the
 * wire ImageBlock), so it travels here as JSON and forwards verbatim.
 */

import { json } from '@sveltejs/kit';
import { getDshConnection } from '$lib/server/dsh-connection';
import { mapRpcFailure, statusFor, isPromptImageMediaType } from '$lib/server/dsh-rpc';

import type { RequestHandler } from './$types';

/** Structural gate on the client-supplied ref — mirrors the host's strict
 *  ImageAttachmentRef so garbage never reaches the RPC boundary. */
function parseImageRef(raw: string | null): Record<string, unknown> | null {
	if (raw === null || raw.length === 0) return null;
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return null;
	}
	if (parsed === null || typeof parsed !== 'object') return null;
	const ref = parsed as Record<string, unknown>;
	if (typeof ref.attachmentId !== 'string' || ref.attachmentId.length === 0) return null;
	if (typeof ref.mediaType !== 'string' || !isPromptImageMediaType(ref.mediaType)) return null;
	if (typeof ref.bytes !== 'number' || ref.bytes < 0) return null;
	if (typeof ref.width !== 'number' || typeof ref.height !== 'number') return null;
	const out: Record<string, unknown> = {
		attachmentId: ref.attachmentId,
		mediaType: ref.mediaType,
		bytes: ref.bytes,
		width: ref.width,
		height: ref.height
	};
	if (typeof ref.name === 'string') out.name = ref.name;
	return out;
}

export const GET: RequestHandler = async ({ params, url }) => {
	const sessionId = params.sessionId;
	const ref = parseImageRef(url.searchParams.get('ref'));
	if (ref === null) {
		return json(
			{
				ok: false,
				error: {
					code: 'missing-attachment-ref',
					message: 'ref query parameter is required: a JSON DsiImageRef (attachmentId, mediaType, bytes, width, height)'
				}
			},
			{ status: 400 }
		);
	}

	try {
		const value = await getDshConnection().readAttachment(sessionId, ref);
		return json({ ok: true, attachment: value.attachment, data: value.data });
	} catch (err) {
		return json(mapRpcFailure(err), { status: statusFor(err) });
	}
};
