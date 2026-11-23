/**
 * run_code payload parsing — the ONE parser for the CodeCard (ADR-0008,
 * 2026-08-26). The wire carries no presentation view for run_code
 * (verified across session 1fe381df's 106 calls), so the card derives
 * everything client-side from tool/call args:
 *
 *   {code: string, description?: string}
 *
 * — code is a TypeScript program in the generated SDK's grammar
 *   await tools.NAME({…}); description is the model's own one-line
 *   intent (present in 92% of observed calls).
 *
 * The plan scan is DISPLAY-DERIVED, never truth: a call not written
 * literally as tools.NAME( simply does not appear; junk parses to
 * undefined and the caller keeps the raw view. Never throws.
 */

import { toolTitle } from './tool-titles';
import { truncate } from './truncate';

/** One scanned tool call of the program, in source order. */
export interface CodeToolStep {
	/** Wire tool name as written in the code (read, bash, …). */
	tool: string;
	/** Salient argument preview (path basename, command first line, pattern). */
	arg?: string;
}

/** A parsed run_code program. */
export interface CodeProgram {
	/** The program body, verbatim. */
	code: string;
	/** The model's one-line intent, when present. */
	description?: string;
	/** Scanned tool calls in source order; empty for code-only programs. */
	plan: CodeToolStep[];
}

/** The strip is a plan, not a listing — bounded to keep it one glance. */
const MAX_PLAN_STEPS = 8;

/** Argument-key ladder order for tools with no preferred key. */
const SALIENT_KEYS = ['path', 'cmd', 'command', 'pattern', 'query', 'url'] as const;

/** Preferred key per tool (ADR-0008): path basename for file tools,
 * command first line for shells, pattern for searchers. */
const SALIENT_BY_TOOL: Record<string, readonly string[]> = {
	read: ['path'],
	write: ['path'],
	edit: ['path'],
	bash: ['cmd', 'command'],
	pwsh: ['cmd', 'command'],
	grep: ['pattern'],
	glob: ['pattern'],
	web_search: ['query'],
	web_fetch: ['url']
};

/** Peek one-liner cap (parity with tool-preview's RAW_CAP — the row
 * wraps via break-all; the cap only bounds a pathologically long
 * single line). */
const PEEK_CAP = 120;

/** Cap a peek string, ellipsis affordance included. */
function peekCap(text: string): string {
	const cut = truncate(text, PEEK_CAP);
	return cut.head + (cut.truncated ? '…' : '');
}

/** Cap a preview string at an arbitrary cap (strip uses 60), ellipsis included. */
function capText(text: string, cap: number): string {
	const cut = truncate(text, cap);
	return cut.head + (cut.truncated ? '…' : '');
}

/**
 * Indices of TOP-LEVEL `;` in a decoded command — outside all quotes
 * ('"/backtick, escaped chars) and outside ()/[] nesting. Heredocs and
 * exotic shell syntax are outside the scanner's vocabulary: on an
 * unbalanced end state the caller falls back to the verbatim path
 * (ADR-0077 §7 give-up), never a mangled split.
 */
function topLevelSemis(s: string): number[] | undefined {
	const pos: number[] = [];
	let depth = 0;
	let quote: string | undefined;
	for (let i = 0; i < s.length; i++) {
		const ch = s[i]!;
		if (quote !== undefined) {
			if (ch === '\\') i++;
			else if (ch === quote) quote = undefined;
			continue;
		}
		if (ch === '"' || ch === "'" || ch === '\u0060') quote = ch;
		else if (ch === '(' || ch === '[') depth++;
		else if (ch === ')' || ch === ']') depth = Math.max(0, depth - 1);
		else if (ch === ';' && depth === 0) pos.push(i);
	}
	return quote !== undefined || depth !== 0 ? undefined : pos;
}

/**
 * Split a decoded command into top-level `;`-terminated statements;
 * undefined when the scanner cannot vouch for the structure (gate).
 */
function splitStatements(cmd: string): string[] | undefined {
	const semis = topLevelSemis(cmd);
	if (semis === undefined) return undefined;
	const stmts: string[] = [];
	let start = 0;
	for (const i of semis) {
		const seg = cmd.slice(start, i + 1).trim();
		if (seg !== '') stmts.push(seg);
		start = i + 1;
	}
	const tail = cmd.slice(start).trim();
	if (tail !== '') stmts.push(tail.endsWith(';') ? tail : tail + ';');
	return stmts;
}

/**
 * Decode a double-quoted JS string literal body (JSON.parse in try/catch
 * — malformed escapes keep the literal verbatim); undefined on failure.
 */
function decodeJsString(body: string): string | undefined {
	try {
		return JSON.parse('"' + body + '"') as string;
	} catch {
		return undefined;
	}
}

/**
 * Display copy for a run_code program (ADR-0077 D1–D2): each single-line
 * `command: "…"` literal whose decoded value has no newline, backtick, or
 * `${` re-renders as a backtick multi-line template literal split at
 * top-level `;`. Everything else — gated values, multi-line or backtick
 * commands already, non-command code, garbage — returns unchanged. Pure,
 * never throws, and the WIRE copy it derives from is never touched.
 */
export function displayCode(code: string): string {
	const re = /command\s*:\s*"((?:[^"\\\n]|\\.)*)"/g;
	let out = '';
	let last = 0;
	for (let m = re.exec(code); m !== null; m = re.exec(code)) {
		const decoded = decodeJsString(m[1]!);
		if (decoded === undefined) continue;
		// The gate (D2): anything the template form could mangle stays verbatim.
		if (decoded.includes('\n') || decoded.includes('\u0060') || decoded.includes('${')) continue;
		const stmts = splitStatements(decoded);
		if (stmts === undefined) continue;
		out += code.slice(last, m.index) + 'command: \u0060\n' + stmts.map((s) => '\t' + s).join('\n') + '\n\u0060';
		last = m.index + m[0].length;
	}
	if (last === 0) return code;
	return out + code.slice(last);
}

/**
 * Peek/strip argument copy (ADR-0077 D3): shell command args cut at the
 * last top-level `;` STRICTLY BEFORE the cap — one line that still ends
 * at a statement boundary; everything else (paths, patterns, short args,
 * boundary-less commands) keeps the plain cap. One line guaranteed.
 */
export function previewArg(tool: string, arg: string, cap: number): string {
	if (tool !== 'bash' && tool !== 'pwsh') return capText(arg, cap);
	if (arg.length <= cap) return arg;
	const semis = topLevelSemis(arg);
	const before = semis === undefined ? [] : semis.filter((i) => i < cap);
	if (before.length === 0) return capText(arg, cap);
	return arg.slice(0, before[before.length - 1]! + 1) + '…';
}

/**
 * D5 (ADR-0077 Amendment 1): the tool-argument language map. `code`
 * arguments are JavaScript — their single-line literals are the display
 * targets Prettier formats (via prettify-code.ts, async). Bash keeps the
 * D1 splitter; every other key stays verbatim. The WIRE is never touched.
 */

/** A single-line `code:` literal — double-quoted or backtick (escaped chars OK). */
function codeArgRe(): RegExp {
	return /code\s*:\s*(?:"((?:[^"\\\n]|\\.)*)"|\u0060((?:[^\u0060\\]|\\.)*)\u0060)/g;
}

/** Decode a matched literal body; undefined when escapes are malformed. */
function decodeArgValue(quote: '"' | '\u0060', body: string): string | undefined {
	try {
		if (quote === '"') return JSON.parse('"' + body + '"') as string;
		return body.replace(/\\([\s\S])/g, (_m, ch: string) => (ch === 'n' ? '\n' : ch === 't' ? '\t' : ch));
	} catch {
		return undefined;
	}
}

/**
 * Decoded single-line `code:` values in the program, source order, unique —
 * the targets Prettier formats. Multi-line values are already readable and
 * stay verbatim (D2); empty/garbage values are skipped. Pure, never throws.
 */
export function codeArgTargets(programCode: string): string[] {
	const targets: string[] = [];
	const re = codeArgRe();
	for (let m = re.exec(programCode); m !== null; m = re.exec(programCode)) {
		const dq = m[1] !== undefined;
		const body = (dq ? m[1] : m[2])!;
		const decoded = decodeArgValue(dq ? '"' : '\u0060', body);
		if (decoded === undefined || decoded.trim() === '' || decoded.includes('\n')) continue;
		if (!targets.includes(decoded)) targets.push(decoded);
	}
	return targets;
}

/**
 * Splice Prettier output back over its `code:` literals — each matching
 * literal whose decoded value has a formatted copy in `pretty` re-renders
 * as a braced block (TS-valid for highlighting). Unmapped literals and an
 * empty map return the input unchanged; the wire copy is never touched.
 */
export function splicePrettified(programCode: string, pretty: Map<string, string>): string {
	if (pretty.size === 0) return programCode;
	const re = codeArgRe();
	let out = '';
	let last = 0;
	let changed = false;
	for (let m = re.exec(programCode); m !== null; m = re.exec(programCode)) {
		const dq = m[1] !== undefined;
		const body = (dq ? m[1] : m[2])!;
		const decoded = decodeArgValue(dq ? '"' : '\u0060', body);
		const prettyText = decoded === undefined ? undefined : pretty.get(decoded);
		if (prettyText === undefined) continue;
		const block = 'code: {\n' + prettyText.trimEnd().split('\n').map((l) => '\t' + l).join('\n') + '\n}';
		out += programCode.slice(last, m.index) + block;
		last = m.index + m[0].length;
		changed = true;
	}
	return changed ? out + programCode.slice(last) : programCode;
}

/**
 * D6 (ADR-0077 Amendment 2): split a decoded command at top-level `&&` too.
 * Every continued line ends with `&& \` (shell line-continuation — the
 * display copy stays copy-paste-runnable); the last segment keeps its `;`.
 * Undefined when the scanner cannot vouch for the structure (gate).
 */
function splitStatementLines(statement: string): string[] | undefined {
	const hadSemi = statement.endsWith(';');
	const body = hadSemi ? statement.slice(0, -1) : statement;
	const parts: string[] = [];
	let depth = 0;
	let quote: string | undefined;
	let start = 0;
	for (let i = 0; i < body.length; i++) {
		const ch = body[i]!;
		if (quote !== undefined) {
			if (ch === '\\') i++;
			else if (ch === quote) quote = undefined;
			continue;
		}
		if (ch === '"' || ch === "'" || ch === '\u0060') quote = ch;
		else if (ch === '(' || ch === '[') depth++;
		else if (ch === ')' || ch === ']') depth = Math.max(0, depth - 1);
		else if (ch === '&' && body[i + 1] === '&' && depth === 0) {
			const seg = body.slice(start, i).trim();
			if (seg === '') return undefined; // dangling && — outside the vocabulary
			parts.push(seg);
			start = i + 2;
			i++;
		}
	}
	if (quote !== undefined || depth !== 0) return undefined;
	const tail = body.slice(start).trim();
	if (tail === '') return parts.length > 0 ? undefined : [statement]; // trailing && — gate
	parts.push(tail);
	if (parts.length <= 1) return [statement]; // no top-level && — keep the statement as-is
	return parts.map((p, idx) => (idx === parts.length - 1 ? p + (hadSemi ? ';' : '') : p + ' && \\'));
}

/** A single-line `new_string`/`content` literal (double-quoted or backtick). */
function longValueRe(): RegExp {
	return /(new_string|content)\s*:\s*(?:"((?:[^"\\\n]|\\.)*)"|\u0060((?:[^\u0060\\]|\\.)*)\u0060)/g;
}

/**
 * D6: the display-value pipeline over the whole program — bash `command`
 * values (double-quoted AND backtick, single-line) split at top-level `;`
 * and `&&` (every continued line ends `&& \`); `new_string`/`content`
 * escaped newlines expand to real newlines (the code pane is already a
 * `<pre><code>` element). Values that are already multi-line, or that the
 * scanner cannot vouch for, stay verbatim. Pure, never throws; the WIRE
 * copy is never touched. Pair with prettifyProgram for param layout.
 */
export function expandDisplayValues(code: string): string {
	let out = '';
	let last = 0;
	let changed = false;

	const cmdRe = /command\s*:\s*(?:"((?:[^"\\\n]|\\.)*)"|\u0060((?:[^\u0060\\]|\\.)*)\u0060)/g;
	for (let m = cmdRe.exec(code); m !== null; m = cmdRe.exec(code)) {
		const dq = m[1] !== undefined;
		const decoded = decodeArgValue(dq ? '"' : '\u0060', (dq ? m[1] : m[2])!);
		if (decoded === undefined || decoded.trim() === '') continue;
		// Gate: already multi-line, or a value the template form could mangle.
		if (decoded.includes('\n') || decoded.includes('\u0060') || decoded.includes('${')) continue;
		const stmts = splitStatements(decoded);
		if (stmts === undefined) continue;
		const lines: string[] = [];
		let viable = true;
		for (const stmt of stmts) {
			const parts = splitStatementLines(stmt);
			if (parts === undefined) {
				viable = false;
				break;
			}
			lines.push(...parts);
		}
		if (!viable || lines.length <= 1) continue; // single line gains nothing — verbatim
		out += code.slice(last, m.index) + 'command: \u0060\n' + lines.map((l) => '\t' + l).join('\n') + '\n\u0060';
		last = m.index + m[0].length;
		changed = true;
	}

	code = changed ? out + code.slice(last) : code;

	// new_string / content: expand escaped newlines to real ones.
	const valRe = longValueRe();
	out = '';
	last = 0;
	changed = false;
	for (let m = valRe.exec(code); m !== null; m = valRe.exec(code)) {
		const dq = m[2] !== undefined;
		let decoded = decodeArgValue(dq ? '"' : '\u0060', (dq ? m[2] : m[3])!);
		if (decoded === undefined || decoded.trim() === '') continue;
		if (!decoded.includes('\n') && /\\n/.test(decoded)) {
			// Legacy double-escape: the harness encoded the value once more, so
			// execution decoded these literal \n to real newlines — the display
			// copy shows what execution saw (D6 value rule, legacy pass).
			decoded = decoded.replace(/\\n/g, '\n');
		}
		if (!decoded.includes('\n')) continue; // single-line value gains nothing
		if (decoded.includes('${') || decoded.includes('\u0060')) continue; // the template form could mangle it
		out += code.slice(last, m.index) + (m[1] ?? 'content') + ': \u0060' + decoded + '\u0060';
		last = m.index + m[0].length;
		changed = true;
	}
	return changed ? out + code.slice(last) : code;
}

/** True for the run_code wire tool name (the card's one family member). */
export function isRunCodeTool(toolName: string): boolean {
	return toolName === 'run_code';
}

/**
 * Strip label for one step: the chip variant title (Bash/Read/…);
 * unknown names (todo_write & friends) keep their raw name — the strip
 * is derived from code, hiding a known name loses information.
 */
export function planStepTitle(tool: string): string {
	const title = toolTitle(tool);
	return title === 'Tool call' ? tool : title;
}

/**
 * The arguments object text following tools.NAME( at openParen —
 * balanced braces with string awareness (double/single/backtick,
 * escaped chars). Undefined when the object never closes or does not
 * start with '{' (e.g. a variable indirection — not in the grammar).
 */
function argsObjectAfter(source: string, openParen: number): string | undefined {
	let i = openParen + 1;
	while (i < source.length && /\s/.test(source[i]!)) i++;
	if (source[i] !== '{') return undefined;
	const start = i + 1;
	let depth = 1;
	let quote: '\"' | '\'' | '\u0060' | undefined;
	while (i < source.length) {
		i++;
		const ch = source[i];
		if (quote !== undefined) {
			if (ch === '\\') i++;
			else if (ch === quote) quote = undefined;
			continue;
		}
		if (ch === '\"' || ch === '\'' || ch === '\u0060') quote = ch;
		else if (ch === '{') depth++;
		else if (ch === '}') {
			depth--;
			if (depth === 0) return source.slice(start, i);
		}
	}
	return undefined;
}

/**
 * Salient argument from an args-object literal: the tool's preferred
 * key, else the generic ladder — quoted with ', ", or a backtick.
 * path renders as its basename (the chip grammar); commands and
 * patterns keep their FIRST line only. Capping is a display choice
 * and lives at the surfaces (CodeCard strip 60, peek 120), not here.
 */
function salientArg(tool: string, argsText: string): string | undefined {
	for (const key of SALIENT_BY_TOOL[tool] ?? SALIENT_KEYS) {
		const m = argsText.match(new RegExp(key + '\\s*:\\s*([\"\'\u0060])([\\s\\S]*?)\\1'));
		if (m === null) continue;
		if (key === 'path') return m[2]!.split('/').pop() ?? m[2];
		return m[2]!.split(/\\n|\n/)[0]!;
	}
	return undefined;
}

/** Scan the program for tools.NAME({…}) calls, source order, bounded. */
function scanToolPlan(code: string): CodeToolStep[] {
	const plan: CodeToolStep[] = [];
	const re = /tools\.([a-z_]+)\s*\(/g;
	for (let m = re.exec(code); m !== null; m = re.exec(code)) {
		const argsText = argsObjectAfter(code, m.index + m[0].length - 1);
		if (argsText === undefined) continue;
		const arg = salientArg(m[1]!, argsText);
		plan.push({ tool: m[1]!, ...(arg !== undefined ? { arg } : {}) });
		if (plan.length >= MAX_PLAN_STEPS) break;
	}
	return plan;
}

/**
 * One-line peek preview for a run_code program (ADR-0008): the
 * description, else the first plan step (chip title + salient arg),
 * else the first code line — never the escaped code head. Empty
 * string when nothing parses; the caller falls back to the raw
 * preview for full honesty.
 */
export function codeProgramPreview(argsRaw: string | undefined): string {
	const program = parseCodeProgram(argsRaw);
	if (program === undefined) return '';
	if (program.description !== undefined) return peekCap(program.description);
	const first = program.plan[0];
	if (first !== undefined) {
		return planStepTitle(first.tool) + (first.arg !== undefined ? ' ' + previewArg(first.tool, first.arg, PEEK_CAP) : '');
	}
	return peekCap(program.code.split('\n')[0]!.trim());
}

/**
 * Parse run_code args into a CodeProgram; undefined when junk or the
 * code member is missing — the caller renders the raw view then.
 */
export function parseCodeProgram(argsRaw: string | undefined): CodeProgram | undefined {
	if (argsRaw === undefined) return undefined;
	let parsed: unknown;
	try {
		parsed = JSON.parse(argsRaw);
	} catch {
		return undefined;
	}
	if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined;
	const o = parsed as Record<string, unknown>;
	if (typeof o.code !== 'string' || o.code.length === 0) return undefined;
	return {
		code: o.code,
		...(typeof o.description === 'string' && o.description !== '' ? { description: o.description } : {}),
		plan: scanToolPlan(o.code)
	};
}
