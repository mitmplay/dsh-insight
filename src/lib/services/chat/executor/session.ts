/**
 * executor/session — the /new session verb, moved whole from
 * command-executor.ts (thin batch R3 lane B, ADR-0019 move-whole /
 * ADR-0022 W1): every wire byte, error string, and note text is
 * byte-identical. The shell's executeCommand dispatches here for
 * command.type === 'new'.
 */

import {
	addPanelFromSidebar,
	replacePanelBySession,
	replacePanelFromRegistry
} from '$lib/services/panels/panel-registry';
import type { ExecutorContext, ExecutorResult, NoteSink } from '../command-executor';
import { resolveWorkspaceToken } from './workspace';

/** The /new verb (moved verbatim from the executeCommand body). */
export async function runNewLine(
	command: {
		args: string;
		/** /new only (2026-09-15, ADR D5) — the parser's workspace token. */
		ws?: string;
		/** /new only (2026-09-06) — the parser's --add flag (see ParsedCommand). */
		addPanel?: boolean;
		/** /new only (2026-10-29, ADR amendment D8) — the parser's title
		 *  capture (the --title remainder, joined). Applied via the
		 *  session-rename route (D7), never the create wire. */
		title?: string;
		agentId?: string;
	},
	ctx: ExecutorContext,
	onNote?: NoteSink
): Promise<ExecutorResult> {
	// /new
	if (command.args !== '') {
		const usage = 'usage: /new [@agent] [workspace] [--title <title>] [--add]';
		onNote?.(false, usage);
		return { ok: false, note: usage };
	}
	if (ctx.panelId == null) {
		const note = '/new needs a panel floor (open this session on the floor first)';
		onNote?.(false, note);
		return { ok: false, note };
	}
	// Workspace token (2026-09-15, The Workspace Command ADR D5): resolve
	// against the host registry BEFORE any create — a unique registry TITLE
	// match wins, then an exact canonical-PATH match; an ambiguous title is
	// a candidates note (path + title), never a guess; a miss is an honest
	// note pointing back at /workspace. A resolution REPLACES the inherited
	// cwd in the create body (the named workspace replaces inheritance).
	let cwd = ctx.workspace;
	if (command.ws !== undefined) {
		const resolved = await resolveWorkspaceToken(command.ws);
		if (resolved.note !== undefined) {
			onNote?.(false, resolved.note);
			return { ok: false, note: resolved.note };
		}
		cwd = resolved.path ?? null;
	}
	// Fresh-install marker (2026-09-15, ADR F11): no current workspace AND
	// no ws token — the session is about to land on the host default cwd,
	// ungrouped. The note rides the SUCCESS returns only.
	const freshInstallNote =
		cwd === null
			? '/new: no workspace inherited — this session lands UNGROUPED; adopt one with /workspace <full-path>, then aim with /new <name>'
			: undefined;
	// Preset override (2026-08-26): `/new @<id>` swaps the agent for the
	// successor; absent keeps the inheritance. The host validates the id
	// (agent-preset/not-found on a miss) — never a client-side catalog.
	const preset = command.agentId ?? ctx.agent;
	try {
		const res = await fetch('/api/dsh/sessions', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			// Workspace + preset inheritance — the sidebar '+ New chat'
			// contract (2026-08-23): the new session lands in the same
			// project and the same agent; @agent overrides the agent. A D5
			// resolution (above) displaces the inherited cwd.
			body: JSON.stringify({
				...(cwd !== null ? { cwd } : {}),
				...(preset !== null ? { agentPreset: preset } : {})
			})
		});
		const body = (await res.json().catch(() => null)) as
			| { ok?: boolean; sessionId?: string; error?: { message?: string } }
			| null;
		if (!res.ok || body?.ok !== true || typeof body.sessionId !== 'string') {
			const note = body?.error?.message ?? `/new failed (HTTP ${res.status})`;
			onNote?.(false, note);
			return { ok: false, note };
		}
		// --title (2026-10-29, ADR amendment D7): the title rides the
		// session-rename route the fork spine already uses (fork-session.ts
		// renameChild) — the create wire has no title field. Awaited BEFORE
		// the panel mounts so the row renders titled. Best-effort and SILENT
		// on failure (D7's rejected alternative b): the session is born and
		// on the floor; a failed cosmetic rename must never read as a
		// failed birth — the host's default title simply stays.
		if (command.title !== undefined && command.title !== '') {
			try {
				await fetch(`/api/dsh/session/${encodeURIComponent(body.sessionId)}/rename`, {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ title: command.title })
				});
			} catch {
				// swallow — best-effort by decision, never a failed birth
			}
		}
		// --add (2026-09-06): the new session opens in a NEW panel to the
		// RIGHT of the current panel (afterSessionId anchors it under this
		// session — a click during the async create cannot move the
		// anchor) and the selection STAYS here (keepSelection — the
		// composer keeps the caret; the swap path below never runs).
		if (command.addPanel === true) {
			const added = addPanelFromSidebar({
				sessionId: body.sessionId,
				agentPreset: preset,
				afterSessionId: ctx.sessionId,
				keepSelection: true
			});
			if (!added) {
				const note = '/new: the floor is not mounted';
				onNote?.(false, note);
				return { ok: false, note };
			}
			// Fresh install (2026-09-15, ADR F11): no inherited workspace and
			// no ws token — the create SUCCEEDED on the host default cwd, but
			// the session lands ungrouped and the operator deserves the map.
			if (freshInstallNote !== undefined) {
				onNote?.(true, freshInstallNote);
				return { ok: true, newSessionId: body.sessionId, note: freshInstallNote };
			}
			return { ok: true, newSessionId: body.sessionId };
		}
		const swapped =
			// Session-addressed swap first (Sectioned Row W3 2026-08-29): a
			// macro run that /new-retargets holds its context by SESSION — the
			// birth panel id died at the FIRST swap (fresh id + remount), so an
			// id-addressed replace would silently no-op the second one.
			replacePanelBySession(ctx.sessionId, {
				sessionId: body.sessionId,
				agentPreset: preset,
				focus: true
			}) ||
			// Typed-path fallback: the birth panel id is live on a first /new.
			(ctx.panelId != null &&
				replacePanelFromRegistry(ctx.panelId, {
				sessionId: body.sessionId,
				agentPreset: preset,
				focus: true
			})) ||
			false;
		if (!swapped) {
			const note = '/new: the floor is not mounted';
			onNote?.(false, note);
			return { ok: false, note };
		}
		// No note on success — the panel swap IS the feedback. Exception
		// (2026-09-15, ADR F11): a fresh install (no inherited workspace, no
		// ws token) landed UNGROUPED — the note is the map out.
		if (freshInstallNote !== undefined) {
			onNote?.(true, freshInstallNote);
			return { ok: true, newSessionId: body.sessionId, note: freshInstallNote };
		}
		return { ok: true, newSessionId: body.sessionId };
	} catch (err) {
		const note = `/new failed (${err instanceof Error ? err.message : String(err)})`;
		onNote?.(false, note);
		return { ok: false, note };
	}
}
