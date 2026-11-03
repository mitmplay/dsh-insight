/**
 * command-parser — the composer's slash-command intercept (2026-08-25),
 * modeled on OCI's parser (openclaw-insight/src/lib/services/chat/
 * command-parser.ts — ported per its port checklist: trim-tolerant,
 * exact-first-token case-insensitive match, unknown → null passthrough).
 *
 * DSI's vocabulary (the host's DSH surface, not OpenClaw's):
 *   /permission [preset] — execute the NATIVE command host-side (never the
 *                          model); bare /permission prints the current preset
 *   /new [@agent]        — new session in this panel's workspace (the
 *                          sidebar '+ New chat' inheritance, typed); the
 *                          optional @agent overrides the inherited preset id
 *                          (2026-08-26) — the host validates it
 *                          (agent-preset/not-found on a miss), the parser
 *                          never rewrites the id's case
 *   /dsi-prompts        — aim the prompts manager panel (DSI-local,
 *   /dsi-settings            2026-09-17, ADR The Focus Command D1): FOCUS
 *   /dsh-settings            the already-open target panel, else open a
 *                           NEW one right of the composer's panel and
 *                           select it — the bare successor-swap and the
 *                           --add flag are retired (D2); any args are a
 *                           usage note. One content family, the command
 *                           name carries the discriminant (manager vs
 *                           which settings home).
 *   /loadinjected …      — RETIRED as a typed command (2026-09-17, The
 *                          Retired Typed Command ADR D1/D2): every typed
 *                          shape routes to the executor's retirement note
 *                          pointing at the InjectedShelfButton. The
 *                          'loadinjected' TYPE survives as INTERNAL
 *                          grammar: the shelf button composes it via the
 *                          loadinjectedCommand() constructor (D3), never
 *                          through the typed string.
 *   /workspace <full-path> [name] — adopt a host folder as a workspace
 *                          (DSI-local, 2026-09-15, The Workspace Command
 *                          ADR D1/D2): the required path is adopted via
 *                          workspace/create (never written to — D4); the
 *                          optional name renames the row WHEN the host
 *                          created it (D2); ~ paths expand against the
 *                          host home before the wire (D3)
 *   /new [@agent] [workspace] [--title <title>] [--add] — the /new
 *                          grammar: ONE optional workspace token (2026-09-15,
 *                          ADR D5; a title or canonical-path match against
 *                          the workspace registry displaces the inherited
 *                          cwd) and ONE optional --title flag (2026-10-29,
 *                          ADR amendment D7/D8 — the session's title at
 *                          birth, applied via the session-rename route);
 *   @<session-id> <msg>  — the agent-to-agent mention (2026-08-26, KB note
 *                          "Talking to Another Agent"): deliver <msg> to
 *                          THAT session as a queued prompt and open its
 *                          panel on the floor (mention ⇒ panel). The id is
 *                          the uuid tail — '@session-<uuid>' and '@<uuid>'
 *                          both match; the handler canonicalizes against
 *                          the spine rows.
 *
 * Unknown or malformed lines return null and pass through as ordinary
 * chat text — the client never rejects what it doesn't understand (OCI
 * semantics: /usr/bin/python and /newfile.txt are not commands). Mentions
 * follow the same rule: '@channel hi' or '@session-xyz' (not a uuid) are
 * ordinary text, never a mention.
 */

/** One intercepted composer line. */
export interface ParsedCommand {
	type:
		| 'permission'
		| 'new'
		| 'workspace'
		| 'mention'
		| 'promptmanager'
		| 'terminal'
		| 'dsisettings'
		| 'dshsettings'
		| 'skillshelf'
		| 'pluginrack'
		| 'loadinjected';
	/** The raw remainder after the command token, trimmed (may be empty). */
	args: string;
	/** /new only (2026-08-26) — the captured agent preset id when the args
	 *  are exactly one `@<id>` token (case preserved verbatim: preset ids
	 *  are host slugs, never canonicalized client-side; the create rejects
	 *  an unknown id). Absent otherwise — including any multi-token or
	 *  non-@ shape, which the handler usage-errors. */
	agentId?: string;
	/** /new and /loadinjected only — the `--add` flag. /new (2026-09-06):
	 *  the new session opens in a NEW panel placed to the RIGHT of the
	 *  current panel, and the selection/focus STAYS in the current panel
	 *  (the successor-swap default never runs). Retired for /dsi-prompts
	 *  · /dsi-settings · /dsh-settings (2026-09-17, The Focus Command ADR
	 *  D1/D2) — those commands aim a panel; the flag now usage-errors. */
	addPanel?: boolean;
	/** /loadinjected only (2026-09-07, The Loadinjected ADR D4) — the
	 *  captured filename token, case preserved verbatim (paths match
	 *  case-sensitively against the shelf). Absent when the shape was
	 *  malformed (bare, a lone --add, extra tokens) — the executor
	 *  usage-errors those from the raw args. */
	filename?: string;
	/** /workspace only (2026-09-15, The Workspace Command ADR D2) — the
	 *  captured path token (case preserved verbatim; ~ left raw for the
	 *  executor's host-home expansion, D3). Present when the args are one
	 *  path token; absent when the shape was malformed (bare, ?, extra
	 *  tokens) — the executor usage-errors those from the raw args. */
	wsPath?: string;
	/** /workspace only (2026-09-15, ADR D2) — the optional second token,
	 *  the display title to rename the row to WHEN the host created it.
	 *  Case preserved verbatim; '--add' is NOT a flag on /workspace — a
	 *  two-token shape always captures the second as the name. Absent
	 *  otherwise. */
	wsName?: string;
	/** /new only (2026-09-15, ADR D5) — the ONE optional workspace token:
	 *  resolved by the executor against the registry (unique title, then
	 *  exact canonical path) to displace the inherited cwd. Not a '--'
	 *  flag token and not an '@' token; case preserved verbatim. Absent
	 *  for the four pre-existing shapes and any malformed remainder. */
	ws?: string;
	/** /new only (2026-10-29, The Workspace Command ADR amendment D8) —
	 *  the session title at birth: the tokens after a '--title' flag,
	 *  whitespace-joined, case preserved verbatim. The remainder IS the
	 *  title — no quoting grammar (D8's rejected alternative). A bare
	 *  '--title' with no following tokens is a malformed shape (raw args,
	 *  the leftover rule). Absent for every pre-existing shape. */
	title?: string;
	/** /dsi-skills only (The Skill Shelf ADR, 2026-09-20, D3) — the
	 *  exact '--reload' flag: force a snapshot rebuild before the shelf
	 *  panel opens. Absent for the bare command. */
	reload?: boolean;
	/** /dsi-terminal only (The Terminal Desk ADR, 2026-09-24, D2) — the
	 *  ONE admitted flag: 'new-tab' appends a tab, 'split-down' adds a row
	 *  to the selected tab. The two flags are MUTUALLY EXCLUSIVE: both
	 *  together (or any other args) keep the raw args so the executor
	 *  usage-errors them — the '/new leftover' rule. Absent for the bare
	 *  command. */
	terminalAction?: 'new-tab' | 'split-down';
	/** Mention only — the captured session id (the uuid tail, lowercase);
	 *  the handler canonicalizes it against the spine rows. */
	sessionId?: string;
	/** Mention only (2026-08-25 a2a signature) — the correlation id parsed
	 *  from a leading `_a2a_:<id>;` signature token, when present (lowercase,
	 *  charset-validated by a2a-protocol); absent otherwise. The handler
	 *  mints one when the composer sent none. */
	a2aId?: string;
}

import { parseA2aSignature } from './a2a-protocol';

/**
 * Mention shape: '@' + 'session-' + a uuid (case-insensitive hex), then
 * optional whitespace and the message. Only the uuid tail is captured —
 * spine rows match by that tail either way (DSH mints 'session-<uuid>'
 * ids, some sessions carry bare uuids; both live in one list).
 */
const MENTION_RE =
	/^@session-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\s+([\s\S]*))?$/i;

/**
 * Parse one composer submission. Returns null for anything that is not an
 * EXACT known command token (case-insensitive) at the start — the caller
 * submits null results as ordinary chat text.
 */
export function parseCommand(text: string): ParsedCommand | null {
	const trimmed = text.trim();
	if (trimmed === '') return null;
	if (trimmed.startsWith('@')) {
		const m = MENTION_RE.exec(trimmed);
		if (m === null) return null; // '@channel hi' etc. — ordinary text
		// a2a signature (2026-08-25): a leading `_a2a_:<id>;` token in the
		// args is plumbing, never message. Parse + strip via the shared
		// primitive (one source of truth); no signature → unchanged shape.
		const sig = parseA2aSignature(m[2] ?? '');
		return sig === null
			? { type: 'mention', sessionId: m[1].toLowerCase(), args: (m[2] ?? '').trim() }
			: { type: 'mention', sessionId: m[1].toLowerCase(), args: sig.message, a2aId: sig.id };
	}
	if (!trimmed.startsWith('/')) return null;
	const spaceIdx = trimmed.search(/\s/);
	const token = (spaceIdx === -1 ? trimmed : trimmed.slice(0, spaceIdx)).toLowerCase();
	const args = spaceIdx === -1 ? '' : trimmed.slice(spaceIdx).trim();
	switch (token) {
		case '/permission':
			return { type: 'permission', args };
		case '/new': {
			// Widened grammar (2026-09-15, The Workspace Command ADR D5):
			// one optional '@<id>' token (D-prior, 2026-08-26) + ONE optional
			// workspace token (D5) + an optional trailing '--add' flag
			// (2026-09-06) — '/new', '/new @id', '/new --add', '/new @id
			// --add' (the four pinned shapes, byte-identical) plus '/new ws',
			// '/new @id ws', '/new ws --add', '/new @id ws --add'. Guards:
			// the workspace token is never an '@...' or '--...' token (flag
			// and id shapes keep their pinned raw-args behavior), and a bare
			// '@' is not an id (pinned raw shape). Any other shape keeps the
			// raw args (the handler usage-errors it, as '/new leftover'
			// today). The ws token's case is preserved verbatim (D5: the
			// registry match is the executor's job, never the parser's).
			const toks = args === '' ? [] : args.split(/\s+/);
			let rest = toks;
			let agentId: string | undefined;
			let ws: string | undefined;
			let title: string | undefined;
			let addPanel = false;
			if (rest.length > 0 && rest[rest.length - 1] === '--add') {
				addPanel = true; // exact lowercase only (the /new flag precedent)
				rest = rest.slice(0, -1);
			}
			// --title (2026-10-29, ADR amendment D8): the flag consumes the
			// REST of the line — whitespace-joined, verbatim, no quoting
			// grammar. Tokens BEFORE the flag re-run the standing rules
			// (@id first, then the one ws token); a bare --title (nothing
			// after it) is a malformed shape → raw args (the leftover rule).
			const titleIdx = rest.indexOf('--title'); // exact lowercase only
			if (titleIdx !== -1) {
				if (titleIdx === rest.length - 1) return { type: 'new', args };
				title = rest.slice(titleIdx + 1).join(' ');
				rest = rest.slice(0, titleIdx);
			}
			if (rest.length > 0 && rest[0].startsWith('@') && rest[0].length > 1) {
				agentId = rest[0].slice(1); // host slug, case preserved
				rest = rest.slice(1);
			}
			if (
				rest.length === 1 &&
				!rest[0].startsWith('@') &&
				!rest[0].startsWith('--') &&
				rest[0] !== '?' // the ? help intent routes on raw args (D6)
			) {
				ws = rest[0]; // D5 — the one workspace token
				rest = [];
			}
			if (rest.length !== 0) return { type: 'new', args };
			return {
				type: 'new',
				args: '',
				...(agentId !== undefined ? { agentId } : {}),
				...(ws !== undefined ? { ws } : {}),
				...(title !== undefined ? { title } : {}),
				...(addPanel ? { addPanel: true } : {})
			};
		}
		case '/workspace': {
			// /workspace <full-path> [name] (2026-09-15, ADR D1/D2): the path
			// is REQUIRED (D1 — a missing folder is a note, never an auto-
			// mkdir, D4, so a bare shape has nothing honest to do), the name
			// optional (D2 — rename only what THIS command created). One
			// token captures wsPath; two capture wsPath + wsName ('--add' is
			// NOT a flag here — no panel semantics on /workspace, so a two-
			// token shape always takes the second as the name). Zero or 3+
			// tokens keep the raw args for the executor's usage note; a bare
			// ? keeps raw args so the ? help intent routes (D6).
			if (args === '' || args === '?') return { type: 'workspace', args };
			const toks = args.split(/\s+/);
			if (toks.length === 1) {
				return { type: 'workspace', args: '', wsPath: toks[0] };
			}
			if (toks.length === 2) {
				return { type: 'workspace', args: '', wsPath: toks[0], wsName: toks[1] };
			}
			return { type: 'workspace', args };
		}
		case '/dsi-terminal': {
			// The Terminal Desk ADR (2026-09-24, D2): exactly three shapes —
			// bare, '--new-tab', '--split-down'. Both flags together (or any
			// other args) keep the raw shape so the executor usage-errors
			// them — the '/new leftover' rule. With no desk on the floor all
			// three shapes mean the same thing (create tab[0]/row[0]); the
			// action only discriminates when a desk exists.
			if (args === '' || args === '--new-tab' || args === '--split-down') {
				return {
					type: 'terminal',
					args: '',
					...(args !== '' ? { terminalAction: args.slice(2) as 'new-tab' | 'split-down' } : {})
				} as ParsedCommand;
			}
			return { type: 'terminal', args };
		}
		case '/dsi-prompts':
		case '/dsi-settings':
		case '/dsh-settings': {
			// The Focus Command ADR (2026-09-17, D1/D2): ONE shape — the
			// bare token. The old --add flag is retired grammar: any args
			// (including a literal --add) keep the raw shape so the
			// executor usage-errors them, the '/new leftover' rule. The
			// display token renamed 2026-09-24 (dsi-/dsh- prefixes) — the
			// internal ParsedCommand type is the STABLE name, so each
			// token maps explicitly instead of via token.slice(1).
			const types = {
				'/dsi-prompts': 'promptmanager',
				'/dsi-settings': 'dsisettings',
				'/dsh-settings': 'dshsettings'
			} as const;
			return { type: types[token as keyof typeof types], args } as ParsedCommand;
		}
		case '/dsi-plugins': {
			// The Plugin Rack ADR (2026-09-27, D1/D2): the shelf's grammar
			// re-decided for the rack — bare opens the rack panel; the ONE
			// flag '--reload' forces a snapshot rebuild before the panel
			// opens. Any other args keep the raw shape so the executor
			// usage-errors them (the '/new leftover' rule).
			if (args === '') return { type: 'pluginrack', args };
			if (args === '--reload') return { type: 'pluginrack', args: '', reload: true };
			return { type: 'pluginrack', args };
		}
		case '/dsi-skills': {
			// The Skill Shelf ADR (2026-09-20, D1/D3): bare opens the shelf
			// panel; the ONE flag '--reload' forces a snapshot rebuild before
			// the panel opens. Any other args keep the raw shape so the
			// executor usage-errors them (the '/new leftover' rule).
			if (args === '') return { type: 'skillshelf', args };
			if (args === '--reload') return { type: 'skillshelf', args: '', reload: true };
			return { type: 'skillshelf', args };
		}
		case '/loadinjected': {
			// RETIRED as a typed command (2026-09-17, The Retired Typed
			// Command ADR D1/D2): EVERY typed shape — bare, filename, --add,
			// ? — keeps its raw args and carries NO filename field. The
			// executor's retirement guard (D2) discriminates structurally:
			// filename present = the constructor's internal shape (resolve
			// as the Loadinjected ADR built it); filename absent = typed →
			// the honest retirement note. Never a silent unknown-command.
			return { type: 'loadinjected', args };
		}
		default:
			return null;
	}
}

/**
 * The INTERNAL constructor for the loadinjected command (2026-09-17, The
 * Retired Typed Command ADR D3): the shelf button's only way to compose
 * the command — never a string handed back to parseCommand. The shape is
 * byte-identical to the pre-retirement typed grammar's product (filename
 * present, args empty, addPanel for --add), so the executor resolves it
 * exactly as the Loadinjected ADR (2026-09-07, D4) built — resolution,
 * honest notes, dedupe, placement all keep their single home.
 */
export function loadinjectedCommand(
	displayPath: string,
	opts: { add?: boolean } = {}
): ParsedCommand {
	return {
		type: 'loadinjected',
		args: '',
		filename: displayPath,
		...(opts.add === true ? { addPanel: true } : {})
	};
}
