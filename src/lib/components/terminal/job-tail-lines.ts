/**
 * job-tail-lines — the PURE tail model behind JobTail (ADR-0035 D6):
 * follower frames become bounded lines; a lossy output frame inserts one
 * honest eviction seam that is never swallowed. No Svelte here — the
 * component renders, this decides.
 */
import type { DsiJobFollowEvent } from '$lib/types';

export const EVICTION_SEAM = '…earlier output evicted…';

export interface TailState {
	lines: string[];
	settled: boolean;
	/** The settled projection's status word (set when settled). */
	status: string | null;
	error: string | null;
}

export function emptyTail(): TailState {
	return { lines: [], settled: false, status: null, error: null };
}

/** Split one output blob into lines, carrying a partial tail forward. */
export function applyFollowEvent(state: TailState, event: DsiJobFollowEvent, maxLines = 2000): TailState {
	if (event.type === 'output') {
		let lines = state.lines;
		if (event.lossy === true) {
			lines = state.lines.length > 0 && state.lines[state.lines.length - 1] === EVICTION_SEAM
				? lines
				: [...lines, EVICTION_SEAM];
		}
		const pieces = event.text.split('\n');
		const next = [...lines];
		for (let i = 0; i < pieces.length; i++) {
			if (i === 0) {
				const last = next[next.length - 1];
				if (last === undefined || last === EVICTION_SEAM) {
					if (pieces[0] !== '') next.push(pieces[0]);
				} else {
					next[next.length - 1] = last + pieces[0];
				}
			} else {
				next.push(pieces[i]);
			}
		}
				return { ...state, lines: next.length > maxLines ? next.slice(next.length - maxLines) : next };
	}
	if (event.type === 'status') {
		return { ...state, settled: true, status: event.job.status };
	}
	if (event.type === 'error') {
		return { ...state, error: (event.code ?? 'error') + (event.message ? ': ' + event.message : '') };
	}
	return state;
}

/**
 * formatCommandLines (2026-10-21 operator DX): a job's command is a shell
 * one-liner OR a multi-line script — separators are ';' AND newlines, and
 * every command renders as its OWN line. Loop/if blocks read as code:
 * header (for/while/until/if … do/then), indented body, dedented end
 * (done/fi). Pure text shaping — no shell.
 */
export function formatCommandLines(command: string): string[] {
	const raw = command
		.replace(/\\n/g, '\n') // labels carry LITERAL \n escapes (JSON), not newlines
		.split(/[;\n]/)
		.map((piece) => piece.trim())
		.filter((piece) => piece.length > 0);
	// a lone 'do' / 'then' after a split belongs to the HEADER before it
	// ('for x in a b; do' is one header, not two commands)
	const pieces: string[] = [];
	for (const piece of raw) {
		const prev = pieces[pieces.length - 1];
		if (prev !== undefined && /^(do|then)(\s|$)/.test(piece)) {
			// 'do' / 'then' CLOSES the header; whatever rides after it on the
			// one-liner is the first BODY command and gets its own piece
			pieces[pieces.length - 1] = prev + '; ' + piece.split(/\s+/)[0];
			const rest = piece.slice(piece.split(/\s+/)[0].length).trim();
			if (rest.length > 0) pieces.push(rest);
		} else if (/^else(\s|$)/.test(piece)) {
			// 'else' stands alone at body level; its body splits off
			pieces.push('else');
			const rest = piece.slice(4).trim();
			if (rest.length > 0) pieces.push(rest);
		} else {
			pieces.push(piece);
		}
	}
	const lines: string[] = [];
	let indent = 0;
	const pad = (): string => '  '.repeat(Math.max(0, indent));
	for (const piece of pieces) {
		// a block END dedents before it prints
		if (/^(done|fi|else|elif\b)/.test(piece)) indent -= 1;
		// 'a && b && c' chains read one command per line; every line but
		// the last carries the REQUIRED bash continuation backslash
		const chain = piece.split(' && ');
		for (let ci = 0; ci < chain.length; ci++) {
			const last = ci === chain.length - 1;
			lines.push(pad() + chain[ci] + (last ? '' : ' && \\'));
		}
		// a block HEADER (for/while/until … do | if … then) opens a body
		if (/\bdo$/.test(piece) || /\bthen$/.test(piece) || /^else$/.test(piece)) indent += 1;
	}
	return lines;
}

/**
 * explainFollowError (2026-10-21, evidence-corrected): the host registry
 * DROPS a job's record when its owning agent scope disposes (jobs-local
 * disposeOwned → drop → 'removed'), after which any follow answers
 * 'unknown job'. Render that as the honest end state — the record, and
 * its output ring with it, is gone from the host.
 */
export function explainFollowError(error: string | null): string | null {
	if (error === null) return null;
	if (/unknown job/i.test(error)) return 'job record dropped by the host (owner scope disposed) — output unrecoverable';
	return 'follow failed — ' + error;
}
