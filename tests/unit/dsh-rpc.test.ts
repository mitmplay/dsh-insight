import { describe, expect, it } from 'vitest';
import {
	DSH_ARGS,
	DSH_METHODS,
	DshRpcError,
	buildPromptContent,
	encodeRequest,
	encodeRespond,
	isPromptImageMediaType,
	mapRpcFailure,
	parseResponse,
	parseRespondReceipt,
	parseServerRequest,
	respondUrl,
	rpcUrl
} from '$lib/server/dsh-rpc';

describe('dsh-rpc envelope', () => {
	it('encodes a client-request with rpcId + method + payload', () => {
		const raw = encodeRequest('id-1', DSH_METHODS.list, {});
		const parsed = JSON.parse(raw) as { type: string; rpcId: string; method: string; payload: unknown };
		expect(parsed.type).toBe('client-request');
		expect(parsed.rpcId).toBe('id-1');
		// 0.1.2 wire: slash-joined methods mirror the endpoint path.
		expect(parsed.method).toBe('session/list');
		expect(parsed.payload).toEqual({});
	});

	it('round-trips: encode → host answer → parse returns the ok value', () => {
		const raw = encodeRequest('id-2', DSH_METHODS.prompt, {
			sessionId: 'session-x',
			mode: 'queue',
			content: [{ type: 'text', text: 'Hi' }]
		});
		const sent = JSON.parse(raw);
		// host echoes rpcId in server-response
		const hostReply = JSON.stringify({
			type: 'server-response',
			rpcId: sent.rpcId,
			result: { ok: true, value: { accepted: true } }
		});
		expect(parseResponse(hostReply, 'id-2')).toEqual({ accepted: true });
	});

	it('throws on rpcId mismatch (sent vs echoed)', () => {
		const hostReply = JSON.stringify({
			type: 'server-response',
			rpcId: 'other-id',
			result: { ok: true, value: {} }
		});
		expect(() => parseResponse(hostReply, 'id-3')).toThrow(/rpcId mismatch/);
	});

	it('throws on non-JSON response', () => {
		expect(() => parseResponse('not json{', 'id-4')).toThrow(/not JSON/);
	});

	it('throws on wrong envelope type', () => {
		const notAResponse = JSON.stringify({ type: 'server-request', rpcId: 'id-5', method: 'x', payload: {} });
		expect(() => parseResponse(notAResponse, 'id-5')).toThrow(/server-response/);
	});
});

describe('dsh-rpc error mapping', () => {
	it('ok:false result throws DshRpcError carrying code + message + details', () => {
		const hostReply = JSON.stringify({
			type: 'server-response',
			rpcId: 'id-6',
			result: { ok: false, error: { code: 'session/agent-busy', message: 'agent is busy', details: { foo: 1 } } }
		});
		try {
			parseResponse(hostReply, 'id-6');
			expect.unreachable('should have thrown');
		} catch (e) {
			expect(e).toBeInstanceOf(DshRpcError);
			const err = e as DshRpcError;
			expect(err.code).toBe('session/agent-busy');
			expect(err.message).toContain('agent is busy');
			expect(err.details).toEqual({ foo: 1 });
		}
	});

	it('session/not-found maps through with its details', () => {
		const hostReply = JSON.stringify({
			type: 'server-response',
			rpcId: 'id-7',
			result: {
				ok: false,
				error: { code: 'session/not-found', message: 'no such session', details: { sessionId: 'session-x' } }
			}
		});
		expect(() => parseResponse(hostReply, 'id-7')).toThrowError(DshRpcError);
		expect(() => parseResponse(hostReply, 'id-7')).toThrow(/session\/not-found/);
	});
});

describe('dsh-rpc server-request parsing (mux/host frames)', () => {
	it('parses a session/subscribed baseline frame', () => {
		const raw = JSON.stringify({
			type: 'server-request',
			rpcId: 'frame-1',
			method: 'session/subscribed',
			payload: { type: 'session/subscribed', sessionId: 'session-x', lastSeq: 6845 }
		});
		const frame = parseServerRequest(raw);
		expect(frame.method).toBe('session/subscribed');
		expect(frame.payload).toEqual({
			type: 'session/subscribed',
			sessionId: 'session-x',
			lastSeq: 6845
		});
	});

	it('rejects a non server-request envelope', () => {
		const raw = JSON.stringify({ type: 'server-response', rpcId: 'x', result: { ok: true, value: {} } });
		expect(() => parseServerRequest(raw)).toThrow(/server-request/);
	});
});

describe('dsh-rpc url building', () => {
	it('builds {base}/api/{method} with no double slash', () => {
		expect(rpcUrl('http://127.0.0.1:3080', 'session.list')).toBe('http://127.0.0.1:3080/api/session.list');
	});

	it('trims trailing slashes on the base', () => {
		expect(rpcUrl('http://127.0.0.1:3080//', 'session.list')).toBe('http://127.0.0.1:3080/api/session.list');
	});
});

describe('dsh-rpc respond carrier (POC-3 W1 — client-response, NOT a unary method)', () => {
	it('encodeRespond produces the client-response envelope pinned by rpc.schema.ts', () => {
		const raw = encodeRespond('rpc-a1', { sessionId: 's1', approvalId: 'apr-1', outcome: 'allowed-once' });
		const parsed = JSON.parse(raw) as Record<string, unknown>;
		// {type:'client-response', rpcId, result:{ok:true, value: payload}} — live-pinned
		// against rc.8 2026-08-21: result is a FULL RpcResult; a bare {value} is
		// rejected bad-response by the host schema (fetch/handler.ts:296).
		expect(parsed.type).toBe('client-response');
		expect(parsed.rpcId).toBe('rpc-a1');
		expect(parsed.result).toEqual({ ok: true, value: { sessionId: 's1', approvalId: 'apr-1', outcome: 'allowed-once' } });
		// and critically: NO method field — it is absent from RpcMethodMap
		expect('method' in parsed).toBe(false);
	});

	it('encodeRespond carries the question payload shape verbatim', () => {
		const raw = encodeRespond('rpc-q1', {
				sessionId: 's1',
				answer: { answers: [{ id: 'q1', selected: ['o2'], custom: 'why not' }] }
			});
		const parsed = JSON.parse(raw) as { result: { value: Record<string, unknown> } };
		expect(parsed.result.value).toEqual({
			sessionId: 's1',
			answer: { answers: [{ id: 'q1', selected: ['o2'], custom: 'why not' }] }
		});
	});

	it('parseRespondReceipt accepts the accepted arm', () => {
		expect(parseRespondReceipt(JSON.stringify({ accepted: true }))).toEqual({ accepted: true });
	});

	it('parseRespondReceipt accepts the not-pending arm with reason (BC-B)', () => {
		const receipt = parseRespondReceipt(JSON.stringify({ accepted: false, reason: 'not-pending' }));
		expect(receipt).toEqual({ accepted: false, reason: 'not-pending' });
	});

	it('parseRespondReceipt accepts the bad-response arm', () => {
		const receipt = parseRespondReceipt(JSON.stringify({ accepted: false, reason: 'bad-response' }));
		expect(receipt).toEqual({ accepted: false, reason: 'bad-response' });
	});

	it('parseRespondReceipt throws on non-JSON', () => {
		expect(() => parseRespondReceipt('nope{')).toThrow(/not JSON/);
	});

	it('parseRespondReceipt throws on a non-RpcReceipt shape (e.g. an RpcResult envelope)', () => {
		expect(() => parseRespondReceipt(JSON.stringify({ type: 'server-response', result: { ok: true } }))).toThrow(
			/not an RpcReceipt/
		);
	});

	it('respondUrl builds {base}/api/respond', () => {
		expect(respondUrl('http://127.0.0.1:3080')).toBe('http://127.0.0.1:3080/api/respond');
		expect(respondUrl('http://127.0.0.1:3080//')).toBe('http://127.0.0.1:3080/api/respond');
	});

	it('BC-6 closed set: respond joins as a CARRIER, not a DSH_METHODS entry', () => {
		// The wire method table stays untouched — respond is a client-response
		// on its own carrier (approvals.ts: absent from RpcMethodMap).
		expect(Object.values(DSH_METHODS)).not.toContain('respond');
		expect(Object.keys(DSH_METHODS)).not.toContain('respond');
	});
});

describe('dsh-rpc mapRpcFailure — native-picker details passthrough', () => {
	it('carries DshRpcError details when the host sent them', () => {
		const err = new DshRpcError(
			'directory-picker/unavailable',
			'host.listDirectory needs the browse capability; the composed picker serves "native"',
			{ capability: 'native' }
		);
		const body = mapRpcFailure(err);
		expect(body.error.code).toBe('directory-picker/unavailable');
		expect(body.error.details).toEqual({ capability: 'native' });
	});

	it('omits the details key when the host sent none (shape-stable)', () => {
		const body = mapRpcFailure(new DshRpcError('session/agent-busy', 'busy'));
		expect(body.error).toEqual({ code: 'session/agent-busy', message: 'DSH RPC session/agent-busy: busy' });
		expect('details' in body.error).toBe(false);
	});
});

describe('dsh-rpc prompt image contract (task 2.1)', () => {
	it('accepts exactly the four whitelisted raster media types', () => {
		for (const ok of ['image/png', 'image/jpeg', 'image/webp', 'image/gif']) {
			expect(isPromptImageMediaType(ok)).toBe(true);
		}
		for (const bad of ['image/tiff', 'application/pdf', 'image/png ', '', 'text/plain']) {
			expect(isPromptImageMediaType(bad)).toBe(false);
		}
	});

	it('builds images-first content with the text part last', () => {
		const content = buildPromptContent('look', [
			{ type: 'image', mediaType: 'image/png', data: 'AAAA' },
			{ type: 'image', mediaType: 'image/gif', data: 'BBBB', name: 'anim.gif' }
		]);
		expect(content).toEqual([
			{ type: 'image', mediaType: 'image/png', data: 'AAAA' },
			{ type: 'image', mediaType: 'image/gif', data: 'BBBB', name: 'anim.gif' },
			{ type: 'text', text: 'look' }
		]);
	});

	it('omits the text part for attachments-only sends; empty-everything is an empty array', () => {
		expect(buildPromptContent('', [{ type: 'image', mediaType: 'image/png', data: 'AAAA' }])).toEqual([
			{ type: 'image', mediaType: 'image/png', data: 'AAAA' }
		]);
		expect(buildPromptContent('', [])).toEqual([]);
		expect(buildPromptContent('note', [])).toEqual([{ type: 'text', text: 'note' }]);
	});
});

describe('dsh-rpc catalog methods (Slash Menu W1 — commands/list + skills/list)', () => {
	/**
	 * ⛔ LIVE PIN — recorded 2026-08-30, Wave 1 Task 1.1-T gate (ADR §3.3):
	 * one round-trip of EACH catalog method against a running `dsh web`
	 * (dsh-0.1.2-alpha.1, live host 127.0.0.1:3080, session
	 * session-de761bc6-382e-4903-82ce-729d992e8b6a minted for the pin, app-dev
	 * preset). Wire record (envelope: POST /api/{method} with
	 * {type:'client-request', rpcId, method, payload:{args:<builder output>}}
	 * — dsh-connection.rpc's exact body):
	 *
	 *   POST /api/skills/list  args {request:{sessionId}}
	 *     → ok:true value {skills:[…]} — 10 rows, e.g.
	 *       {name:'dsh-doc', description:'Create, restructure, review…',
	 *        modelInvocable:true}  (whenToUse ABSENT on every live row —
	 *        optional on the wire, confirmed by absence)
	 *   POST /api/commands/list args {agentId}
	 *     → ok:true value […] — 5 name-sorted rows:
	 *       compact, export, feedback{input:{hint:'<text>'}},
	 *       permission{input:{hint:'<preset>'}},
	 *       plan{input:{hint:'[off|message]', images:true}}
	 *
	 * Row/receipt types: DshCommandRow / DshSkillRow / DshSkillList (below).
	 * Probe files deleted after the run — this comment is the durable record.
	 */

	it('pins both method strings verbatim (BC-6 grow-by-spec entries)', () => {
		expect(DSH_METHODS.commandsList).toBe('commands/list');
		expect(DSH_METHODS.skillsList).toBe('skills/list');
	});

	it('commandsList builder: {agentId} — the descriptor-exact arg', () => {
		expect(DSH_ARGS.commandsList('session-x')).toEqual({ agentId: 'session-x' });
	});

	it('skillsList builder: {request:{sessionId}} — the descriptor-exact arg', () => {
		expect(DSH_ARGS.skillsList('session-x')).toEqual({ request: { sessionId: 'session-x' } });
	});

	it('builders never leak extra keys (exact-match args contract)', () => {
		expect(Object.keys(DSH_ARGS.commandsList('s'))).toEqual(['agentId']);
		expect(Object.keys(DSH_ARGS.skillsList('s'))).toEqual(['request']);
	});

	it('workspaceFiles builders: scope wire workspaceFileScopeId — the descriptor-exact arg (renamed from agentId, host 2026-09-09)', () => {
		expect(DSH_ARGS.workspaceFileList('s1', 'docs')).toEqual({ workspaceFileScopeId: 's1', path: 'docs' });
		expect(DSH_ARGS.workspaceFileRead('s1', 'a.md', { offset: 1 })).toEqual({ workspaceFileScopeId: 's1', path: 'a.md', range: { offset: 1 } });
		expect(DSH_ARGS.workspaceFileReadBytes('s1', 'a.png', { offset: 0, length: 8 })).toEqual({ workspaceFileScopeId: 's1', path: 'a.png', range: { offset: 0, length: 8 } });
		expect(Object.keys(DSH_ARGS.workspaceFileList('s', ''))).toEqual(['workspaceFileScopeId', 'path']);
	});

	it('workspaceRename/Delete: method strings verbatim (Chip Menu ADR D3)', () => {
		expect(DSH_METHODS.workspaceRename).toBe('workspace/rename');
		expect(DSH_METHODS.workspaceDelete).toBe('workspace/delete');
	});

	it('workspaceRename builder: {request:{workspaceId,title}} — the descriptor-exact envelope', () => {
		expect(DSH_ARGS.workspaceRename('ws-1', 'Renamed Home')).toEqual({ request: { workspaceId: 'ws-1', title: 'Renamed Home' } });
	});

	it('workspaceDelete builder: {request:{workspaceId}} — the descriptor-exact envelope', () => {
		expect(DSH_ARGS.workspaceDelete('ws-1')).toEqual({ request: { workspaceId: 'ws-1' } });
	});

	it('workspace builders never leak extra keys (exact-match args contract)', () => {
		expect(Object.keys(DSH_ARGS.workspaceRename('w', 't'))).toEqual(['request']);
		expect(Object.keys(DSH_ARGS.workspaceDelete('w'))).toEqual(['request']);
	});

	it('encodeRequest carries the workspace builders verbatim as payloads', () => {
		const renameEnvelope = JSON.parse(encodeRequest('pin-ws-1', DSH_METHODS.workspaceRename, DSH_ARGS.workspaceRename('ws-1', 'Home')));
		expect(renameEnvelope.method).toBe('workspace/rename');
		expect(renameEnvelope.payload).toEqual({ request: { workspaceId: 'ws-1', title: 'Home' } });
		const deleteEnvelope = JSON.parse(encodeRequest('pin-ws-2', DSH_METHODS.workspaceDelete, DSH_ARGS.workspaceDelete('ws-1')));
		expect(deleteEnvelope.method).toBe('workspace/delete');
		expect(deleteEnvelope.payload).toEqual({ request: { workspaceId: 'ws-1' } });
	});

	it('encodeRequest carries each builder output verbatim as its payload', () => {
		// The {args:<builder>} wrap is dsh-connection.rpc's body (L1245) — the
		// live pin exercised it end-to-end (skills 10 rows / commands 5 rows);
		// encodeRequest itself carries the payload verbatim, so the pin shape is:
		// payload === builder output, wrapped once by the caller.
		const skillsEnvelope = JSON.parse(encodeRequest('pin-1', DSH_METHODS.skillsList, DSH_ARGS.skillsList('session-x')));
		expect(skillsEnvelope.method).toBe('skills/list');
		expect(skillsEnvelope.payload).toEqual({ request: { sessionId: 'session-x' } });
		const commandsEnvelope = JSON.parse(encodeRequest('pin-2', DSH_METHODS.commandsList, DSH_ARGS.commandsList('session-x')));
		expect(commandsEnvelope.method).toBe('commands/list');
		expect(commandsEnvelope.payload).toEqual({ agentId: 'session-x' });
	});
});

describe('dsh-rpc fork method (The Fork Button ADR, 2026-09-01)', () => {
	/**
	 * ⛔ LIVE PIN — recorded 2026-09-01 against a running host
	 * (dsh-0.1.2-alpha.3, live host 127.0.0.1:3080, throwaway session
	 * session-bd679bd4 minted for the pin, archived after). Wire record
	 * (envelope: payload:{args:<builder output>}, dsh-connection.rpc's body):
	 *
	 *   POST /api/session/fork  args {request:{sessionId}}
	 *     → refusal on a turn-less source: ok:false error.code
	 *       'session/fork-unavailable', message "…has no completed turn to
	 *       fork from" — the METHOD exists and the descriptor EXACT-MATCHED
	 *       the args (a bare {args:{sessionId}} → gateway/arguments-invalid:
	 *       missing "request"; unexpected "sessionId").
	 *   Success shape pinned by the harness client fixture
	 *   (packages/client/connection/src/client/fixture.ts case 'session/fork'):
	 *   ok:true value {sessionId: <child>}.
	 */

	it('pins the method string verbatim (BC-6 grow-by-spec entry)', () => {
		expect(DSH_METHODS.fork).toBe('session/fork');
	});

	it('fork builder: {request:{sessionId}} — the descriptor-exact arg', () => {
		expect(DSH_ARGS.fork({ sessionId: 'session-x' })).toEqual({ request: { sessionId: 'session-x' } });
	});

	it('an undefined atSeq never reaches the wire (serialization drops it; forkSession also omits it)', () => {
		const args = DSH_ARGS.fork({ sessionId: 's', atSeq: undefined });
		// The host validates the PARSED JSON — an undefined-valued key is gone
		// once the envelope serializes, so the descriptor sees {sessionId} only.
		const wire = JSON.parse(JSON.stringify(args.request)) as Record<string, unknown>;
		expect(wire).toEqual({ sessionId: 's' });
	});

	it('a present atSeq rides verbatim', () => {
		expect(DSH_ARGS.fork({ sessionId: 's', atSeq: 41 })).toEqual({ request: { sessionId: 's', atSeq: 41 } });
	});

	it('builder never leaks extra keys (exact-match args contract)', () => {
		expect(Object.keys(DSH_ARGS.fork({ sessionId: 's' }))).toEqual(['request']);
	});

	it('encodeRequest carries the builder output verbatim as its payload', () => {
		const envelope = JSON.parse(encodeRequest('pin-fork', DSH_METHODS.fork, DSH_ARGS.fork({ sessionId: 'session-x' })));
		expect(envelope.method).toBe('session/fork');
		expect(envelope.payload).toEqual({ request: { sessionId: 'session-x' } });
	});
});
describe('dsh-rpc scheduler methods (ADR-0058 W2 — the read-only shelf face)', () => {
	/**
	 * Wire pins — host truth (~/agentic-ai/deepseek-harness
	 * packages/schedule/schedule/src/types.ts 452-528, verified by the
	 * planner 2026-11-10): schedule/list args
	 * `{request:{active?,limit?,offset?}}` → {items,shown,total,limit,offset};
	 * schedule/view args `{request:{id}}` → a full entry OR the body-code
	 * miss `{id, code:'schedule_not_found'}` — a 200 with the named
	 * discriminator, never an empty 200. The request wrapper is MANDATORY:
	 * a bare args object rejects gateway/arguments-invalid (the fork
	 * precedent above). D4: these two are the ONLY scheduler methods DSI
	 * carries — the set stays read-only by construction.
	 */

	it('pins the method strings verbatim (BC-6 grow-by-spec entries)', () => {
		expect(DSH_METHODS.scheduleList).toBe('schedule/list');
		expect(DSH_METHODS.scheduleView).toBe('schedule/view');
	});

	it('scheduleList builder: no-arg call sends the empty request wrapper', () => {
		expect(DSH_ARGS.scheduleList()).toEqual({ request: {} });
	});

	it('scheduleList builder: filters ride inside request', () => {
		expect(DSH_ARGS.scheduleList({ active: true, limit: 10, offset: 20 })).toEqual({
			request: { active: true, limit: 10, offset: 20 }
		});
	});

	it('scheduleView builder: {request:{id}} — the descriptor-exact arg', () => {
		expect(DSH_ARGS.scheduleView('x')).toEqual({ request: { id: 'x' } });
	});

	it('builders never leak extra keys (exact-match args contract)', () => {
		expect(Object.keys(DSH_ARGS.scheduleList())).toEqual(['request']);
		expect(Object.keys(DSH_ARGS.scheduleView('task-9'))).toEqual(['request']);
		expect(Object.keys(DSH_ARGS.scheduleView('task-9').request as object)).toEqual(['id']);
	});

	it('schedule/list envelope round-trip: items page echoes back', () => {
		const envelope = JSON.parse(
			encodeRequest('pin-sched-list', DSH_METHODS.scheduleList, DSH_ARGS.scheduleList())
		) as { method: string; payload: unknown };
		expect(envelope.method).toBe('schedule/list');
		expect(envelope.payload).toEqual({ request: {} });
		const hostReply = JSON.stringify({
			type: 'server-response',
			rpcId: 'pin-sched-list',
			result: {
				ok: true,
				value: {
					items: [
						{
							id: 'task-1',
							kind: 'at',
							title: 'Dispatch',
							scheduledAt: '2026-11-10T12:00:00Z',
							target: { kind: 'new_once', sessionId: 's-born' },
							involvedSessionIds: ['s-born'],
							status: 'active'
						}
					],
					shown: 1,
					total: 1,
					limit: 100,
					offset: 0
				}
			}
		});
		expect(parseResponse(hostReply, 'pin-sched-list')).toMatchObject({ shown: 1, total: 1 });
	});

	it('schedule/view envelope round-trip: entry value and the body-code miss', () => {
		const envelope = JSON.parse(
			encodeRequest('pin-sched-view', DSH_METHODS.scheduleView, DSH_ARGS.scheduleView('task-9'))
		) as { method: string; payload: unknown };
		expect(envelope.method).toBe('schedule/view');
		expect(envelope.payload).toEqual({ request: { id: 'task-9' } });
		const entryReply = JSON.stringify({
			type: 'server-response',
			rpcId: 'pin-sched-view',
			result: {
				ok: true,
				value: {
					id: 'task-9',
					kind: 'cron',
					title: 'Nightly',
					target: { kind: 'session', sessionId: 's-1' },
					involvedSessionIds: ['s-1'],
					status: 'paused'
				}
			}
		});
		expect(parseResponse(entryReply, 'pin-sched-view')).toMatchObject({ id: 'task-9', status: 'paused' });
		// The miss: a 200 whose value carries the named discriminator —
		// matched by the relay, never an RpcError, never an empty 200.
		const missReply = JSON.stringify({
			type: 'server-response',
			rpcId: 'pin-sched-view',
			result: { ok: true, value: { id: 'task-404', code: 'schedule_not_found' } }
		});
		expect(parseResponse(missReply, 'pin-sched-view')).toEqual({ id: 'task-404', code: 'schedule_not_found' });
	});
});
