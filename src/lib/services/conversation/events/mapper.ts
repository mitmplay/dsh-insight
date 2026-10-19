/**
 * dsh-events/mapper — the event→DsiEntry mapper moved whole from
 * dsh-events.ts (ADR-0022 W3): the silent-type roster and entryForEvent.
 * Pure mapping, no I/O, no Svelte; the roster doc comments ride verbatim.
 */

import type { DsiEntry } from '$lib/types';
import {
	bubbleId,
	callSummary,
	firstOfType,
	imageRefsOfContent,
	readStr,
	readViewFrom,
	textOfContent,
	usageOf,
	type DshRawEvent
} from './content';
import { contextInjectionProducer } from './context-injection';

/**
 * Internal harness markers that never render in the transcript: policy
 * snapshots, turn/step bookkeeping, projections, retry plumbing. They are
 * durable truth for the harness, noise for a conversation page.
 *
 * NOT silent since 2026-09-01: `request/header` carries the rendered system
 * prompt (`header.system`) — transcript content in DSH's own Chat — and now
 * maps to a `system-prompt` entry. `request/context` stays silent (route
 * metadata, no user-visible text).
 */
const SILENT_TYPES: ReadonlySet<string> = new Set([
	'agent-preset/selected', // which agent setup was picked for this session — setup news, not chat
	'agent/inbox/spliced', // a queued message was edited/removed/rushed — the agent's to-do list changed, not the conversation
	'approval/decided', // someone answered a yes/no permission question — the asking + doing show up elsewhere
	'approval/policy', // the permission rules changed — house rules, not conversation
	'approval/asked', // interactive answering is out of scope (PRD §6) — chip would be dead UI
	'command/done', // a slash-command finished — you'll see what it DID, not the paperwork
	'command/run', // a slash-command started — same paperwork rule
	// ADR-0027f (2026-10-19): the present tool's durable receipt — one per
	// successful present; the files are session-wide truth. silent · hand-off:
	// the DeliverablesButton's popup on the FloatingAnchor stack renders the
	// inventory (the raw events lane feeds it; the entries lane drops this
	// type by design).
	'deliverables/presented',
	'compaction/end', // the harness finished squeezing old history into a summary — invisible maintenance
	'compaction/prune', // old trimmed history was dropped for real — invisible maintenance
	'compaction/start', // the harness started squeezing old history — invisible maintenance
	'compaction/summary', // the squeeze's summary text was saved — you'll see it via normal messages if it matters
	'feedback/record', // thumbs-up/down on a message was logged — ratings aren't chat
	'goal/change', // a long-running goal was created/updated — project management, not conversation
	'hook/invoked', // an automation script was triggered — plumbing behind the wall
	'hook/result', // that automation script finished — plumbing behind the wall
	// 0.2.1: one background job registered/settled (packages/jobs/jobs/src/types.ts,
	// DSH 0.2.1-alpha.1) — the job's tool calls and the jobs panel show the work;
	// falling through rendered one unknown-event chip per job.
	'job/registered',
	'job/settled',
	'llm/retry', // the AI hiccuped and was re-asked — you only care that an answer eventually came
	'llm/retry-started', // the re-ask began — same hiccup rule
	// 0.1.3 ledger v2: one model attempt that settled WITHOUT a surface
	// message (failed, retried, cancelled, stream-error). Its content rides
	// the embedded stream; the retry's own assistant/message (or the turn's
	// turn/end error) is the transcript truth — the attempt itself is retry
	// plumbing, silent exactly like llm/retry. Falling through rendered one
	// unknown-event chip per retried step.
	'assistant/attempt',
	'permission/preset', // a preset of permission answers was applied — house rules, not chat
	'plan/mode', // plan mode turned on/off — a mode switch, not a message
	'request/context', // route metadata the harness attached to a request — invisible plumbing
	'sandbox/mode', // file-access safety rules changed — house rules, not chat
	'schedule/change', // a timer/schedule was set or cleared — calendar noise for a transcript
	// The ledger's own header line (identity · cwd · preset, no seq —
	// The Turn Kept Whole D5): known bookkeeping the workspace surface
	// already shows; falling through rendered an `ev:undefined` chip at
	// the top of every transcript.
	'session', // the log's own cover page (who/where/which setup) — shown elsewhere
	'session/end-seed', // seed data for a fresh forked session — plumbing, not chat
	'session/title', // the session got its name — shown in the sidebar, not the transcript
	'session/title-llm-request', // the AI was asked to think up that name — behind the scenes
	'step/end', // one internal step of a turn finished — bookkeeping
	'step/start', // one internal step of a turn began — bookkeeping
	// 0.1.5-alpha.2 parent-catalog fact (packages/subagent/subagent/src/catalog.ts):
	// one per delegation, payload is child id/timestamp — roster bookkeeping whose
	// visible side (the sub-agent's messages) arrives as its own events. Falling
	// through rendered one unknown-event chip per delegation.
	'subagent/catalog',
	'subagent/descriptor', // a sub-agent introduced itself — its actual messages show up normally
	'team/member', // someone joined/left the agent team — roster news, not chat
	'team/message/delivered', // a team message landed — the content arrives as its own message
	'team/message/queued', // a team message is waiting in line — same content-elsewhere rule
	'team/task', // a task was assigned to the team — project management, not conversation
	'todo/write', // the to-do list was updated — shown in its own panel, not the transcript
	// NOT silent since 2026-09-05: tool/ptc-dispatch(-start) fold onto the
	// parent run_code tool-call entry at merge (ADR D1/D2) — never standalone.
	// DSH 0.1.5-alpha.1 renamed the wire spellings from tool/code-dispatch(-start)
	// (commit bad4254d71); the host migrates old logs, so only the new names match.
	// NOT silent since 2026-09-25 (Turn End Stamp ADR D1): turn/start maps to
	// a turn-lifecycle MARKER entry — pipeline-faithful, never rendered; the
	// projection folds it. What it produced is still what you read.
	// 'turn/start',
	'web/deepseek-search-llm-request' // a web-search prompt was sent to the AI — background prep, not chat
]);

/**
 * Map ONE raw event to its DsiEntry (or null when it renders nothing).
 *
 * Streaming bubbles are STORE state (applyLiveStream), never mapper output:
 * the live tail is seq-less and arrives beside the durable events, not as
 * one.
 */
export function entryForEvent(event: DshRawEvent): DsiEntry | null {
	if (SILENT_TYPES.has(event.type)) return null;
	const data = event.data;

	// A mapped-type event with NO data at all is uninterpretable — render it as
	// a passthrough chip rather than dropping it (pinned by the api-dsh tests:
	// seqs must survive even when a payload is absent).
	if (data === undefined) {
		return { kind: 'unknown-event', id: `ev:${event.seq}`, seq: event.seq, time: event.time, eventType: event.type };
	}

	switch (event.type) {
		case 'system/message': {
			// The 2026-09-10 node-zero mapping (Empty Prompt Popup ADR, D1/D2):
			// since DSH 0.1.5 (ee956c720d) the rendered system prompt is surface
			// node zero — a system/message event whose message.content text
			// blocks carry the prompt verbatim. Map to the SAME system-prompt
			// entry the header fallback produces, so SystemPromptChip and the
			// identical-text collapse keep working unchanged. Empty content is
			// the host's "no prompt" signal (SystemMessage contract) — no entry.
			const message = data?.message as { content?: unknown } | undefined;
			const text = textOfContent(message?.content);
			if (typeof text !== 'string' || text.length === 0) return null;
			return {
				kind: 'system-prompt',
				id: `sp:${event.seq}`,
				seq: event.seq,
				time: event.time,
				text
			};
		}

		case 'request/header': {
			// LEGACY fallback (2026-09-10, Empty Prompt Popup ADR, D3): the
			// 2026-09-01 un-silencing read the system prompt from this header
			// event, but DSH 0.1.5 removed header.system (the prompt became
			// surface node zero — the system/message case above). Pre-0.1.5
			// session logs still record the prompt here and nowhere else, so
			// the case stays for replay; on modern logs it returns null. One
			// entry per header that carries a system; identical-text collapse
			// is MERGE-time work in the store, never mapper state (scroll-up
			// pages map through fresh calls and cannot see earlier text).
			const system = (data?.header as { system?: unknown } | undefined)?.system;
			if (typeof system !== 'string' || system.length === 0) return null;
			return {
				kind: 'system-prompt',
				id: `sp:${event.seq}`,
				seq: event.seq,
				time: event.time,
				text: system
			};
		}

		case 'user/message': {
			const text = textOfContent(data?.content);
			const id = typeof data?.id === 'string' ? `u:${data.id}` : `u:seq:${event.seq}`;
			// Wave 3 (task 3.1): image blocks ride the same content array —
			// refs surface beside text (BC-A5: the render reads the ledger's
			// pointers, never the browser draft).
			const imageRefs = imageRefsOfContent(data?.content);
			// POC-3 W2 (task 2.4): the fixture-pinned context-injection FAMILY →
			// attributed chip, not paragraph (runtime-context detector became one
			// member; AGENTS.md instructions + skill-catalog join it).
			const producer = contextInjectionProducer(data);
			if (producer) {
				const src = data.source as Record<string, unknown> | undefined;
				return {
					kind: 'user-message',
					id,
					seq: event.seq,
					time: event.time,
					text,
					meta: producer,
					...(src !== undefined ? { metaSource: src } : {}),
					...(imageRefs !== undefined ? { imageRefs } : {})
				};
			}
			return {
				kind: 'user-message',
				id,
				seq: event.seq,
				time: event.time,
				text,
				...(imageRefs !== undefined ? { imageRefs } : {})
			};
		}

		// 0.1.3 ledger v2 removed the durable assistant/chunk event (streams
		// embed in assistant/message / assistant/attempt). Live streaming text
		// rides the follow's assistant-stream frames → the connection's live
		// tail → the store's applyLiveStream; this mapper never sees a chunk.

		case 'assistant/message': {
			const message = data?.message as { content?: unknown; source?: unknown } | undefined;
			// Wave 2 (task 2.3): the finalized message's {type:'reasoning'} block
			// is AUTHORITATIVE — it replaces whatever streamed as reasoning
			// prefix (live-probed shape: final messages carry reasoning blocks
			// beside text blocks).
			const reasoning = firstOfType(message?.content, 'reasoning') as { text?: unknown } | undefined;
			const reasoningText = typeof reasoning?.text === 'string' && reasoning.text.length > 0 ? reasoning.text : undefined;
			// DSH turn-usage route parity: message.source carries the provider/
			// model attribution shown in the usage popup (token-meter messageRoute).
			const source = message?.source as { provider?: unknown; model?: unknown } | undefined;
			const usage = usageOf(data?.usage, source);
			return {
				kind: 'assistant-message',
				id: bubbleId(data?.turn, data?.step),
				seq: event.seq,
				time: event.time,
				text: textOfContent(message?.content),
				streaming: false,
				...(reasoningText !== undefined ? { reasoning: reasoningText, reasoningStreaming: false } : {}),
				...(usage !== undefined ? { usage } : {})
			};
		}

			// Turn failure (2026-08-22, dead-turn bug): turn/end reason.kind ===
			// 'error' is the ONLY honest surface of a turn that died without a
			// reply (e.g. MISSING_CREDENTIAL). Without this, the prompt bubble
			// sits alone and the failure is invisible. The assistant/chunk
			// finish {kind:'error'} duplicate is deliberately NOT mapped: one error
			// surface per turn, keyed on the terminal event.
			// Turn End Stamp (2026-09-25, ADR D1): every turn/end still maps to
			// NO transcript entry — non-error ends become turn-lifecycle MARKER
			// entries the projection folds (turn bookkeeping, not transcript —
			// the policy holds for what renders).
		case 'turn/end': {
			const reason = data?.reason as { kind?: unknown; reason?: { kind?: unknown }; error?: { code?: unknown; message?: unknown } } | undefined;
			if (reason?.kind !== 'error') {
				const turnNum = typeof data?.turn === 'number' ? data.turn : 0;
				return {
					kind: 'turn-lifecycle',
					id: `tl:${turnNum}:end`,
					seq: event.seq,
					time: event.time,
					turn: turnNum,
					phase: 'end',
					reasonKind: readStr(reason?.kind),
					...(reason?.kind === 'aborted' ? { abortKind: readStr(reason.reason?.kind) } : {})
				};
			}
			const message = readStr(reason.error?.message) ?? 'turn ended with an error';
			return {
				kind: 'turn-error',
				id: `te:${event.seq}`,
				seq: event.seq,
				time: event.time,
				message,
				...(readStr(reason.error?.code) !== undefined ? { code: readStr(reason.error?.code) } : {})
			};
		}

		// Turn bracket start (Turn End Stamp ADR D1): same marker family as
		// turn/end above — un-silenced so the projection sees the pair.
		case 'turn/start': {
			const turnNum = typeof data?.turn === 'number' ? data.turn : 0;
			return {
				kind: 'turn-lifecycle',
				id: `tl:${turnNum}:start`,
				seq: event.seq,
				time: event.time,
				turn: turnNum,
				phase: 'start'
			};
		}

		// ── PTC sub-dispatch fold (2026-09-05 ADR D1/D2): one partial entry per
		// sub-call, folded onto the parent tool-call entry at merge time ──
		// `-start` carries identity (name + args) for the live placeholder;
		// the settled event fills content/isError. Wire shapes pinned from
		// packages/core/tools/src/ptc.ts (binding + settle appends) and
		// session 7ec16d54's ledger.
		case 'tool/ptc-dispatch-start':
		case 'tool/ptc-dispatch': {
			const parentCallId = readStr(data?.parentCallId);
			const subCallId = readStr(data?.subCallId);
			if (parentCallId === undefined || subCallId === undefined) return null;
			const args = data?.arguments;
			return {
				kind: 'code-dispatch',
				id: `cd:${subCallId}`,
				seq: event.seq,
				time: event.time,
				parentCallId,
				subCallId,
				name: readStr(data?.name) ?? 'tool',
				...(args !== undefined ? { argsRaw: JSON.stringify(args) } : {}),
				settled: event.type === 'tool/ptc-dispatch',
				...(event.type === 'tool/ptc-dispatch'
					? { isError: data?.isError === true, contentText: textOfContent(data?.content) || undefined }
					: {})
			};
		}

		case 'tool/call': {
			const callId = readStr(data?.callId) ?? `seq:${event.seq}`;
			const argsRaw = readStr(data?.arguments);
			return {
				kind: 'tool-call',
				id: `tc:${callId}`,
				seq: event.seq,
				time: event.time,
				callId,
				toolName: readStr(data?.name) ?? 'tool',
				summary: callSummary(event, argsRaw ?? ''),
				argsRaw,
				status: 'pending' // merge flips to pass/fail when the paired tool/result arrives
			};
		}

		// ── tool-workflow lifecycle (2026-08-31): four events, ONE entry ──
		// Each maps to a workflow-run PARTIAL carrying only what the event
		// proves; mergeWorkflowRun folds partials by id (`wf:<runId>`).
		// Wire shapes pinned from packages/workflow/tool-workflow/src
		// (types.ts + index.ts recorder).
		case 'tool-workflow/run-start': {
			const runId = readStr(data?.runId) ?? `seq:${event.seq}`;
			return {
				kind: 'workflow-run',
				id: `wf:${runId}`,
				seq: event.seq,
				time: event.time,
				runId,
				name: readStr(data?.name) ?? 'workflow',
				status: 'running',
				agents: []
			};
		}
		case 'tool-workflow/agent-start': {
			const runId = readStr(data?.runId) ?? `seq:${event.seq}`;
			const memberSeq = typeof data?.seq === 'number' ? data.seq : -1;
			const phase = readStr(data?.phase);
			return {
				kind: 'workflow-run',
				id: `wf:${runId}`,
				seq: event.seq,
				time: event.time,
				runId,
				name: '', // the run-start partial owns the name
				status: 'running',
				agents: [
					{
						seq: memberSeq,
						label: readStr(data?.label) ?? `agent ${memberSeq}`,
						childId: readStr(data?.childId) ?? '',
						...(phase !== undefined ? { phase } : {}),
						status: 'running',
						startedAt: event.time
					}
				]
			};
		}
		case 'tool-workflow/agent-end': {
			const runId = readStr(data?.runId) ?? `seq:${event.seq}`;
			const memberSeq = typeof data?.seq === 'number' ? data.seq : -1;
			const outcome = readStr(data?.outcome);
			return {
				kind: 'workflow-run',
				id: `wf:${runId}`,
				seq: event.seq,
				time: event.time,
				runId,
				name: '',
				status: 'running',
				agents: [
					{
						seq: memberSeq,
						label: '',
						childId: '',
						status: outcome === 'completed' || outcome === 'failed' ? outcome : 'cancelled',
						startedAt: 0,
						endedAt: event.time
					}
				]
			};
		}
		case 'tool-workflow/run-end': {
			const runId = readStr(data?.runId) ?? `seq:${event.seq}`;
			const stopReason = readStr(data?.stopReason);
			return {
				kind: 'workflow-run',
				id: `wf:${runId}`,
				seq: event.seq,
				time: event.time,
				runId,
				name: '',
				status: stopReason === 'completed' ? 'completed' : stopReason === 'error' ? 'failed' : 'cancelled',
				agents: []
			};
		}

		case 'tool/result': {
			const message = data?.message as
				| { source?: { callId?: unknown }; content?: unknown }
				| undefined;
			const callId = readStr(message?.source?.callId) ?? `seq:${event.seq}`;
			const resultPart = firstOfType(message?.content, 'tool-result') as
				| { content?: unknown; isError?: unknown }
				| undefined;
			const resultText = textOfContent(resultPart?.content) || undefined;
			return {
				kind: 'tool-result',
				id: `tr:${callId}`,
				seq: event.seq,
				time: event.time,
				callId,
				toolName: '', // paired from the tool-call entry at merge time
				ok: !resultPart || resultPart.isError !== true,
				summary: resultText,
				resultText, // wire: tool-result block's text — full, untruncated
				...readViewFrom(event.view) !== undefined ? { readView: readViewFrom(event.view) } : {}
			};
		}

		case 'workspace/changes': {
			// Edited-Files Card (ADR 2026-09-25, D1): the wire payload is
			// { turn } — the pointer, not the summary (D2: the summary stays
			// in Host memory; the card borrows it at render time). Turn is
			// carried verbatim when numeric; a non-numeric payload still
			// folds as the fe:unknown pointer — never dropped, never a chip.
			const turn = (data as { turn?: unknown } | undefined)?.turn;
			const numeric = typeof turn === 'number' && Number.isFinite(turn);
			return {
				kind: 'files-edited',
				id: numeric ? `fe:${turn}` : 'fe:unknown',
				seq: event.seq,
				time: event.time,
				turn: numeric ? (turn as number) : 0
			};
		}

		default:
			// Unknown type — the harness recorded something this build does not
			// know. Render it as a chip rather than dropping it (forward-compat).
			// The payload rides verbatim so the popup renders it (the
			// 2026-09-18 empty-popup fix: workspace/changes opened
			// nothing; deliverables/presented since moved to its anchor
			// surface, ADR-0027f).
			return { kind: 'unknown-event', id: `ev:${event.seq}`, seq: event.seq, time: event.time, eventType: event.type, payload: data };
	}
}
