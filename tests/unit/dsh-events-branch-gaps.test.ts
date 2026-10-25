/**
 * dsh-events branch-gap tests — pins the mapper/dsh-events branches the
 * earlier suites leave uncovered: historyToEvents view-carry rules, the
 * no-data unknown chip, every silent type, and the optional-field arms of
 * each mapped event family. Pure mapping, shapes follow the probe-captured
 * fixtures in dsh-events.test.ts.
 */

import { describe, expect, it } from 'vitest';
import {
	collapseSystemPromptEntries,
	entryForEvent,
	eventsToEntries,
	historyToEvents,
	mergeEntries,
	type DshRawEvent
} from '$lib/services/conversation/dsh-events';
import { groupTurns } from '$lib/utils/turn-grouping';

function ev(type: string, data?: Record<string, unknown>, extra?: Partial<DshRawEvent>): DshRawEvent {
	return { type, seq: 1, time: 1700000000000, ...(data !== undefined ? { data } : {}), ...extra };
}

describe('historyToEvents', () => {
	it('passes events through untouched when no view rides beside them', () => {
		const e = ev('user/message', { content: [] });
		expect(historyToEvents([{ event: e }])).toEqual([e]);
	});

	it('attaches the beside-view shallowly when the event has none', () => {
		const e = ev('tool/call', { callId: 'c1' });
		const view = { for: 'call', view: { card: 'generic', title: 'T' } };
		const out = historyToEvents([{ event: e, view }]);
		expect(out[0].view).toEqual(view);
		expect(out[0]).not.toBe(e);
	});

	it('keeps the event member view when the event already carries one', () => {
		const own = { for: 'call', view: { card: 'generic', title: 'own' } };
		const beside = { for: 'call', view: { card: 'generic', title: 'beside' } };
		const e = { ...ev('tool/call', { callId: 'c1' }), view: own };
		const out = historyToEvents([{ event: e, view: beside }]);
		expect(out[0].view).toEqual(own);
	});
});

describe('silent roster and no-data chip', () => {
	it.each([
		'agent-preset/selected',
		'agent/inbox/spliced',
		'approval/decided',
		'approval/policy',
		'approval/asked',
		'command/done',
		'command/run',
		'compaction/end',
		'compaction/prune',
		'compaction/start',
		'compaction/summary',
		'feedback/record',
		'goal/change',
		'hook/invoked',
		'hook/result',
		'llm/retry',
		'llm/retry-started',
		'assistant/attempt',
		'permission/preset',
		'plan/mode',
		'request/context',
		'sandbox/mode',
		'schedule/change',
		'session',
		'session/end-seed',
		'session/title',
		'session/title-llm-request',
		'step/end',
		'step/start',
		'subagent/catalog',
		'subagent/descriptor',
		'team/member',
		'team/message/delivered',
		'team/message/queued',
		'team/task',
		'todo/write',
		'web/deepseek-search-llm-request'
	])('maps %s to null (silent)', (type) => {
		expect(entryForEvent(ev(type, { anything: true }))).toBeNull();
	});

	it('renders a mapped-type event with NO data as a passthrough chip', () => {
		const out = entryForEvent({ type: 'some/known-later', seq: 7, time: 5 });
		expect(out).toEqual({
			kind: 'unknown-event',
			id: 'ev:7',
			seq: 7,
			time: 5,
			eventType: 'some/known-later'
		});
	});
});

describe('system-prompt families', () => {
	it('maps system/message text blocks to a system-prompt entry', () => {
		const out = entryForEvent(
			ev('system/message', { message: { content: [{ type: 'text', text: 'You are DSI.' }] } })
		);
		expect(out).toMatchObject({ kind: 'system-prompt', id: 'sp:1', text: 'You are DSI.' });
	});

	it('returns null for empty system/message content', () => {
		expect(entryForEvent(ev('system/message', { message: { content: [] } }))).toBeNull();
		expect(entryForEvent(ev('system/message', {}))).toBeNull();
	});

	it('maps legacy request/header.system to a system-prompt entry', () => {
		const out = entryForEvent(ev('request/header', { header: { system: 'legacy prompt' } }));
		expect(out).toMatchObject({ kind: 'system-prompt', text: 'legacy prompt' });
	});

	it('returns null for a modern header without system', () => {
		expect(entryForEvent(ev('request/header', { header: {} }))).toBeNull();
		expect(entryForEvent(ev('request/header', {}))).toBeNull();
	});
});

describe('user/message optional-field arms', () => {
	it('falls back to a seq-based id when data.id is missing', () => {
		const out = entryForEvent(ev('user/message', { content: [{ type: 'text', text: 'hi' }] }))!;
		expect(out).toMatchObject({ kind: 'user-message', id: 'u:seq:1' });
		expect(out).not.toHaveProperty('meta');
		expect(out).not.toHaveProperty('imageRefs');
	});

	it('uses data.id for the bubble id and carries imageRefs', () => {
		const image = {
			type: 'image',
			attachment: { attachmentId: 'a1', mediaType: 'image/png', bytes: 3, width: 1, height: 1 }
		};
		const out = entryForEvent(
			ev('user/message', { id: 'abc', content: [{ type: 'text', text: 'see' }, image] })
		)!;
		expect(out).toMatchObject({ id: 'u:abc' });
		expect((out as { imageRefs?: unknown }).imageRefs).toHaveLength(1);
	});

	it('flags context-injection producers and carries metaSource', () => {
		const src = {
			kind: 'plugin',
			plugin: 'compact',
			compactionId: 'cp1'
		};
		const out = entryForEvent(
			ev('user/message', { content: [{ type: 'text', text: '<compacted-summary>' }], source: src })
		)!;
		expect(out).toMatchObject({ kind: 'user-message', meta: 'compaction', metaSource: src });
	});

	it('producer path without metaSource present is impossible (source IS the marker)', () => {
		// documented by construction: producer detection requires source,
		// so the metaSource spread's false arm is unreachable — pinned here
		// as a plain producer + imageRefs combination instead.
		const src = { kind: 'skill-catalog', form: 'catalog', entries: [{ name: 'x', description: 'y' }] };
		const out = entryForEvent(ev('user/message', { content: [], source: src }))!;
		expect(out).toMatchObject({ meta: 'skill-catalog', metaSource: src });
	});
});

describe('assistant/message optional arms', () => {
	it('carries usage and provider/model attribution when present', () => {
		const out = entryForEvent(
			ev('assistant/message', {
				turn: 1,
				step: 2,
				message: {
					content: [{ type: 'text', text: 'ok' }],
					source: { provider: 'deepseek', model: 'glm-5.3-flash' }
				},
				usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 }
			})
		) as Record<string, unknown>;
		expect(out.usage).toMatchObject({ inputTokens: 10, totalTokens: 15, provider: 'deepseek' });
	});

	it('omits reasoning and usage when absent, empty reasoning declines', () => {
		const out = entryForEvent(
			ev('assistant/message', {
				turn: 0,
				step: 0,
				message: {
					content: [
						{ type: 'reasoning', text: '' },
						{ type: 'text', text: 'plain' }
					]
				}
			})
		) as Record<string, unknown>;
		expect(out.id).toBe('a:0:0');
		expect(out).not.toHaveProperty('reasoning');
		expect(out).not.toHaveProperty('usage');
	});
});

describe('turn lifecycle', () => {
	it('maps a non-error turn/end to a turn-lifecycle marker', () => {
		const out = entryForEvent(ev('turn/end', { turn: 3, reason: { kind: 'completed' } }))!;
		expect(out).toMatchObject({ kind: 'turn-lifecycle', id: 'tl:3:end', turn: 3, phase: 'end', reasonKind: 'completed' });
		expect(out).not.toHaveProperty('abortKind');
	});

	it('maps an aborted turn/end with nested abort kind', () => {
		const out = entryForEvent(
			ev('turn/end', { turn: 4, reason: { kind: 'aborted', reason: { kind: 'user' } } })
		)!;
		expect(out).toMatchObject({ kind: 'turn-lifecycle', abortKind: 'user' });
	});

	it('defaults a non-numeric turn to 0 and a missing reason to undefined', () => {
		const out = entryForEvent(ev('turn/end', { turn: 'x' }))!;
		expect(out).toMatchObject({ kind: 'turn-lifecycle', turn: 0, id: 'tl:0:end' });
		expect((out as Record<string, unknown>).reasonKind).toBeUndefined();
	});

	it('maps an error turn/end to a turn-error entry, with and without a code', () => {
		const withCode = entryForEvent(
			ev('turn/end', { reason: { kind: 'error', error: { code: 'MISSING_CREDENTIAL', message: 'no key' } } })
		)!;
		expect(withCode).toMatchObject({ kind: 'turn-error', message: 'no key', code: 'MISSING_CREDENTIAL' });

		const noCode = entryForEvent(ev('turn/end', { reason: { kind: 'error', error: {} } }))!;
		expect(noCode).toMatchObject({ kind: 'turn-error', message: 'turn ended with an error' });
		expect(noCode).not.toHaveProperty('code');
	});

	it('maps turn/start with numeric and non-numeric turns', () => {
		expect(entryForEvent(ev('turn/start', { turn: 2 }))).toMatchObject({ id: 'tl:2:start', turn: 2, phase: 'start' });
		expect(entryForEvent(ev('turn/start', {}))).toMatchObject({ id: 'tl:0:start', turn: 0 });
	});
});

describe('tool/ptc-dispatch fold partials', () => {
	it('returns null when either id is missing', () => {
		expect(entryForEvent(ev('tool/ptc-dispatch-start', { parentCallId: 'p' }))).toBeNull();
		expect(entryForEvent(ev('tool/ptc-dispatch', { subCallId: 's' }))).toBeNull();
	});

	it('maps a start partial without args', () => {
		const out = entryForEvent(
			ev('tool/ptc-dispatch-start', { parentCallId: 'p', subCallId: 's', name: 'bash' })
		)!;
		expect(out).toMatchObject({ kind: 'code-dispatch', id: 'cd:s', parentCallId: 'p', subCallId: 's', name: 'bash', settled: false });
		expect(out).not.toHaveProperty('argsRaw');
		expect(out).not.toHaveProperty('isError');
	});

	it('maps a settled dispatch with args, isError true and content text', () => {
		const out = entryForEvent(
			ev('tool/ptc-dispatch', {
				parentCallId: 'p',
				subCallId: 's',
				name: 'bash',
				arguments: { cmd: 'ls' },
				isError: true,
				content: [{ type: 'text', text: 'boom' }]
			})
		)!;
		expect(out).toMatchObject({ settled: true, isError: true, contentText: 'boom', argsRaw: '{"cmd":"ls"}' });
	});

	it('a settled dispatch with isError!==true is ok and empty content declines contentText', () => {
		const out = entryForEvent(
			ev('tool/ptc-dispatch', { parentCallId: 'p', subCallId: 's', content: [] })
		)!;
		expect(out).toMatchObject({ settled: true, isError: false, contentText: undefined });
	});
});

describe('tool/call fallback arms', () => {
	it('falls back to a seq callId when missing and omits argsRaw', () => {
		const out = entryForEvent(ev('tool/call', {}))!;
		expect(out).toMatchObject({ kind: 'tool-call', callId: 'seq:1', id: 'tc:seq:1', toolName: 'tool', status: 'pending', argsRaw: undefined });
		expect((out as { summary?: unknown }).summary).toBeUndefined();
	});

	it('summarizes from view title when present, else truncated args', () => {
		const titled = entryForEvent(
			ev('tool/call', { callId: 'c', name: 'grep', arguments: '{}' }, { view: { view: { title: 'T' } } })
		)!;
		expect((titled as { summary?: unknown }).summary).toBe('T');

		const raw = entryForEvent(ev('tool/call', { callId: 'c', name: 'grep', arguments: '{"a":1}' }))!;
		expect((raw as { summary?: unknown }).summary).toBe('{"a":1}');
	});
});

describe('tool-workflow partials', () => {
	it('run-start: named run and seq fallback id', () => {
		const out = entryForEvent(ev('tool-workflow/run-start', { runId: 'r1', name: 'wf' }))!;
		expect(out).toMatchObject({ kind: 'workflow-run', id: 'wf:r1', runId: 'r1', name: 'wf', status: 'running', agents: [] });
		const fallback = entryForEvent(ev('tool-workflow/run-start', {}))!;
		expect(fallback).toMatchObject({ id: 'wf:seq:1', name: 'workflow' });
	});

	it('agent-start: with and without optional phase, label, childId, numeric seq', () => {
		const full = entryForEvent(
			ev('tool-workflow/agent-start', { runId: 'r1', seq: 5, label: 'L', childId: 'ch', phase: 'research' })
		)!;
		expect((full as unknown as { agents: Record<string, unknown>[] }).agents[0]).toEqual({
			seq: 5, label: 'L', childId: 'ch', phase: 'research', status: 'running', startedAt: 1700000000000
		});

		const bare = entryForEvent(ev('tool-workflow/agent-start', {}))!;
		expect((bare as unknown as { agents: Record<string, unknown>[] }).agents[0]).toEqual({
			seq: -1, label: 'agent -1', childId: '', status: 'running', startedAt: 1700000000000
		});
	});

	it('agent-end: outcome mapping completed/failed/other', () => {
		const statuses = ['completed', 'failed', 'whatever'].map((outcome) => {
			const out = entryForEvent(ev('tool-workflow/agent-end', { runId: 'r', outcome }))! as {
				agents: { status: string }[];
			};
			return out.agents[0].status;
		});
		expect(statuses).toEqual(['completed', 'failed', 'cancelled']);
	});

	it('run-end: stopReason mapping completed/error/other', () => {
		const statuses = ['completed', 'error', 'meh'].map((stopReason) => {
			const out = entryForEvent(ev('tool-workflow/run-end', { runId: 'r', stopReason }))! as {
				status: string;
			};
			return out.status;
		});
		expect(statuses).toEqual(['completed', 'failed', 'cancelled']);
	});
});

describe('tool/result arms', () => {
	it('carries a read view when the view projects one', () => {
		const view = {
			view: {
				card: 'read',
				path: '/tmp/f.ts',
				offset: 1,
				totalLines: 10,
				lines: [{ number: 1, text: 'x' }],
				lang: 'ts'
			}
		};
		const out = entryForEvent(
			ev('tool/result', {
				message: {
					source: { kind: 'tool', callId: 'c9' },
					content: [{ type: 'tool-result', content: [{ type: 'text', text: 'file body' }], isError: false }]
				}
			}, { view })
		)!;
		expect(out).toMatchObject({ kind: 'tool-result', id: 'tr:c9', ok: true, resultText: 'file body', readView: { path: '/tmp/f.ts', lang: 'ts' } });
	});

	it('isError true flips ok; missing result part stays ok with no text', () => {
		const err = entryForEvent(
			ev('tool/result', {
				message: {
					source: { callId: 'c1' },
					content: [{ type: 'tool-result', content: [{ type: 'text', text: 'nope' }], isError: true }]
				}
			})
		)!;
		expect(err).toMatchObject({ ok: false, summary: 'nope' });

		const empty = entryForEvent(ev('tool/result', { message: { source: { callId: 'c2' }, content: [] } }))!;
		expect(empty).toMatchObject({ ok: true, callId: 'c2' });
		expect(empty).not.toHaveProperty('readView');
	});

	it('falls back to a seq callId when the source is missing', () => {
		const out = entryForEvent(ev('tool/result', {}))!;
		expect(out).toMatchObject({ callId: 'seq:1', id: 'tr:seq:1', toolName: '' });
	});
});

describe('workspace/changes + unknown passthrough', () => {
	it('carries a numeric turn, else folds as fe:unknown', () => {
		expect(entryForEvent(ev('workspace/changes', { turn: 4 }))).toMatchObject({ kind: 'files-edited', id: 'fe:4', turn: 4 });
		expect(entryForEvent(ev('workspace/changes', { turn: 'x' }))).toMatchObject({ id: 'fe:unknown', turn: 0 });
		expect(entryForEvent(ev('workspace/changes', {}))).toMatchObject({ id: 'fe:unknown' });
	});

	it('unknown types render a chip carrying the payload verbatim', () => {
		const out = entryForEvent(ev('brand/new-thing', { a: 1 }))!;
		expect(out).toEqual({ kind: 'unknown-event', id: 'ev:1', seq: 1, time: 1700000000000, eventType: 'brand/new-thing', payload: { a: 1 } });
	});
});

describe('pipeline helpers re-exported from dsh-events', () => {
	it('eventsToEntries drops silent events and merges pairs', () => {
		const out = eventsToEntries([
			ev('todo/write', {}),
			ev('tool/call', { callId: 'c1', name: 'grep', arguments: '{}' }, { seq: 1 }),
			{ ...ev('tool/result', {
				message: { source: { callId: 'c1' }, content: [{ type: 'tool-result', content: [{ type: 'text', text: 'done' }], isError: false }] }
			}), seq: 2, time: 1700000001000 }
		]);
		const call = out.find((e) => e.kind === 'tool-call') as { status: string };
		const result = out.find((e) => e.kind === 'tool-result');
		expect(call.status).toBe('pass');
		expect(result).toMatchObject({ ok: true, callId: 'c1' });
	});

	it('collapseSystemPromptEntries and mergeEntries are re-exported and callable', () => {
		const entries = [
			{ kind: 'system-prompt', id: 'sp:1', seq: 1, time: 1, text: 'same' },
			{ kind: 'system-prompt', id: 'sp:2', seq: 2, time: 2, text: 'same' }
		] as never[];
		const merged = mergeEntries([], entries);
		expect(collapseSystemPromptEntries(merged).length).toBeLessThan(2);
	});
});

describe('groupTurns — developer-message group kind (ADR-0027b task 2.1-T)', () => {
	const devEntry = {
		kind: 'developer-message',
		id: 'dm:7',
		seq: 7,
		time: 1700000000000,
		text: 'tools added: foo'
	} as any;
	const assistant = {
		kind: 'assistant-message',
		id: 'a1',
		seq: 8,
		time: 1700000001000,
		text: 'hi'
	} as any;
	const unknown = {
		kind: 'unknown-event',
		id: 'ev:9',
		seq: 9,
		time: 1700000002000,
		eventType: 'workspace/changes'
	} as any;

	it('forms its own developer group, never folds into an assistant turn', () => {
		const groups = groupTurns([devEntry, assistant]);
		expect(groups.map((g) => g.kind)).toEqual(['developer', 'assistant-turn']);
		expect(groups[0]).toMatchObject({ kind: 'developer', key: 'dm:7' });
		expect((groups[1] as any).entries).toHaveLength(1);
	});

	it('never joins the escape family — unknown-event counts unaffected', () => {
		const groups = groupTurns([assistant, unknown, devEntry]);
		const kinds = groups.map((g) => g.kind);
		expect(kinds).toContain('developer');
		const escaped = groups.flatMap((g) => (g.kind === 'assistant-turn' ? g.entries : [])).filter((e) => e.kind === 'unknown-event');
		expect(escaped).toHaveLength(1);
	});
});
