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
		return planStepTitle(first.tool) + (first.arg !== undefined ? ' ' + peekCap(first.arg) : '');
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
