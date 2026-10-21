/**
 * executor/mention — the @session mention verb with its a2a delegation
 * ledger writes, moved whole from command-executor.ts (thin batch R3
 * lane B, ADR-0019 move-whole / ADR-0022 W3): every wire byte, error
 * string, and note text is byte-identical. The shell's executeCommand
 * dispatches here for command.type === 'mention'.
 */

import { addPanelFromSidebar } from '$lib/services/panels/panel-registry';
import { buildDeliveredText, mintA2aId } from '../a2a-protocol';
import type { ExecutorContext, ExecutorResult, NoteSink } from '../command-executor';

/**
 * @session-… mention (2026-08-26, KB "Talking to Another Agent"): deliver
 * the message to ANOTHER session as a queued prompt and open its panel —
 * the reply surface (its approval cards render there; a whisper to an
 * unseen session stalls silently). Same handler grammar as the live
 * delegation the KB note documents: look (spine) → open (panel) → send
 * (queue, never steer) → honest note. Guardrails per the note: usage,
 * self-mention no-op, unknown id sends NOTHING, replies are never
 * auto-forwarded anywhere (one hop, one human).
 */
export async function runMention(
	capturedId: string,
	text: string,
	a2aId: string | undefined,
	ctx: ExecutorContext,
	onNote?: NoteSink
): Promise<ExecutorResult> {
	if (text === '') {
		return { ok: false, note: 'usage: @<session-id> <message> — the message is empty' };
	}
	// Self-mention (uuid-tail match — this panel's id may carry the
	// 'session-' prefix, the captured token never does): just talk.
	if (ctx.sessionId.replace(/^session-/, '') === capturedId) {
		return { ok: true, note: 'that is this session — just type your message' };
	}
	// Look before you talk: the spine row canonicalizes the id and
	// carries the title/preset/running bits the rest needs.
	type MentionRow = {
		sessionId: string;
		title: string | null;
		agentPreset: string | null;
		running: boolean;
		turns: number | null;
	};
	let row: MentionRow | null = null;
	try {
		const res = await fetch('/api/dsh/sessions');
		if (res.ok) {
			const body = (await res.json().catch(() => null)) as {
				ok?: boolean;
				sessions?: Array<Record<string, unknown>>;
			} | null;
			if (body?.ok === true && Array.isArray(body.sessions)) {
				const found = body.sessions.find(
					(s) => typeof s.sessionId === 'string' && s.sessionId.replace(/^session-/, '') === capturedId
				);
				row = found
					? {
							sessionId: found.sessionId as string,
							title: (found.title as string | null | undefined) ?? null,
							agentPreset: (found.agentPreset as string | null | undefined) ?? null,
							running: found.running === true,
							turns: typeof found.turns === 'number' ? found.turns : null
						}
					: null;
			}
		}
	} catch {
		// Network/spine failure — an honest retry note, not "no such
		// session" (that would be a fib about a list we never saw).
		return { ok: false, note: 'session list unavailable — try again' };
	}
	if (row === null) {
		return { ok: false, note: `no such session: ${capturedId} — nothing was sent` };
	}
	// Mention ⇒ panel: the floor owner opens (or selects) the target's
	// panel — dedupe→select is its policy; no floor mounted is a hard no.
	const opened = addPanelFromSidebar({
		sessionId: row.sessionId,
		agentPreset: row.agentPreset
	});
	if (!opened) {
		return {
			ok: false,
			note: '@session needs the panel floor (open this session on the floor first)'
		};
	}
	// Deliver — queue mode by design (stealing a running turn via steer
	// stays an explicit human choice, never a side effect). The delivered
	// text carries the a2a protocol line (Task 3.3): strip any leading
	// signature token, inject the Trial-B instruction for the id the
	// ledger will track (minted here when the composer carried none).
	const signatureId = a2aId ?? mintA2aId();
	const delivered = buildDeliveredText(text, signatureId);
	try {
		const res = await fetch(`/api/dsh/session/${encodeURIComponent(row.sessionId)}/prompt`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ text: delivered })
		});
		const body = (await res.json().catch(() => null)) as { ok?: boolean; error?: { message?: string } } | null;
		if (!res.ok || body?.ok !== true) {
			return { ok: false, note: body?.error?.message ?? `mention failed (HTTP ${res.status})` };
		}
		const label = row.title ?? row.sessionId;
		// Note fires AT the receipt — the typed path's exact point (the
		// banner shows "sent/queued" one fetch before the register lands).
		onNote?.(
			true,
			row.running
				? `queued behind ${label}'s current turn — panel opened`
				: `sent to ${label} — panel opened`
		);
		// Register the watch AFTER the receipt (prompt first, register
		// second — the order is the contract; Task 3.3). Watermark = the
		// spine row's turns at send; turns null → -1 + honest note.
		if (row.turns === null) {
			onNote?.(
				true,
				`${row.running ? `queued behind ${label}` : `sent to ${label}`} — untracked watermark: the spine row carries no turns count`
			);
		}
		try {
			const reg = await fetch('/api/a2a/register', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					from: ctx.sessionId,
					to: row.sessionId,
					message: text,
					watermark: row.turns ?? -1,
					id: signatureId
				})
			});
			const regBody = (await reg.json().catch(() => null)) as { ok?: boolean } | null;
			if (!reg.ok || regBody?.ok !== true) {
				// Send already happened — honest, not silent (Task 3.3). The
				// typed path REPLACED the ok note with this standalone error
				// text — same bytes, same point.
				onNote?.(false, 'sent, but untracked — the delegation ledger is unavailable');
				return { ok: true, note: 'sent, but untracked — the delegation ledger is unavailable' };
			}
		} catch {
			onNote?.(false, 'sent, but untracked — the delegation ledger is unavailable');
			return { ok: true, note: 'sent, but untracked — the delegation ledger is unavailable' };
		}
		if (row.turns === null) {
			return {
				ok: true,
				note: `${row.running ? `queued behind ${label}` : `sent to ${label}`} — untracked watermark: the spine row carries no turns count`
			};
		}
		return {
			ok: true,
			note: row.running
				? `queued behind ${label}'s current turn — panel opened`
				: `sent to ${label} — panel opened`
		};
	} catch (err) {
		return { ok: false, note: `mention failed (${err instanceof Error ? err.message : String(err)})` };
	}
}

