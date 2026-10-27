/**
 * dsh-events unit tests — pure mapping rules.
 *
 * Paired with task 1.1/1.1-T (tool-truth fields: time, argsRaw, status,
 * resultText) and 1.2/1.2-T (merge lifecycle: pending→pass/fail by callId,
 * durationMs from paired event times) of POC-2 Wave 1.
 *
 * Every wire shape asserted below is live-probed 2026-08-21 against
 * dsh web 0.1.0-rc.8 (session-d0f0c628 / session-2b621883) or verified in
 * the harness sources (core/session/src/types.ts SessionEventMap).
 * Tests deliberately use probe-captured shapes, not invented ones.
 */

import { describe, expect, it } from 'vitest';
import type { DsiEntry } from '$lib/types';
import {
	collapseSystemPromptEntries,
	entryForEvent,
	eventsToEntries,
	mergeEntries,
	type DshRawEvent
} from '$lib/services/conversation/dsh-events';

/** 2026-08-21 live capture: user/message (seq 11, session-d0f0c628). */
const userMessageEvent: DshRawEvent = {
	type: 'user/message',
	seq: 11,
	time: 1787252720796,
	data: {
		content: [{ type: 'text', text: 'Hi' }],
		source: { kind: 'user', rpcId: '31f74243-88a0-4fd3-ac9c-4a6122a3f2da', clientTimeZone: 'Asia/Singapore' },
		role: 'user',
		id: '28af20be-5a3a-43d3-bd60-88a601b7eb8e'
	}
};

/** Helper: finalized assistant/message at seq (live shape: message.content
 * blocks — reasoning block is authoritative since Wave 2 task 2.3). */
function finalized(seq: number, text: string): DshRawEvent {
	return {
		type: 'assistant/message',
		seq,
		time: 1787252726999,
		data: {
			turn: 2,
			step: 1,
			message: {
				role: 'assistant',
				content: [
					{ type: 'reasoning', text: '(internal reasoning — final block, authoritative)' },
					{ type: 'text', text }
				]
			}
		}
	};
}

/** Helper: durable assistant/chunk at seq — RETIRED by ledger v2 (kept as
 *  a fall-through fixture). */
function delta(seq: number, text: string): DshRawEvent {
	return {
		type: 'assistant/chunk',
		seq,
		time: 1787252725510 + seq,
		data: { turn: 2, step: 1, chunk: { type: 'text-delta', index: 1, text } }
	};
}

/** Helper: a live-tail-shaped streaming bubble for one step (the only
 * producer of `streaming: true` entries since ledger v2 — the store's
 * applyLiveStream, fed by the connection's assistant-stream tail). */
function streamingBubble(text: string, reasoning?: string): DsiEntry {
	return {
		kind: 'assistant-message',
		id: 'a:2:1',
		seq: 15,
		time: 1787252725510,
		text,
		streaming: true,
		...(reasoning !== undefined ? { reasoning, reasoningStreaming: true } : {})
	};
}

/** 2026-08-21 live capture: tool/call (seq 271, session-2b621883) with view title. */
const toolCallEvent: DshRawEvent = {
	type: 'tool/call',
	seq: 271,
	time: 1787212572959,
	data: { turn: 3, step: 1, callId: 'call_abf1c2bdf65449f68c2c4dea', name: 'grep', arguments: '{"pattern":"glm-5","path":"/Users/wharsojo/agentic-ai/deepseek-harness"}' },
	view: { for: 'call', view: { card: 'generic', title: 'Grep glm-5 in /Users/wharsojo/agentic-ai/deepseek-harness', kind: 'search', rawInput: 'glm-5' } }
};

/** 2026-08-21 live capture: tool/result (seq 272) paired to the call above. */
const toolResultEvent: DshRawEvent = {
	type: 'tool/result',
	seq: 272,
	time: 1787212573440,
	data: {
		turn: 3,
		step: 1,
		message: {
			source: { kind: 'tool', callId: 'call_abf1c2bdf65449f68c2c4dea' },
			content: [
				{
					type: 'tool-result',
					toolCallId: 'call_abf1c2bdf65449f68c2c4dea',
					content: [{ type: 'text', text: 'No matches found' }],
					isError: false
				}
			],
			role: 'user',
			id: '49ef6f77-acac-4945-95f2-b634f794a682'
		},
		meta: { shape: 'matches', files: [], truncated: false, total: 0 }
	},
	sourceEventSeqs: [271],
	surfaceOp: 'append'
} as DshRawEvent & { sourceEventSeqs: number[] };

/** 1787212573440 − 1787212572959 — the durationMs the live pair pins. */
const PAIR_DURATION_MS = 481;

/** Helper: an error tool/result paired to the call above (isError: true). */
function errorResultEvent(seq: number, time: number, callId = 'call_abf1c2bdf65449f68c2c4dea'): DshRawEvent {
	return {
		type: 'tool/result',
		seq,
		time,
		data: {
			turn: 3,
			step: 1,
			message: {
				source: { kind: 'tool', callId },
				content: [
					{
						type: 'tool-result',
						toolCallId: callId,
						content: [{ type: 'text', text: 'boom: path not found' }],
						isError: true
					}
				],
				role: 'user',
				id: `err-${seq}`
			}
		}
	};
}

/** Filter nulls from mapped entries. */
function nonNull(e: DsiEntry | null): e is DsiEntry {
	return e !== null;
}

describe('entryForEvent — user/message', () => {
	it('maps a live-captured user/message to a user-message bubble (time from event.time)', () => {
		const entry = entryForEvent(userMessageEvent);
		expect(entry).toEqual({
			kind: 'user-message',
			id: 'u:28af20be-5a3a-43d3-bd60-88a601b7eb8e',
			seq: 11,
			time: 1787252720796,
			text: 'Hi'
		});
	});

	it('joins multiple text parts with newlines', () => {
		const entry = entryForEvent({
			...userMessageEvent,
			data: { ...userMessageEvent.data, content: [{ type: 'text', text: 'line 1' }, { type: 'text', text: 'line 2' }] }
		});
		expect(entry?.kind === 'user-message' && entry.text).toBe('line 1\nline 2');
	});

	it('falls back to a seq-keyed id when the harness id is absent', () => {
		const entry = entryForEvent({ type: 'user/message', seq: 5, time: 1, data: { content: [{ type: 'text', text: 'x' }] } });
		expect(entry?.kind === 'user-message' && entry.id).toBe('u:seq:5');
	});

	// ── task 2.4-T detection pins (added in W4: the e2e found the detector
	// existed but was never wired into the user/message case — a plain bubble
	// rendered where the contract promised a chip; these pin the fixed path). ──
	it('2.4-T: runtime-context marker (plugin+form+prefix) flags meta, text verbatim', () => {
		const entry = entryForEvent({
			type: 'user/message',
			seq: 12,
			time: 1787252725500,
			data: {
					id: 'rc-1',
					source: { kind: 'plugin', plugin: '@deepseek-ai/dsh-system-prompt', form: 'snapshot', sections: ['env'] },
					content: [{ type: 'text', text: 'Current runtime context. cwd /tmp; agent research; 2 sessions open.' }]
			}
		});
		expect(entry).toEqual({
			kind: 'user-message',
			id: 'u:rc-1',
			seq: 12,
			time: 1787252725500,
			text: 'Current runtime context. cwd /tmp; agent research; 2 sessions open.',
			meta: 'runtime-context',
			// POC-3 W2 (2.4): the chip's digest input — wire source verbatim.
			metaSource: { kind: 'plugin', plugin: '@deepseek-ai/dsh-system-prompt', form: 'snapshot', sections: ['env'] }
		});
	});

	it('2.4-T revised 2026-08-31: tailored producers stay structural; everything else falls through honestly', () => {
		// A sibling plugin is still injected context — the generic 'plugin'
		// chip, never the tailored runtime-context chip (live-pinned:
		// user-approval shares the kind but not plugin+form).
		const sibling = entryForEvent({
			type: 'user/message',
			seq: 13,
			time: 1,
			data: {
					id: 'ap-1',
					source: { kind: 'plugin', plugin: '@deepseek-ai/dsh-user-approval', form: 'question' },
					content: [{ type: 'text', text: 'Current runtime context. (imposter text)' }]
			}
		});
		expect(sibling && sibling.kind === 'user-message' && sibling.meta).toBe('plugin');

		// Structural marker but missing form → not the tailored snapshot chip;
		// the plugin family still claims it generically.
		const noForm = entryForEvent({
			type: 'user/message',
			seq: 14,
			time: 1,
			data: {
					id: 'nf-1',
					source: { kind: 'plugin', plugin: '@deepseek-ai/dsh-system-prompt' },
					content: [{ type: 'text', text: 'Current runtime context.' }]
			}
		});
		expect(noForm && noForm.kind === 'user-message' && noForm.meta).toBe('plugin');

		// Plain user text mentioning the words → normal bubble (no source).
		const plain = entryForEvent({
			type: 'user/message',
			seq: 15,
			time: 1,
			data: { id: 'pl-1', content: [{ type: 'text', text: 'Current runtime context. says who' }] }
		});
		expect(plain && plain.kind === 'user-message' && plain.meta).toBeUndefined();
	});
});

describe('entryForEvent — retired chunk type and finalize', () => {
	it('a durable assistant/chunk (retired by ledger v2) falls through as an unknown-event chip', () => {
		// v2 hosts never emit it; if one somehow arrives it renders honestly
		// (passthrough default) instead of a chunk bubble. Live text rides
		// the connection's assistant-stream tail, never this mapper.
		const entry = entryForEvent(delta(19, 'Hi'));
		expect(entry).toEqual({
			kind: 'unknown-event',
			id: 'ev:19',
			seq: 19,
			time: 1787252725529,
			eventType: 'assistant/chunk',
			// 2026-09-18 empty-popup fix: the verbatim data rides the entry.
			payload: { chunk: { index: 1, text: 'Hi', type: 'text-delta' }, step: 1, turn: 2 }
		});
	});

	it('2.3-T pin flip: assistant/message finalize extracts the reasoning block as authoritative beside text', () => {
		// v1 pinned "text blocks only (reasoning ignored)". Wave 2 task 2.3:
		// the final message's {type:'reasoning'} block is wire truth — it
		// rides on the finalized entry and replaces any streamed prefix.
		const entry = entryForEvent(finalized(142, 'Hi! Ready to help.'));
		expect(entry).toEqual({
			kind: 'assistant-message',
			id: 'a:2:1',
			seq: 142,
			time: 1787252726999,
			text: 'Hi! Ready to help.',
			streaming: false,
			reasoning: '(internal reasoning — final block, authoritative)',
			reasoningStreaming: false
		});
	});

	// ── Usage capture (2026-08-23): assistant/message data.usage → entry.usage ──

	it('assistant/message with usage carries it on the entry (wire TokenUsage)', () => {
		const withUsage: DshRawEvent = {
			...finalized(160, 'Used some context.'),
			data: {
				turn: 2,
				step: 1,
				message: { role: 'assistant', content: [{ type: 'text', text: 'Used some context.' }] },
				usage: { inputTokens: 12_000, outputTokens: 340, cacheReadTokens: 8_000, cacheWriteTokens: 500 }
			}
		};
		const entry = entryForEvent(withUsage);
		if (entry === null || entry.kind !== 'assistant-message') throw new Error('expected assistant-message');
		expect(entry.usage).toEqual({
			inputTokens: 12_000,
			outputTokens: 340,
			cacheReadTokens: 8_000,
			cacheWriteTokens: 500
		});
	});

	it('usage without optional cache fields keeps them absent; absent usage stays undefined', () => {
		const minimal: DshRawEvent = {
			...finalized(161, 'Minimal.'),
			data: {
				turn: 2,
				step: 1,
				message: { role: 'assistant', content: [{ type: 'text', text: 'Minimal.' }] },
				usage: { inputTokens: 5, outputTokens: 6 }
			}
		};
		const minimalEntry = entryForEvent(minimal);
		if (minimalEntry === null || minimalEntry.kind !== 'assistant-message') throw new Error('expected assistant-message');
		expect(minimalEntry.usage).toEqual({ inputTokens: 5, outputTokens: 6 });

		const bare = entryForEvent(finalized(162, 'No accounting.'));
		if (bare === null || bare.kind !== 'assistant-message') throw new Error('expected assistant-message');
		expect(bare.usage).toBeUndefined();
	});

	it('malformed usage (non-numeric input) declines to undefined — never a broken entry', () => {
		const bad: DshRawEvent = {
			...finalized(163, 'Bad usage.'),
			data: {
				turn: 2,
				step: 1,
				message: { role: 'assistant', content: [{ type: 'text', text: 'Bad usage.' }] },
				usage: { inputTokens: 'lots', outputTokens: 3 }
			}
		};
		const entry = entryForEvent(bad);
		if (entry === null || entry.kind !== 'assistant-message') throw new Error('expected assistant-message');
		expect(entry.usage).toBeUndefined();
		expect(entry.text).toBe('Bad usage.');
	});

	it('a finalized message WITHOUT a reasoning block carries no reasoning key (streamed reasoning survives merge)', () => {		const noReasoning: DshRawEvent = {
			...finalized(150, 'Plain.'),
			data: { turn: 2, step: 1, message: { role: 'assistant', content: [{ type: 'text', text: 'Plain.' }] } }
		};
		const entry = entryForEvent(noReasoning);
		expect(entry).toEqual({
			kind: 'assistant-message',
			id: 'a:2:1',
			seq: 150,
			time: 1787252726999,
			text: 'Plain.',
			streaming: false
		});
	});
});

describe('entryForEvent — tool calls and results', () => {
	it('tool/call maps with callId, name, view-title summary, raw args, and pending status', () => {
		const entry = entryForEvent(toolCallEvent);
		expect(entry).toEqual({
			kind: 'tool-call',
			id: 'tc:call_abf1c2bdf65449f68c2c4dea',
			seq: 271,
			time: 1787212572959,
			callId: 'call_abf1c2bdf65449f68c2c4dea',
			toolName: 'grep',
			summary: 'Grep glm-5 in /Users/wharsojo/agentic-ai/deepseek-harness',
			argsRaw: '{"pattern":"glm-5","path":"/Users/wharsojo/agentic-ai/deepseek-harness"}',
			status: 'pending'
		});
	});

	it('tool/call without a view falls back to truncated raw arguments', () => {
		const longArgs = '{"pattern":"' + 'x'.repeat(200) + '"}';
		const entry = entryForEvent({ type: 'tool/call', seq: 9, time: 1, data: { turn: 1, step: 1, callId: 'c1', name: 'grep', arguments: longArgs } });
		expect(entry?.kind === 'tool-call' && entry.summary).toBe(`${longArgs.slice(0, 120)}…`);
	});

	it('1.1-T: argsRaw is the wire arguments verbatim (BC-11 trace), never truncated', () => {
		const longArgs = '{"pattern":"' + 'x'.repeat(200) + '"}';
		const entry = entryForEvent({ type: 'tool/call', seq: 9, time: 42, data: { turn: 1, step: 1, callId: 'c1', name: 'grep', arguments: longArgs } });
		expect(entry?.kind === 'tool-call' && entry.argsRaw).toBe(longArgs);
		expect(entry?.kind === 'tool-call' && entry.time).toBe(42);
	});

	it('tool/call without arguments stays expandable-optional: argsRaw undefined, still pending', () => {
		const entry = entryForEvent({ type: 'tool/call', seq: 9, time: 1, data: { turn: 1, step: 1, callId: 'c2', name: 'clock' } });
		expect(entry).toEqual({
			kind: 'tool-call',
			id: 'tc:c2',
			seq: 9,
			time: 1,
			callId: 'c2',
			toolName: 'clock',
			summary: undefined,
			argsRaw: undefined,
			status: 'pending'
		});
	});

	it('tool/result maps ok + resultText + time and pairs by callId at merge time', () => {
		const entry = entryForEvent(toolResultEvent);
		expect(entry).toMatchObject({
			kind: 'tool-result',
			id: 'tr:call_abf1c2bdf65449f68c2c4dea',
			seq: 272,
			time: 1787212573440,
			callId: 'call_abf1c2bdf65449f68c2c4dea',
			ok: true,
			summary: 'No matches found',
			resultText: 'No matches found'
		});
	});

	it('1.1-T: resultText is the wire tool-result block content (isError carries ok)', () => {
		const entry = entryForEvent(errorResultEvent(300, 5000));
		expect(entry).toMatchObject({
			kind: 'tool-result',
			seq: 300,
			time: 5000,
			ok: false,
			resultText: 'boom: path not found',
			summary: 'boom: path not found'
		});
	});

	it('tool/result with isError:true maps ok:false', () => {
		const entry = entryForEvent({
			...toolResultEvent,
			data: {
				turn: 3,
				step: 1,
				message: {
					source: { kind: 'tool', callId: 'c9' },
					content: [{ type: 'tool-result', toolCallId: 'c9', content: [{ type: 'text', text: 'boom' }], isError: true }],
					role: 'user',
					id: 'm9'
				}
			}
		});
		expect(entry?.kind === 'tool-result' && entry.ok).toBe(false);
	});

	// ── The Honest Red Chip (ADR 2026-10-26, D3): the fixture below is CUT
	// from a real ledger — session-39cad48f seq 850, the failed SubagentPopup
	// edit program — not hand-shaped. It FAILS on the pre-fix mapper
	// (probe 2026-10-26: ok=true, status='pass') — that failure is the gate.
	const ledgerFailResult: DshRawEvent = {
		type: 'tool/result',
		seq: 850,
		time: 1792971912000,
		data: {
			turn: 6,
			step: 31,
			message: {
				role: 'tool',
				source: { kind: 'tool', callId: 'call_8a60834f82734082b406d8be' },
				toolCallId: 'call_8a60834f82734082b406d8be',
				content: [
					{
						type: 'text',
						text: 'Error: code run failed (exception): ToolCallError: cannot modify "SubagentPopup.svelte": file has not been read — read the file before overwriting it'
					}
				],
				isError: true,
				id: 'wire-id'
			},
			error: { name: 'CodeRunFailedError', code: 'CODE_RUN_FAILED' }
		}
	};
	const ledgerCall: DshRawEvent = {
		type: 'tool/call',
		seq: 848,
		time: 1792971911000,
		data: {
			turn: 6,
			step: 31,
			callId: 'call_8a60834f82734082b406d8be',
			name: 'run_code',
			arguments: '{"code":"...","description":"edit popup"}'
		}
	};

	it('ledger-cut v4 failure (message.isError) maps ok:false', () => {
		const entry = entryForEvent(ledgerFailResult);
		expect(entry?.kind === 'tool-result' && entry.ok).toBe(false); // D1 seat (b)
	});

	it('ledger-cut v4 failure flips the paired call chip to fail', () => {
		const merged = eventsToEntries([ledgerCall, ledgerFailResult]);
		const call = merged.find((e) => e.kind === 'tool-call');
		expect(call && call.kind === 'tool-call' && call.status).toBe('fail');
	});

	it('ledger-cut v4 failure keeps the refusal text as resultText (D2 fallback)', () => {
		const merged = eventsToEntries([ledgerCall, ledgerFailResult]);
		const result = merged.find((e) => e.kind === 'tool-result');
		expect(result && result.kind === 'tool-result' && (result.resultText ?? '')).toContain('file has not been read');
	});

	it('data.error alone (no message.isError, no block) maps ok:false (D1 seat c)', () => {
		const entry = entryForEvent({
			...toolResultEvent,
			data: {
				turn: 3,
				step: 1,
				message: {
					source: { kind: 'tool', callId: 'c10' },
					content: [{ type: 'text', text: 'Error: code run failed (exception): boom' }],
					role: 'tool',
					id: 'm10'
				},
				error: { name: 'CodeRunFailedError', code: 'CODE_RUN_FAILED' }
			}
		});
		expect(entry?.kind === 'tool-result' && entry.ok).toBe(false);
	});

	it('success text that merely SAYS error stays ok:true — no text sniffing (AC4)', () => {
		const entry = entryForEvent({
			...toolResultEvent,
			data: {
				turn: 3,
				step: 1,
				message: {
					source: { kind: 'tool', callId: 'c11' },
					content: [{ type: 'text', text: '0 errors found in 12 files' }],
					role: 'tool',
					id: 'm11'
				}
			}
		});
		expect(entry?.kind === 'tool-result' && entry.ok).toBe(true);
	});
});

describe('entryForEvent — turn failure (2026-08-22 dead-turn bug)', () => {
		const deadTurn = {
			type: 'turn/end',
			seq: 25,
			time: 1787354250690,
			data: {
				turn: 2,
				reason: {
					kind: 'error',
					error: {
						message: 'llm-deepseek: no API key for provider route "deepseek-official"; store DEEPSEEK_API_KEY through the credentials service',
						code: 'MISSING_CREDENTIAL'
					}
				}
			}
		} satisfies DshRawEvent;

		it('turn/end reason.kind === error maps to a turn-error entry (message + code verbatim)', () => {
			const entry = entryForEvent(deadTurn);
			expect(entry).toEqual({
				kind: 'turn-error',
				id: 'te:25',
				seq: 25,
				time: 1787354250690,
				message: 'llm-deepseek: no API key for provider route "deepseek-official"; store DEEPSEEK_API_KEY through the credentials service',
				code: 'MISSING_CREDENTIAL'
			});
		});

		it('a SUCCESSFUL turn/end maps to a turn-lifecycle MARKER (Turn End Stamp ADR D1, 2026-09-25 — superseded the silence policy; still renders nothing)', () => {
			expect(entryForEvent({ type: 'turn/end', seq: 9, time: 1, data: { turn: 1, reason: { kind: 'stop' } } })).toMatchObject({ kind: 'turn-lifecycle', turn: 1, phase: 'end', reasonKind: 'stop' });
			expect(entryForEvent({ type: 'turn/end', seq: 10, time: 1, data: { turn: 1 } })).toMatchObject({ kind: 'turn-lifecycle', turn: 1, phase: 'end' });
		});

		it('an error turn/end without error.message still renders (fallback message, no code)', () => {
			const entry = entryForEvent({ type: 'turn/end', seq: 11, time: 1, data: { reason: { kind: 'error', error: {} } } });
			expect(entry).toEqual({ kind: 'turn-error', id: 'te:11', seq: 11, time: 1, message: 'turn ended with an error' });
		});

		it('eventsToEntries keeps turn-error beside the dead turn (cold load truth)', () => {
			const entries = eventsToEntries([
				{ type: 'user/message', seq: 7, time: 1, data: { id: 'u1', content: [{ type: 'text', text: 'load projects' }] } },
				deadTurn
			]);
			expect(entries.map((e) => e.kind)).toEqual(['user-message', 'turn-error']);
		});

		it('mergeEntries treats turn-error as append-only (idempotent retransmit)', () => {
			const one = entryForEvent(deadTurn)!;
			const merged = mergeEntries([one], [one]);
			expect(merged.filter((e) => e.kind === 'turn-error')).toHaveLength(1);
		});
	});

describe('entryForEvent — read-result presentation view (2026-08-22)', () => {
		const readView = {
			for: 'result',
			view: {
				card: 'read',
				path: '/Users/x/deepseek-insight/README.md',
				lang: 'md',
				offset: 1,
				totalLines: 3,
				lines: [
					{ number: 1, text: '# deepseek-insight' },
					{ number: 2, text: '' },
					{ number: 3, text: 'Reading the harness.' }
				]
			}
		};

		function resultEvent(view?: unknown): DshRawEvent {
			return {
				type: 'tool/result',
				seq: 40,
				time: 1040,
				data: {
					message: {
						source: { kind: 'tool', callId: 'c40' },
						content: [
							{
								type: 'tool-result',
								toolCallId: 'c40',
								content: [{ type: 'text', text: '<path>README.md</path>…' }]
							}
						]
					}
				},
				...(view !== undefined ? { view } : {})
			};
		}

		function hasReadView(e: DsiEntry | null): boolean {
			return e !== null && 'readView' in e && e.readView !== undefined;
		}

		it('a read card view normalizes onto the tool-result entry (path/lang/lines verbatim)', () => {
			const entry = entryForEvent(resultEvent(readView));
			expect(entry).toMatchObject({
				kind: 'tool-result',
			id: 'tr:c40',
				readView: {
						path: '/Users/x/deepseek-insight/README.md',
						lang: 'md',
					offset: 1,
						totalLines: 3,
						lines: [
							{ number: 1, text: '# deepseek-insight' },
							{ number: 2, text: '' },
							{ number: 3, text: 'Reading the harness.' }
						]
				}
			});
		});

		it('a result without a view carries no readView', () => {
			const entry = entryForEvent(resultEvent(undefined));
			expect(entry).toMatchObject({ kind: 'tool-result', id: 'tr:c40' });
			expect(hasReadView(entry)).toBe(false);
		});

		it('a non-read card view declines (generic fallback stays flat text)', () => {
			const entry = entryForEvent(resultEvent({ for: 'result', view: { card: 'terminal', title: 'ls' } }));
			expect(hasReadView(entry)).toBe(false);
		});

		it('malformed read views decline: missing path / non-numeric offset / bad line member', () => {
			const bad = [
				{ view: { card: 'read', offset: 1, totalLines: 1, lines: [] } },
				{ view: { card: 'read', path: 'a.md', offset: '1', totalLines: 1, lines: [] } },
				{ view: { card: 'read', path: 'a.md', offset: 1, totalLines: 1, lines: [{ number: 'x', text: 'hi' }] } }
			];
			for (const view of bad) {
				expect(hasReadView(entryForEvent(resultEvent(view)))).toBe(false);
			}
		});

		it('lang omitted on the wire stays omitted (plain-text file)', () => {
			const entry = entryForEvent(resultEvent({
				view: { card: 'read', path: '/x/NOTES.txt', offset: 1, totalLines: 1, lines: [{ number: 1, text: 'plain' }] }
			}));
			expect(entry).toMatchObject({ readView: { path: '/x/NOTES.txt', lines: [{ number: 1, text: 'plain' }] } });
		});
	});

describe('entryForEvent — silence and passthrough', () => {
	it('internal harness markers render nothing', () => {
		for (const type of [
			'permission/preset', 'sandbox/mode', 'approval/policy', 'agent/inbox/spliced',
			'step/start', 'step/end', 'session/title',
			'request/context', 'session/title-llm-request',
			'agent-preset/selected', 'todo/write'
		]) {
			expect(entryForEvent({ type, seq: 1, time: 1, data: {} })).toBeNull();
		}
		// Turn End Stamp ADR D1 (2026-09-25): turn/start + turn/end left the
		// silent set — they map to turn-lifecycle MARKERS (never rendered);
		// request/header maps to the system-prompt entry (2026-09-01).
		expect(entryForEvent({ type: 'turn/start', seq: 1, time: 1, data: { turn: 1 } })).toMatchObject({ kind: 'turn-lifecycle', phase: 'start' });
		expect(entryForEvent({ type: 'turn/end', seq: 2, time: 1, data: { turn: 1, reason: { kind: 'completed' } } })).toMatchObject({ kind: 'turn-lifecycle', phase: 'end' });
	});

	it('an event with no data and no mapped type stays a passthrough unknown-event (with time)', () => {
		const entry = entryForEvent({ type: 'assistant/chunk', seq: 12, time: 5 }); // no data → nothing to render as a bubble
		expect(entry).toEqual({ kind: 'unknown-event', id: 'ev:12', seq: 12, time: 5, eventType: 'assistant/chunk' });
	});

	it('a genuinely unknown future type renders as a passthrough chip', () => {
		const entry = entryForEvent({ type: 'plugin/frobnicated', seq: 44, time: 1, data: { x: 1 } });
		// 2026-09-18 empty-popup fix: the verbatim payload rides the entry so
		// the chip's popup can render it (workspace/changes · deliverables/…).
		expect(entry).toEqual({ kind: 'unknown-event', id: 'ev:44', seq: 44, time: 1, eventType: 'plugin/frobnicated', payload: { x: 1 } });
	});

	it('1.1-T: unknown-kind passthrough contract preserved — seq, time, type all survive', () => {
		const entry = entryForEvent({ type: 'future/thing', seq: 99, time: 1711111111111, data: { whatever: true } });
		expect(entry).toEqual({
			kind: 'unknown-event',
			id: 'ev:99',
			seq: 99,
			time: 1711111111111,
			eventType: 'future/thing',
			payload: { whatever: true }
		});
	});
});

describe('mergeEntries — live bubble finalize, idempotence', () => {
	it('a streaming bubble already in the list is IGNORED by mergeEntries (the store tail owns replace)', () => {
		// Ledger v2 removed the chunk fragments this merge used to concat;
		// the live tail replaces wholesale in applyLiveStream, outside the
		// merge. A streamed-in entry (only possible from stale producers)
		// must never double-apply.
		const list = mergeEntries([streamingBubble('Hel')], [streamingBubble('lo')]);
		expect(list).toHaveLength(1);
		expect(list[0]).toMatchObject({ text: 'Hel', streaming: true });
	});

	it('the finalized assistant/message REPLACES the streamed prefix', () => {
		const list = mergeEntries([streamingBubble('Hi!!')], [finalized(142, 'Hi! I am the assembled message.')].map(entryForEvent).filter(nonNull));
		expect(list).toHaveLength(1);
		expect(list[0]).toMatchObject({ text: 'Hi! I am the assembled message.', streaming: false, seq: 142, time: 1787252726999 });
	});

	it('retransmitted entries (same id, same seq) never duplicate or re-concatenate', () => {
		const once = mergeEntries([], [userMessageEvent].map(entryForEvent).filter(nonNull));
		const twice = mergeEntries(once, [userMessageEvent].map(entryForEvent).filter(nonNull));
		expect(twice).toHaveLength(1);
	});

	it('distinct steps produce distinct bubbles, order = first-seen', () => {
		const one = streamingBubble('step one');
		const two = { ...streamingBubble('step two'), id: 'a:2:2' };
		const merged = mergeEntries([], [one, two]);
		expect(merged.map((e) => (e.kind === 'assistant-message' ? e.id : null))).toEqual(['a:2:1', 'a:2:2']);
	});
});

describe('mergeEntries — reasoning on finalize (task 2.3 rules on the live bubble)', () => {
	it('finalize REPLACES the streamed reasoning prefix with the final block (authoritative)', () => {
		const list = mergeEntries([streamingBubble('streamed gu', 'streamed gu')], [finalized(142, 'Hi!')].map(entryForEvent).filter(nonNull));
		expect(list).toHaveLength(1);
		expect(list[0]).toMatchObject({
			text: 'Hi!',
			streaming: false,
			reasoning: '(internal reasoning — final block, authoritative)',
			reasoningStreaming: false
		});
	});

	it('finalize with NO reasoning block keeps the streamed reasoning (honest: wire never contradicted it)', () => {
		const noReasoningFinal: DshRawEvent = {
			type: 'assistant/message',
			seq: 150,
			time: 1787252726999,
			data: { turn: 2, step: 1, message: { role: 'assistant', content: [{ type: 'text', text: 'Answer.' }] } }
		};
		const list = mergeEntries([streamingBubble('partial', 'kept')], [noReasoningFinal].map(entryForEvent).filter(nonNull));
		expect(list[0]).toMatchObject({ text: 'Answer.', streaming: false, reasoning: 'kept' });
	});
});

describe('mergeEntries — tool lifecycle (task 1.2)', () => {
	it('cold load: call+result pair → status pass, durationMs from the two wire times', () => {
		const merged = eventsToEntries([toolCallEvent, toolResultEvent]);
		const call = merged.find((e) => e.kind === 'tool-call');
		const result = merged.find((e) => e.kind === 'tool-result');
		expect(call && call.kind === 'tool-call' && call.status).toBe('pass');
		expect(result && result.kind === 'tool-result' && result.durationMs).toBe(PAIR_DURATION_MS);
		expect(result && result.kind === 'tool-result' && result.toolName).toBe('grep');
	});

	it('poll order 1: pending call first, result flips it to pass with duration', () => {
		let list = mergeEntries([], [toolCallEvent].map(entryForEvent).filter(nonNull));
		const pending = list.find((e) => e.kind === 'tool-call');
		expect(pending && pending.kind === 'tool-call' && pending.status).toBe('pending');
		list = mergeEntries(list, [toolResultEvent].map(entryForEvent).filter(nonNull));
		const flipped = list.find((e) => e.kind === 'tool-call');
		const result = list.find((e) => e.kind === 'tool-result');
		expect(flipped && flipped.kind === 'tool-call' && flipped.status).toBe('pass');
		expect(result && result.kind === 'tool-result' && result.durationMs).toBe(PAIR_DURATION_MS);
	});

	it('poll order 2: result arrives BEFORE the call — pairing still resolves both directions', () => {
		let list = mergeEntries([], [toolResultEvent].map(entryForEvent).filter(nonNull));
		const orphan = list.find((e) => e.kind === 'tool-result');
		expect(orphan && orphan.kind === 'tool-result' && orphan.toolName).toBe('tool'); // honest unknown
		expect(orphan && orphan.kind === 'tool-result' && orphan.durationMs).toBeUndefined();
		list = mergeEntries(list, [toolCallEvent].map(entryForEvent).filter(nonNull));
		const paired = list.find((e) => e.kind === 'tool-result');
		const call = list.find((e) => e.kind === 'tool-call');
		expect(paired && paired.kind === 'tool-result' && paired.toolName).toBe('grep');
		expect(paired && paired.kind === 'tool-result' && paired.durationMs).toBe(PAIR_DURATION_MS);
		expect(call && call.kind === 'tool-call' && call.status).toBe('pass');
	});

	it('fail path: isError result flips the call to fail; duration still computed', () => {
		const merged = eventsToEntries([toolCallEvent, errorResultEvent(280, toolCallEvent.time + 2500)]);
		const call = merged.find((e) => e.kind === 'tool-call');
		const result = merged.find((e) => e.kind === 'tool-result');
		expect(call && call.kind === 'tool-call' && call.status).toBe('fail');
		expect(result && result.kind === 'tool-result' && result.durationMs).toBe(2500);
		expect(result && result.kind === 'tool-result' && result.ok).toBe(false);
	});

	it('retransmit idempotence: the same call/result replayed changes nothing', () => {
		const once = eventsToEntries([toolCallEvent, toolResultEvent]);
		const twice = mergeEntries(once, [toolCallEvent, toolResultEvent].map(entryForEvent).filter(nonNull));
		expect(twice).toHaveLength(2);
		const call = twice.find((e) => e.kind === 'tool-call');
		const result = twice.find((e) => e.kind === 'tool-result');
		expect(call && call.kind === 'tool-call' && call.status).toBe('pass'); // not flipped back, not duplicated
		expect(result && result.kind === 'tool-result' && result.durationMs).toBe(PAIR_DURATION_MS);
	});

	it('1.2-T: an orphan result (no call ever) keeps its honest state — name tool, no duration, no status side-effects', () => {
		const merged = eventsToEntries([toolResultEvent]);
		expect(merged).toHaveLength(1);
		const result = merged[0];
		expect(result.kind === 'tool-result' && result.toolName).toBe('tool');
		expect(result.kind === 'tool-result' && result.durationMs).toBeUndefined();
		expect(result.kind === 'tool-result' && result.ok).toBe(true); // wire said isError:false
	});

	it('1.2-T: a call with NO result stays honestly pending (unfinished tool)', () => {
		const merged = eventsToEntries([toolCallEvent]);
		const call = merged[0];
		expect(call.kind === 'tool-call' && call.status).toBe('pending');
	});

	it('1.2-T: duration comes from fixture event times, and clock skew (result before call) stays undefined', () => {
		const skewed = eventsToEntries([toolCallEvent, { ...toolResultEvent, time: toolCallEvent.time - 100 }]);
		const result = skewed.find((e) => e.kind === 'tool-result');
		// negative duration would be a lie — the honest answer is "unknown"
		expect(result && result.kind === 'tool-result' && result.durationMs).toBeUndefined();
		const ok = eventsToEntries([toolCallEvent, toolResultEvent]);
		const r2 = ok.find((e) => e.kind === 'tool-result');
		expect(r2 && r2.kind === 'tool-result' && r2.durationMs).toBe(1787212573440 - 1787212572959);
	});
});

describe('eventsToEntries — ledger cold load (BC-4 shape)', () => {
	it('a full ledger tail collapses to the render list: user bubble, finalized text + authoritative reasoning', () => {
		// Ledger v2: the cold page carries only durable settlements — the
		// step's stream is embedded in assistant/message, so the finalized
		// bubble IS the transcript; no chunk fragments exist to merge.
		const entries = eventsToEntries([
			userMessageEvent,
			finalized(142, 'Hi! Ready to help.')
		]);
		expect(entries).toEqual([
			{ kind: 'user-message', id: 'u:28af20be-5a3a-43d3-bd60-88a601b7eb8e', seq: 11, time: 1787252720796, text: 'Hi' },
			{
				kind: 'assistant-message',
				id: 'a:2:1',
				seq: 142,
				time: 1787252726999,
				text: 'Hi! Ready to help.',
				streaming: false,
				reasoning: '(internal reasoning — final block, authoritative)',
				reasoningStreaming: false
			}
		]);
	});

	it('tool call + result pair into chip entries with the name filled in', () => {
		const entries = eventsToEntries([toolCallEvent, toolResultEvent]);
		expect(entries).toEqual([
			{
				kind: 'tool-call',
				id: 'tc:call_abf1c2bdf65449f68c2c4dea',
				seq: 271,
				time: 1787212572959,
				callId: 'call_abf1c2bdf65449f68c2c4dea',
				toolName: 'grep',
				summary: 'Grep glm-5 in /Users/wharsojo/agentic-ai/deepseek-harness',
				argsRaw: '{"pattern":"glm-5","path":"/Users/wharsojo/agentic-ai/deepseek-harness"}',
				status: 'pass'
			},
			{
				kind: 'tool-result',
				id: 'tr:call_abf1c2bdf65449f68c2c4dea',
				seq: 272,
				time: 1787212573440,
				callId: 'call_abf1c2bdf65449f68c2c4dea',
				toolName: 'grep',
				ok: true,
				summary: 'No matches found',
				resultText: 'No matches found',
				durationMs: PAIR_DURATION_MS
			}
		]);
	});

	it('silent markers vanish; unknown types survive as chips', () => {
		const entries = eventsToEntries([
			{ type: 'permission/preset', seq: 0, time: 1, data: { preset: 'workspace-write' } },
			{ type: 'turn/start', seq: 4, time: 1, data: { turn: 1 } },
			{ type: 'plugin/frobnicated', seq: 5, time: 1, data: { x: 1 } }
		]);
		// Turn End Stamp ADR D1 (2026-09-25): the turn/start no longer
		// vanishes — it maps to an unrendered turn-lifecycle marker.
		expect(entries).toEqual([
			{ kind: 'turn-lifecycle', id: 'tl:1:start', seq: 4, time: 1, turn: 1, phase: 'start' },
			{ kind: 'unknown-event', id: 'ev:5', seq: 5, time: 1, eventType: 'plugin/frobnicated', payload: { x: 1 } }
		]);
	});

	it("the ledger's session header line stays silent (The Turn Kept Whole, D5 — was an ev:undefined chip)", () => {
		// The first ledger line: identity/cwd/preset bookkeeping with NO seq
		// (the one wire shape DshRawEvent's seq can't carry — hence the cast).
		// A known type — never the forward-compat unknown chip.
		const entries = eventsToEntries([
			{
				type: 'session',
				time: 1,
				data: { id: 'session-x', createdAt: 1, cwd: '/tmp', delegationDepth: 0, agentPreset: 'app-dev' }
			}
		] as unknown as DshRawEvent[]);
		expect(entries).toEqual([]);
	});

	it('retired v1 batch types fall through as passthrough chips (ledger v2 never serves them)', () => {
		// reasoning-chunks / text-chunks / tool-call-chunks were the 0.1.1
		// batch variants; ledger v2 removed them and the host migrates every
		// served generation to v2 records. No longer special-cased silent —
		// a hypothetical arrival renders the honest forward-compat chip.
		const entries = eventsToEntries([
			{
				type: 'reasoning-chunks',
				seq: 1,
				time: 1,
				data: { turn: 1, step: 1, index: 0, dt: [5, 0, 0] }
			},
			{
				type: 'text-chunks',
				seq: 2,
				time: 2,
				data: { turn: 1, step: 1, index: 1, dt: [72, 105] }
			},
			{
				type: 'tool-call-chunks',
				seq: 3,
				time: 3,
				data: { turn: 1, step: 1, index: 2, dt: [0, 1] }
			}
		] as unknown as DshRawEvent[]);
		expect(entries.map((e) => (e.kind === 'unknown-event' ? e.eventType : null))).toEqual([
			'reasoning-chunks',
			'text-chunks',
			'tool-call-chunks'
		]);
	});

	it('an empty ledger renders an empty list (blank session — not an error)', () => {
		expect(eventsToEntries([])).toEqual([]);
	});
});

// ── POC-3 W2 (task 2.4-T): context-injection FAMILY — fixture-pinned ────
// The producers below are verbatim members of tests/unit/fixtures/
// context-injection-sources.json (live rc.8 ledger, pinned by W1 task 1.4).

describe('entryForEvent — context-injection family (task 2.4-T)', () => {
	it('the fixture-pinned producers flag meta with their producer id; text + source stay verbatim', () => {
		const cases: Array<{ producer: string; data: Record<string, unknown> }> = [
			{
				producer: 'runtime-context',
				data: {
					id: 'rc',
					source: {
						kind: 'plugin',
						plugin: '@deepseek-ai/dsh-system-prompt',
						form: 'snapshot',
						sections: [{ name: 'sandbox:policy' }, { name: 'approval:policy' }]
					},
					content: [{ type: 'text', text: 'Current runtime context. This snapshot supersedes earlier runtime-context.' }]
				}
			},
			{
				producer: 'instructions',
				data: {
					id: 'agi',
					source: {
						kind: 'agent-instructions',
						form: 'instructions',
						baseline: true,
						changes: [{ action: 'set', scope: '.\u0000AGENTS.md', path: 'AGENTS.md', digest: 'ff4b48bfff997c2145f119d02d3f913abdfc5134' }]
					},
					content: [{ type: 'text', text: '<system-reminder>\nThe following workspace instructions may be relevant' }]
				}
			},
			{
				producer: 'skill-catalog',
				data: {
					id: 'sc',
					source: {
						kind: 'skill-catalog',
						form: 'catalog',
						entries: [
							{ name: 'dsh-archive-agent-notes', description: 'Use when adding, auditing, pruning…' },
							{ name: 'dsh-code-review', description: 'Use when reviewing a pull request…' }
						]
					},
					content: [{ type: 'text', text: '<system-reminder>\nA skill is a reusable set of task-specific instruction' }]
				}
			},
			{
				producer: 'skill-invocation',
				data: {
					id: 'si',
					source: { kind: 'skill-invocation', name: 'dsh-doc', form: 'instructions' },
					content: [{ type: 'text', text: '<skill_content name="dsh-doc">\n<skill_resources>\nBase directory for this skill: …' }]
				}
			},
			{
				// Live pin: session-dab56419-746b-424d-8eda-39dec2057bbe seq 83950
				// — the /compact checkpoint carries THREE text blocks; textOfContent
				// joins them so the chip body shows the full framed summary.
				producer: 'compaction',
				data: {
					id: 'cc',
					source: { kind: 'plugin', plugin: 'compact', compactionId: 'd7f4f8f8-59bd-44f5-815d-5d311049e552', sourceCommandId: 'cmd-9894a9ae-22' },
					content: [
						{ type: 'text', text: 'This is an automatically generated checkpoint condensing an earlier span of the conversation to free up context.\n\n<compacted-summary>' },
						{ type: 'text', text: '## Primary Request and Intent\n- User loaded three projects.' },
						{ type: 'text', text: '</compacted-summary>' }
					]
				}
			}
		];
		for (const { producer, data } of cases) {
			const entry = entryForEvent({ type: 'user/message', seq: 90, time: 1, data });
			expect(entry && entry.kind === 'user-message' && entry.meta).toBe(producer);
			expect(entry && entry.kind === 'user-message' && entry.metaSource).toEqual(data.source);
		}
		// The compaction chip body carries the whole framed summary, verbatim
		// blocks joined by the shared text joiner.
		const cc = entryForEvent({
			type: 'user/message',
			seq: 95,
			time: 1,
			data: cases[4].data
		}) as Extract<import('$lib/types').DsiEntry, { kind: 'user-message' }>;
		expect(cc.text).toContain('<compacted-summary>');
		expect(cc.text).toContain('## Primary Request and Intent');
		expect(cc.text).toContain('</compacted-summary>');
	});

	it('open plugin family: siblings match the generic plugin chip named after the wire plugin (2026-08-31 audit)', () => {
		// Live pins — session-dab56419 seq 14 (approval policy change) and
		// seq 5817 (background-job notice): before the audit these rendered
		// as the operator's own bubble; DSH's own client shows them as
		// injected context. The tailored runtime-context producer keeps its
		// text-prefix corroboration: a snapshot without the prefix falls
		// through to the generic chip instead of claiming 'runtime-context'.
		// 2026-09-18: the bare 'user-approval' plugin was promoted to a
		// tailored producer (catalog label ctxChipUserApproval) — the scoped
		// @deepseek-ai/dsh-user-approval sibling stays in the open family.
		const cases: Array<{ meta: string; plugin: string; text: string }> = [
			{ meta: 'user-approval', plugin: 'user-approval', text: 'The approval policy changed from "ask" to "never" (changed by the user).' },
			{ meta: 'plugin', plugin: 'tool-jobs', text: 'background job bash-2 finished [status: completed, exit code: 0].' },
			{ meta: 'plugin', plugin: '@deepseek-ai/dsh-user-approval', text: 'approval framing text' },
			{ meta: 'plugin', plugin: '@deepseek-ai/dsh-compaction-basic', text: 'summarize the conversation' },
			{ meta: 'plugin', plugin: '@deepseek-ai/dsh-unknown', text: 'Current runtime context. (imposter)' },
			{ meta: 'plugin', plugin: '@deepseek-ai/dsh-system-prompt', text: 'a snapshot WITHOUT the pinned prefix' }
		];
		for (const { meta, plugin, text } of cases) {
			const entry = entryForEvent({
				type: 'user/message',
				seq: 91,
				time: 1,
				data: { id: 'op', source: { kind: 'plugin', plugin }, content: [{ type: 'text', text }] }
			});
			expect(entry && entry.kind === 'user-message' && entry.meta, plugin).toBe(meta);
			expect(entry && entry.kind === 'user-message' && entry.metaSource).toEqual({ kind: 'plugin', plugin });
		}
	});

	it('fall-through kinds: session-reference → recall, unknown kinds → injected, user → bubble', () => {
		const recall = entryForEvent({
			type: 'user/message',
			seq: 97,
			time: 1,
			data: {
				id: 'sr',
				source: { kind: 'session-reference', form: 'recall', version: 1, references: [{ sessionId: 's1', label: 'Fix the mux drop' }] },
				content: [{ type: 'text', text: '<recalled-context>…' }]
			}
		});
		expect(recall && recall.kind === 'user-message' && recall.meta).toBe('recall');

		const webhook = entryForEvent({
			type: 'user/message',
			seq: 98,
			time: 1,
			data: { id: 'wh', source: { kind: 'webhook', provider: 'github', form: 'notice' }, content: [{ type: 'text', text: 'Deploy requested.' }] }
		});
		expect(webhook && webhook.kind === 'user-message' && webhook.meta).toBe('injected');

		const team = entryForEvent({
			type: 'user/message',
			seq: 99,
			time: 1,
			data: { id: 'tm', source: { kind: 'team-message', senderName: 'scout' }, content: [{ type: 'text', text: 'handoff' }] }
		});
		expect(team && team.kind === 'user-message' && team.meta).toBe('injected');

		// A malformed tailored shape (wrong form) still surfaces — as the
		// honest fall-through, never as a fabricated tailored chip.
		const wrongForm = entryForEvent({
			type: 'user/message',
			seq: 100,
			time: 1,
			data: { id: 'wf', source: { kind: 'skill-catalog', form: 'partial' }, content: [{ type: 'text', text: 'x' }] }
		});
		expect(wrongForm && wrongForm.kind === 'user-message' && wrongForm.meta).toBe('injected');

		// The operator's own message stays a bubble (only true negative).
		const plain = entryForEvent({
			type: 'user/message',
			seq: 101,
			time: 1,
			data: { id: 'pl', content: [{ type: 'text', text: 'AGENTS.md says hi' }] }
		});
		expect(plain).toEqual({ kind: 'user-message', id: 'u:pl', seq: 101, time: 1, text: 'AGENTS.md says hi' });
	});
});

describe('user/message image blocks (task 3.1)', () => {
	const imageRef = {
		attachmentId: 'sha256:stub-image-0001',
		mediaType: 'image/png',
		bytes: 96,
		width: 1,
		height: 1,
		name: 'shot.png'
	};

	it('mixed content maps text AND validated imageRefs in content order', () => {
		const entry = entryForEvent({
			type: 'user/message',
			seq: 109,
			time: 1,
			data: {
				id: 'img-1',
				content: [
					{ type: 'image', attachment: imageRef },
					{ type: 'text', text: 'look at this' }
				]
			}
		});
		expect(entry).toEqual({
			kind: 'user-message',
			id: 'u:img-1',
			seq: 109,
			time: 1,
			text: 'look at this',
			imageRefs: [imageRef]
		});
	});

	it('text-only messages stay byte-identical — no imageRefs key (regression)', () => {
		const entry = entryForEvent({
			type: 'user/message',
			seq: 110,
			time: 1,
			data: { id: 't1', content: [{ type: 'text', text: 'plain' }] }
		});
		if (entry === null) throw new Error('expected a user-message entry');
		expect('imageRefs' in entry).toBe(false);
	});

	it('malformed attachments are skipped, never guessed into shape', () => {
		const entry = entryForEvent({
			type: 'user/message',
			seq: 111,
			time: 1,
			data: {
				id: 'img-bad',
				content: [
					{ type: 'image', attachment: { attachmentId: 42, mediaType: 'image/png' } },
					{ type: 'image' },
					{ type: 'image', attachment: imageRef },
					{ type: 'text', text: 'mixed validity' }
				]
			}
		});
		if (entry === null || entry.kind !== 'user-message') throw new Error('expected a user-message entry');
		expect(entry.imageRefs).toEqual([imageRef]);
		expect(entry.text).toBe('mixed validity');
	});

	it('attachments-only message maps with empty text and its refs', () => {
		const entry = entryForEvent({
			type: 'user/message',
			seq: 112,
			time: 1,
			data: { id: 'img-only', content: [{ type: 'image', attachment: { ...imageRef, name: undefined } }] }
		});
		if (entry === null || entry.kind !== 'user-message') throw new Error('expected a user-message entry');
		// name: undefined fails the typeof string check → omitted from the ref
		expect(entry.imageRefs).toEqual([
			{ attachmentId: 'sha256:stub-image-0001', mediaType: 'image/png', bytes: 96, width: 1, height: 1 }
		]);
		expect(entry.text).toBe('');
	});
});

// ═══════════════════════════════════════════════════════════════════════
// The workflow fold (2026-08-31): the four tool-workflow lifecycle events
// fold into ONE workflow-run entry per runId. Wire shapes pinned from
// packages/workflow/tool-workflow/src (types.ts + index.ts recorder).
// ═══════════════════════════════════════════════════════════════════════

const RUN_ID = 'wf-run-abc';

function runStart(seq: number): DshRawEvent {
	return { type: 'tool-workflow/run-start', seq, time: 1000 + seq, data: { runId: RUN_ID, name: 'build feature' } };
}

function agentStart(seq: number, memberSeq: number, label: string, phase?: string): DshRawEvent {
	return {
		type: 'tool-workflow/agent-start',
		seq,
		time: 1000 + seq,
		data: { runId: RUN_ID, seq: memberSeq, label, ...(phase === undefined ? {} : { phase }), childId: `child-${memberSeq}` }
	};
}

function agentEnd(seq: number, memberSeq: number, outcome: 'completed' | 'failed' | 'cancelled'): DshRawEvent {
	return { type: 'tool-workflow/agent-end', seq, time: 1000 + seq, data: { runId: RUN_ID, seq: memberSeq, outcome } };
}

function runEnd(seq: number, stopReason: 'completed' | 'cancelled' | 'error'): DshRawEvent {
	return { type: 'tool-workflow/run-end', seq, time: 1000 + seq, data: { runId: RUN_ID, stopReason } };
}

function workflowEntries(events: DshRawEvent[]): Extract<DsiEntry, { kind: 'workflow-run' }>[] {
	return eventsToEntries(events).filter(
		(e): e is Extract<DsiEntry, { kind: 'workflow-run' }> => e.kind === 'workflow-run'
	);
}

describe('the workflow fold — four events, ONE workflow-run entry', () => {
	it('run-start opens the entry; agent-starts append members in order', () => {
		const [run] = workflowEntries([runStart(1), agentStart(2, 0, 'scout'), agentStart(3, 1, 'builder')]);
		expect(run.id).toBe(`wf:${RUN_ID}`);
		expect(run.name).toBe('build feature');
		expect(run.status).toBe('running');
		expect(run.agents.map((a) => [a.seq, a.label, a.childId])).toEqual([
			[0, 'scout', 'child-0'],
			[1, 'builder', 'child-1']
		]);
		expect(run.agents.every((a) => a.status === 'running' && a.startedAt > 0)).toBe(true);
	});

	it('agent-end settles the matching member without erasing its label', () => {
		const [run] = workflowEntries([runStart(1), agentStart(2, 0, 'scout'), agentEnd(3, 0, 'completed'), agentStart(4, 1, 'builder')]);
		expect(run.agents.map((a) => [a.label, a.status])).toEqual([
			['scout', 'completed'],
			['builder', 'running']
		]);
		expect(run.agents[0].endedAt).toBe(1003);
		expect(run.status).toBe('running');
	});

	it('run-end sets the terminal status (completed/error→failed/cancelled)', () => {
		const [ok] = workflowEntries([runStart(1), agentStart(2, 0, 'a'), agentEnd(3, 0, 'completed'), runEnd(4, 'completed')]);
		expect(ok.status).toBe('completed');
		const [bad] = workflowEntries([runStart(1), runEnd(2, 'error')]);
		expect(bad.status).toBe('failed');
		const [stopped] = workflowEntries([runStart(1), runEnd(2, 'cancelled')]);
		expect(stopped.status).toBe('cancelled');
	});

	it('folds across SEPARATE merges (live polls: deltas arrive one event at a time)', () => {
		let list = mergeEntries([], []);
		for (const event of [runStart(1), agentStart(2, 0, 'scout'), agentEnd(3, 0, 'completed'), runEnd(4, 'completed')]) {
			list = mergeEntries(list, eventsToEntries([event]));
		}
		const [run] = list.filter((e): e is Extract<DsiEntry, { kind: 'workflow-run' }> => e.kind === 'workflow-run');
		expect(run.status).toBe('completed');
		expect(run.agents).toHaveLength(1);
		expect(run.agents[0].status).toBe('completed');
	});

	it('is idempotent: retransmitted partials never duplicate members', () => {
		const events = [runStart(1), agentStart(2, 0, 'scout'), agentStart(2, 0, 'scout'), agentEnd(3, 0, 'completed')];
		const [run] = workflowEntries(events);
		expect(run.agents).toHaveLength(1);
	});

	it('an orphan agent-start (no run-start yet) still folds by id', () => {
		const [run] = workflowEntries([agentStart(1, 0, 'early bird')]);
		expect(run.id).toBe(`wf:${RUN_ID}`);
		expect(run.agents).toHaveLength(1);
	});

	it('settle partials carry member data through the partial agent-start marker', () => {
		// agent-end before its agent-start (reordered page): the settle must
		// not erase the member identity when the start arrives later.
		const [run] = workflowEntries([agentEnd(1, 0, 'completed'), agentStart(2, 0, 'late label')]);
		expect(run.agents).toHaveLength(1);
		expect(run.agents[0].label).toBe('late label');
		expect(run.agents[0].status).toBe('completed');
	});
});

describe('entryForEvent — request/header system prompt (2026-09-01 un-silencing)', () => {
	/** Wire shape per core/session/src/types.ts SessionEventMap: data =
	 *  { header: EpochHeader, reason, startsSeries? } — EpochHeader carries
	 *  config, and `system` only when the request had one. */
	function header(seq: number, system: unknown, reason = 'initial'): DshRawEvent {
		return {
			type: 'request/header',
			seq,
			time: 1787252710000 + seq,
			data: {
				header: {
					config: { provider: 'deepseek', model: 'deepseek-chat' },
					...(typeof system === 'string' ? { system } : {})
				},
				reason
			}
		};
	}

	it('an initial header with a system maps to a system-prompt entry (text verbatim, sp:<seq> id)', () => {
		expect(entryForEvent(header(4, 'You are app-dev, an application development agent.'))).toEqual({
			kind: 'system-prompt',
			id: 'sp:4',
			seq: 4,
			time: 1787252710004,
			text: 'You are app-dev, an application development agent.'
		});
	});

	it('a system-less request renders nothing (canonical empty optional is absent)', () => {
		expect(entryForEvent(header(5, undefined))).toBeNull();
	});

	it('malformed header shapes render nothing (missing header, non-string system)', () => {
		const noHeader: DshRawEvent = {
			type: 'request/header',
			seq: 6,
			time: 1,
			data: { reason: 'initial' } as unknown as { header: unknown; reason: string }
		};
		expect(entryForEvent(noHeader)).toBeNull();
		expect(entryForEvent(header(7, 42))).toBeNull();
	});

	it("a change-reason header still maps — dedupe is the collapse rule's job, never the mapper's", () => {
		const entry = entryForEvent(header(8, 'New persona after a preset switch', 'change'));
		expect(entry).not.toBeNull();
		expect((entry as { text: string }).text).toBe('New persona after a preset switch');
	});
});

describe('collapseSystemPromptEntries — one row per distinct text (2026-09-01)', () => {
	const sp = (seq: number, text: string): DsiEntry => ({
		kind: 'system-prompt', id: `sp:${seq}`, seq, time: 1000 + seq, text
	});
	const bubble: DsiEntry = { kind: 'user-message', id: 'u:1', seq: 11, time: 1000, text: 'Hi' };

	it('drops identical-text repeats (resume re-headers) and keeps distinct texts', () => {
		const out = collapseSystemPromptEntries([sp(1, 'A'), sp(2, 'A'), sp(3, 'B'), sp(4, 'B'), sp(5, 'A')]);
		expect(out.map((e) => (e as { text: string }).text)).toEqual(['A', 'B', 'A']);
	});

	it('is a pass-through for lists without system-prompt entries', () => {
		const list: DsiEntry[] = [bubble];
		expect(collapseSystemPromptEntries(list)).toEqual(list);
	});

	it('eventsToEntries collapses a cold page that carries repeated headers', () => {
		const page: DshRawEvent[] = [
			{
				type: 'request/header', seq: 1, time: 1,
				data: { header: { config: {}, system: 'S' }, reason: 'initial' }
			},
			{
				type: 'request/header', seq: 2, time: 2,
				data: { header: { config: {}, system: 'S' }, reason: 'resume' }
			},
			userMessageEvent
		];
		const entries = eventsToEntries(page);
		expect(entries.filter((e) => e.kind === 'system-prompt')).toHaveLength(1);
	});
});

describe('system/message — surface node zero (2026-09-10 Empty Prompt Popup ADR, D1/D4)', () => {
	/** Wire: the loop appends { turn, step, message } per committed prompt
	 *  (DSH agent.ts:371); the prompt text rides message.content text blocks. */
	function nodeZero(seq: number, text: string | null): DshRawEvent {
		return {
			type: 'system/message',
			seq,
			time: 1787252710000 + seq,
			data: {
				turn: 0,
				step: 0,
				message: {
					id: `m:${seq}`,
					role: 'system',
					...(text === null ? { content: [] } : { content: [{ type: 'text', text }] })
				}
			} as DshRawEvent['data']
		};
	}

	it('a node-zero prompt maps to a system-prompt entry (text verbatim, sp:<seq> id)', () => {
		expect(entryForEvent(nodeZero(4, 'You are app-dev, an application development agent.'))).toEqual({
			kind: 'system-prompt',
			id: 'sp:4',
			seq: 4,
			time: 1787252710004,
			text: 'You are app-dev, an application development agent.'
		});
	});

	it('empty content is the host no-prompt signal — no entry (SystemMessage contract)', () => {
		expect(entryForEvent(nodeZero(5, null))).toBeNull();
	});

	it('a log carrying BOTH legacy header text and node-zero text collapses to one row per distinct text', () => {
		const page: DshRawEvent[] = [
			{
				type: 'request/header', seq: 1, time: 1,
				data: { header: { config: {}, system: 'S' }, reason: 'initial' }
			},
			nodeZero(2, 'S'),
			nodeZero(3, 'T'),
			userMessageEvent
		];
		const entries = eventsToEntries(page);
		expect(entries.filter((e) => e.kind === 'system-prompt').map((e) => (e as { text: string }).text)).toEqual(['S', 'T']);
	});
});

// ── Turn End Stamp (2026-09-25, ADR D1): turn bracket markers ──
// Wire shapes live-captured from session-47a4c492 (session.v4.jsonl.zstd,
// decompressed 2026-09-25): seq 442 start, seq 473 end aborted(user),
// seqs 367/440 end completed.

describe('entryForEvent — turn lifecycle markers (Turn End Stamp)', () => {
	const startEvent: DshRawEvent = { type: 'turn/start', seq: 442, time: 1790274054570, data: { turn: 9 } };
	const endAborted: DshRawEvent = {
		type: 'turn/end',
		seq: 473,
		time: 1790274196764,
		data: { turn: 9, reason: { kind: 'aborted', reason: { kind: 'user' } } }
	};
	const endCompleted: DshRawEvent = { type: 'turn/end', seq: 367, time: 1790273609904, data: { turn: 7, reason: { kind: 'completed' } } };
	const endError: DshRawEvent = { type: 'turn/end', seq: 500, time: 1790275000000, data: { turn: 11, reason: { kind: 'error', error: { code: 'MISSING_CREDENTIAL', message: 'no creds' } } } };

	it('turn/start maps to a start marker carrying the wire triple', () => {
		const e = entryForEvent(startEvent);
		expect(e).toMatchObject({ kind: 'turn-lifecycle', id: 'tl:9:start', turn: 9, phase: 'start', seq: 442, time: 1790274054570 });
		expect((e as { reasonKind?: string }).reasonKind).toBeUndefined();
	});

	it('turn/end aborted(user) maps to an end marker with reasonKind + abortKind', () => {
		expect(entryForEvent(endAborted)).toMatchObject({
			kind: 'turn-lifecycle', id: 'tl:9:end', turn: 9, phase: 'end', seq: 473, time: 1790274196764,
			reasonKind: 'aborted', abortKind: 'user'
		});
	});

	it('turn/end completed maps to an end marker without abortKind', () => {
		const e = entryForEvent(endCompleted);
		expect(e).toMatchObject({ kind: 'turn-lifecycle', id: 'tl:7:end', turn: 7, phase: 'end', reasonKind: 'completed' });
		expect((e as { abortKind?: string }).abortKind).toBeUndefined();
	});

	it('turn/end error still maps to turn-error (dead-turn surface unchanged)', () => {
		const e = entryForEvent(endError);
		expect(e).toMatchObject({ kind: 'turn-error', code: 'MISSING_CREDENTIAL', message: 'no creds' });
	});
});


describe('developer/message — ADR-0027b task 1.2-T', () => {
	const devEvent: DshRawEvent = {
		type: 'developer/message',
		seq: 7,
		time: 1787252800000,
		data: {
			turn: 3,
			step: 1,
			message: {
				id: 'dm1',
				role: 'developer',
				source: { kind: 'tool-registry' },
				content: [{ type: 'text', text: 'tools added: foo' }]
			}
		}
	} as DshRawEvent;

	it('content present -> developer-message entry with extracted text and dm:<seq> id', () => {
		const e = entryForEvent(devEvent);
		expect(e).not.toBeNull();
		expect(e).toMatchObject({ kind: 'developer-message', id: 'dm:7', seq: 7, text: 'tools added: foo' });
	});

	it('empty content -> null (host parity: no content, no message - surface.ts:138-143)', () => {
		const data = devEvent.data as { message: Record<string, unknown> };
		const e = entryForEvent({ ...devEvent, data: { ...data, message: { ...data.message, content: [] } } } as DshRawEvent);
		expect(e).toBeNull();
	});

	it('data undefined -> the early uninterpretable-envelope guard chips (documented mapper contract, seqs must survive)', () => {
		// The mapper's pre-dispatch guard (api-dsh-pinned) chips ANY mapped-type
		// event whose data is absent; our case only fires once data exists.
		const e = entryForEvent({ type: 'developer/message', seq: 8, time: 1, data: undefined } as unknown as DshRawEvent);
		expect(e).toMatchObject({ kind: 'unknown-event', eventType: 'developer/message', id: 'ev:8' });
	});

	it('content block without text -> null (our case, after the guard)', () => {
		const data = devEvent.data as { message: Record<string, unknown> };
		const e = entryForEvent({ ...devEvent, data: { ...data, message: { ...data.message, content: [{ type: 'text' }] } } } as DshRawEvent);
		expect(e).toBeNull();
	});
});
