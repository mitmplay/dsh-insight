/**
 * host-event-catalog — the checked-in roster of every ledger line kind the
 * host (DSH 0.2.1-alpha.4, packages/core/session/src/known-event-types.ts,
 * 62 generated types) can write, plus the `session` cover line the mapper
 * treats as line zero. 63 kinds total. ADR-0027a D1: hand-synced at every
 * release jump's set-diff (the KB release-note flow performs the diff).
 *
 * Homes (ADR-0027 Table 1, the species contract):
 *  - 'mapped'          entryForEvent renders a real entry
 *  - 'silent-plumbing' entryForEvent returns null; nothing renders anywhere
 *  - 'silent-handoff'  entryForEvent returns null; a NAMED surface outside
 *                      the stream already renders the content
 *  - 'chip'            falls through as an unknown-event chip today, with
 *                      the epic sub-ADR that will re-home it (ADR-0027 b-f)
 *
 * This file is the epic scoreboard: sub-ADRs flip rows in the same commit
 * that changes behavior (ADR-0027a D4).
 */

export type EventHome = 'mapped' | 'silent-plumbing' | 'silent-handoff' | 'chip';

export interface HostEventRow {
	type: string;
	home: EventHome;
	/** Required for silent rows: why it is silent. */
	reason?: string;
	/** Required for silent-handoff rows: the surface that renders the content. */
	surface?: string;
	/** For chip rows: the epic sub-ADR that will re-home this kind. */
	target?: string;
}

export const HOST_EVENT_CATALOG: readonly HostEventRow[] = [
	// -- mapped (15) --
	{ type: 'assistant/message', home: 'mapped' },
	{ type: 'request/header', home: 'mapped' },
	{ type: 'system/message', home: 'mapped' },
	{ type: 'tool/call', home: 'mapped' },
	{ type: 'tool/result', home: 'mapped' },
	{ type: 'tool/ptc-dispatch', home: 'mapped' },
	{ type: 'tool/ptc-dispatch-start', home: 'mapped' },
	{ type: 'tool-workflow/run-start', home: 'mapped' },
	{ type: 'tool-workflow/run-end', home: 'mapped' },
	{ type: 'tool-workflow/agent-start', home: 'mapped' },
	{ type: 'tool-workflow/agent-end', home: 'mapped' },
	{ type: 'turn/start', home: 'mapped', reason: 'turn-lifecycle marker entry (Turn End Stamp ADR D1)' },
	{ type: 'turn/end', home: 'mapped' },
	{ type: 'user/message', home: 'mapped' },
	{ type: 'workspace/changes', home: 'mapped' },
	// -- silent-handoff (16) -- the stream drops it; a named surface shows it
	{ type: 'session', home: 'silent-handoff', reason: 'ledger cover line (The Turn Kept Whole D5)', surface: 'workspace surface (who/where/which setup)' },
	{ type: 'approval/asked', home: 'silent-handoff', reason: 'interactive answering out of scope (PRD section 6)', surface: 'host asking + doing show elsewhere' },
	{ type: 'approval/decided', home: 'silent-handoff', reason: 'the asking + doing show elsewhere', surface: 'host decision flow' },
	{ type: 'approval/policy', home: 'silent-handoff', reason: 'house rules change, not chat', surface: 'host policy surface' },
	{ type: 'goal/change', home: 'silent-handoff', reason: 'goal lifecycle projected', surface: 'GoalBar/GoalCard (goal-projection.ts)' },
	{ type: 'job/registered', home: 'silent-handoff', reason: 'log-only receipt; work shows via jobs wire (ADR-0026)', surface: 'owner row (JobsButton)' },
	{ type: 'job/settled', home: 'silent-handoff', reason: 'log-only receipt; work shows via jobs wire (ADR-0026)', surface: 'owner row (JobsButton)' },
	{ type: 'session/title', home: 'silent-handoff', reason: 'naming news, not chat', surface: 'sidebar' },
	{ type: 'session/title-llm-request', home: 'silent-handoff', reason: 'behind-the-scenes naming ask', surface: 'sidebar (the resulting title)' },
	{ type: 'subagent/catalog', home: 'silent-handoff', reason: 'delegation roster fact (0.1.5-alpha.2)', surface: 'the sub-agent own visible messages' },
	{ type: 'subagent/descriptor', home: 'silent-handoff', reason: 'sub-agent introduction', surface: 'the sub-agent own visible messages' },
	{ type: 'team/member', home: 'silent-handoff', reason: 'roster news, not chat', surface: 'member messages arrive as their own stream events' },
	{ type: 'team/message/delivered', home: 'silent-handoff', reason: 'content arrives as its own event', surface: 'the delivered team message event' },
	{ type: 'team/message/queued', home: 'silent-handoff', reason: 'content arrives as its own event', surface: 'the delivered team message event' },
	{ type: 'team/task', home: 'silent-handoff', reason: 'project management, not conversation', surface: 'team task flow events' },
	{ type: 'todo/write', home: 'silent-handoff', reason: 'to-do list shown in its own surface, never the transcript', surface: 'PlanButton/PlanPopup (FloatingAnchor stack)' },
	// -- silent-plumbing (23) --
	{ type: 'request/context', home: 'silent-plumbing', reason: 'route metadata, no user-visible text' },
	{ type: 'agent-preset/selected', home: 'silent-plumbing', reason: 'setup news, not chat' },
	{ type: 'agent/inbox/spliced', home: 'silent-plumbing', reason: 'queued-message bookkeeping' },
	{ type: 'assistant/attempt', home: 'silent-plumbing', reason: 'attempt without surface message; retry is the truth (ledger v2)' },
	{ type: 'command/done', home: 'silent-plumbing', reason: 'slash-command paperwork' },
	{ type: 'command/run', home: 'silent-plumbing', reason: 'slash-command paperwork' },
	{ type: 'compaction/end', home: 'silent-plumbing', reason: 'invisible maintenance' },
	{ type: 'compaction/prune', home: 'silent-plumbing', reason: 'invisible maintenance' },
	{ type: 'compaction/start', home: 'silent-plumbing', reason: 'invisible maintenance' },
	{ type: 'compaction/summary', home: 'silent-plumbing', reason: 'summary reaches the reader via normal messages' },
	{ type: 'feedback/record', home: 'silent-plumbing', reason: 'ratings are not chat' },
	{ type: 'hook/invoked', home: 'silent-plumbing', reason: 'automation plumbing' },
	{ type: 'hook/result', home: 'silent-plumbing', reason: 'automation plumbing' },
	{ type: 'llm/retry', home: 'silent-plumbing', reason: 'retry plumbing; the answer is the truth' },
	{ type: 'llm/retry-started', home: 'silent-plumbing', reason: 'retry plumbing; the answer is the truth' },
	{ type: 'permission/preset', home: 'silent-plumbing', reason: 'house rules, not chat' },
	{ type: 'plan/mode', home: 'silent-plumbing', reason: 'mode switch, not a message' },
	{ type: 'sandbox/mode', home: 'silent-plumbing', reason: 'file-safety rules, not chat' },
	{ type: 'schedule/change', home: 'silent-plumbing', reason: 'calendar noise for a transcript' },
	{ type: 'session/end-seed', home: 'silent-plumbing', reason: 'fork plumbing' },
	{ type: 'step/end', home: 'silent-plumbing', reason: 'step bookkeeping' },
	{ type: 'step/start', home: 'silent-plumbing', reason: 'step bookkeeping' },
	{ type: 'web/deepseek-search-llm-request', home: 'silent-plumbing', reason: 'background search prep' },
	// -- chip today, with its re-homing sub-ADR (9) --
	// ADR-0027f landed: deliverables render in their own anchor surface
	// (the deliverables.ts reducer), never as a transcript chip.
	{ type: 'deliverables/presented', home: 'silent-handoff', reason: 'deliverables render in their own anchor surface, not the transcript (ADR-0027f)', surface: 'DeliverablesButton (FloatingAnchor stack)' },
	// ADR-0027b: re-homed from chip 2026-10-17 — developer-message entry.
	{ type: 'developer/message', home: 'mapped' },
	{ type: 'feedback/message-delete', home: 'chip', target: 'ADR-0027d (fold)' },
	{ type: 'feedback/message-put', home: 'chip', target: 'ADR-0027d (fold)' },
	{ type: 'image/offload', home: 'chip', target: 'ADR-0027d (fold into image refs)' },
	{ type: 'model/selection', home: 'chip', target: 'ADR-0027e (StatsBar segment)' },
	{ type: 'session-log-deepseek/delivery-accepted', home: 'chip', target: 'ADR-0027c (silent-plumbing)' },
	{ type: 'subagent/model-selection-policy', home: 'chip', target: 'ADR-0027c (silent-plumbing)' },
	{ type: 'working-directory/change', home: 'chip', target: 'stays a chip (ADR-0027 D6, escape family)' }
];

/** The one expected total -- the test pins it (62 upstream + the cover line). */
export const HOST_EVENT_COUNT = 63;