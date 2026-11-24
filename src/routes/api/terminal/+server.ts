/**
 * /api/terminal — open and list (spec 2026-09-24 Wave 3, task 3.1).
 *
 * The resolve(request): Spec step lives here (ADR D3): the seam applies no
 * defaults, so this route fills every spec field from the operator's
 * terminal config and the explicit request before the registry spawns
 * anything. The whole surface is gated by terminal.enabled — a disabled
 * flag answers NOT_ENABLED and the floor renders nothing.
 *
 * Baton facet (ADR-0079): GET lists each session with its token-free
 * `baton` facet (the registry's list() carries it); POST accepts the same
 * optional mint labels as reattach — absent or malformed means the
 * operator default, never a 400 (D3).
 */
import { homedir } from 'node:os';

import { json } from '@sveltejs/kit';

import { readTerminalConfig } from '$lib/server/insight-config.js';
import { terminalRegistry } from '$lib/server/terminal/registry.js';
import type { BatonMintOptions } from '$lib/server/terminal/registry.js';
import type { TerminalDeskIntent, TerminalSpec } from '$lib/server/terminal/types.js';

export const GET = (): Response => {
	const cfg = readTerminalConfig();
	return json({
		enabled: cfg.enabled,
		theming: cfg.theming,
		maxSessions: cfg.maxSessions,
		sessions: terminalRegistry.list()
	});
};

interface OpenBody {
	cwd?: string;
	rows?: number;
	cols?: number;
	holder?: unknown;
	holderId?: unknown;
	/** Where the desk should show this birth (ADR 2026-11-24 D2) —
	 *  optional; absent/garbage means headless, never a 400. */
	desk?: unknown;
}

/** resolve(request) for the mint labels (ADR-0079 D3) — the route's own
 *  defaulting step: only `automation` is a claimable non-default label, a
 *  label is a non-empty string or nothing, and anything else lands as the
 *  operator + null. Malformed never answers 400 — a takeover must be
 *  visible, not refused. */
function resolveMintOptions(body: { holder?: unknown; holderId?: unknown }): BatonMintOptions {
	return {
		holder: body.holder === 'automation' ? 'automation' : 'operator',
		holderId: typeof body.holderId === 'string' && body.holderId.length > 0 ? body.holderId : null
	};
}

/** resolve(request) for the desk intent (ADR 2026-11-24 D2): only the
 *  two named placements are intents; anything else — absent, mistyped,
 *  garbage — is a HEADLESS mint, matching the mint-label convention that
 *  malformed never answers 400. */
function resolveDesk(body: { desk?: unknown }): TerminalDeskIntent | undefined {
	return body.desk === 'new-tab' || body.desk === 'split-down' ? body.desk : undefined;
}

function intInRange(v: unknown, min: number, max: number, fallback: number): number {
	return typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max ? v : fallback;
}

/** resolve(request): Spec — the owning defaulting step. Explicit request
 *  values win over operator config floors; the seam never sees a default. */
function resolveSpec(body: OpenBody, cfg: ReturnType<typeof readTerminalConfig>): TerminalSpec {
	const shell = process.env.SHELL || '/bin/bash';
	return {
		argv: [shell, '-l'],
		cwd: typeof body.cwd === 'string' && body.cwd.length > 0 ? body.cwd : homedir(),
		rows: intInRange(body.rows, 2, 200, 24),
		cols: intInRange(body.cols, 2, 500, 80),
		terminalType: 'xterm-256color',
		graceMs: cfg.graceMs,
		idleMs: cfg.idleMs,
		tailBytes: cfg.tailBytes,
		env: undefined
	};
}

export const POST = async ({ request }: { request: Request }): Promise<Response> => {
	const cfg = readTerminalConfig();
	if (!cfg.enabled) return json({ error: 'NOT_ENABLED' }, { status: 403 });
	// The Terminal Desk (ADR 2026-09-24, D6): the resource valve lives where
	// the PTYs live — the desk can only render the refusal, never lift it.
	if (terminalRegistry.list().filter((s) => !s.exited).length >= cfg.maxSessions) {
		return json({ error: 'MAX_SESSIONS' }, { status: 429 });
	}
	let body: OpenBody = {};
	try {
		body = (await request.json()) as OpenBody;
	} catch {
		body = {};
	}
	const { session, token } = terminalRegistry.create(resolveSpec(body, cfg), {
		...resolveMintOptions(body),
		deskIntent: resolveDesk(body)
	});
	return json({
		sessionId: session.id,
		token,
		fromByte: 0,
		totalBytes: session.streamBytes()
	});
};
