/**
 * dsh-events/context-injection — the fixture-pinned context-injection family
 * detector moved whole from dsh-events.ts (ADR-0022 W2): producer
 * classification for harness-injected user/messages. Pure function; the
 * detection doc comment rides verbatim below.
 */

import { textOfContent } from './content';

/**
 * Context-injection family detection (task 2.4; BC-11: fixture-pinned wire
 * markers — tests/unit/fixtures/context-injection-sources.json, live rc.8
 * ledger 2026-08-21). Harness-injected context user/messages carry a
 * structural `source` marker; each producer has its own shape:
 *
 *   runtime-context  source = { kind:'plugin',
 *                                 plugin:'@deepseek-ai/dsh-system-prompt',
 *                                 form:'snapshot', sections:[…] }
 *                    + text opens "Current runtime context."
 *   instructions     source = { kind:'agent-instructions', form:'instructions',
 *                              baseline, changes:[{action,set,scope,path,digest}] }
 *                    (AGENTS.md workspace instructions)
 *   skill-catalog    source = { kind:'skill-catalog', form:'catalog',
 *                              entries:[{name,description}] }
 *   skill-invocation source = { kind:'skill-invocation', name,
 *                              form:'instructions' }
 *                    (the rendered <skill_content> body injected after a
 *                     user-explicit skill load — SkillInvocationSource,
 *                     dsh-skill; `name` is the invoked skill, surfaced as
 *                     the chip label)
 *   compaction       source = { kind:'plugin', plugin:'compact',
 *                              compactionId, sourceCommandId? }
 *                    (the /compact checkpoint replacement user/message —
 *                     preamble + <compacted-summary> body —
 *                     CompactionCheckpointSource, dsh-compaction/checkpoint;
 *                     the full summary rides the message text, so the
 *                     compaction/* lifecycle events stay silent)
 *
 * The family is OPEN (2026-08-31 audit): MessageSourceMap is
 * merge-extensible and kind:'plugin' carries ANY plugin name. After the
 * five tailored producers, detection falls through exactly the way DSH's
 * own client does (ui-chat contextProvenance / message.ts):
 *
 *   plugin           source = { kind:'plugin', plugin:<name>, form? }
 *                    (every other injecting plugin — tool-jobs notices,
 *                     user-approval policy changes, hooks relays,
 *                     time-context / tmux-context snapshots, …; the chip
 *                     is NAMED after the wire plugin string)
 *   recall           source = { kind:'session-reference', form:'recall',
 *                              references:[{label,…}] }
 *                    (cross-session context prepared by the host;
 *                     named after the first reference label)
 *   injected         any other non-'user' source kind
 *                    (webhook notices, team messages, future kinds — the
 *                     chip is NAMED after the wire kind string; an unknown
 *                     producer stays visible, never a silent bubble)
 *
 * The 1.4-pinned fixture is the contract; the tailored producers require
 * the STRUCTURAL marker (source.kind + producer-specific form/keys) —
 * plain text that merely quotes the words never matches. Since the
 * 2026-08-31 audit, everything else NON-'user' still surfaces as a
 * fall-through chip (plugin name / recall label / kind string) instead of
 * posing as the operator's own bubble; only kind:'user' and source-less
 * messages stay ordinary bubbles.
 */
const RUNTIME_CONTEXT_PLUGIN = '@deepseek-ai/dsh-system-prompt';
const RUNTIME_CONTEXT_FORM = 'snapshot';
const RUNTIME_CONTEXT_TEXT_PREFIX = 'Current runtime context.';

/** Producer id = the chip's attribution + the entry's meta value. The
 * first five are tailored producers; the last three are the open-family
 * fall-through (merge-extensible wire, DSH-client parity). */
export type ContextInjectionProducer =
	| 'runtime-context'
	| 'instructions'
	| 'skill-catalog'
	| 'skill-invocation'
	| 'user-approval'
	| 'goal'
	| 'tool-goal'
	| 'time-context'
	| 'compaction'
	| 'plugin'
	| 'recall'
	| 'injected';

export function contextInjectionProducer(data: Record<string, unknown> | undefined): ContextInjectionProducer | undefined {
	const source = data?.source as { kind?: unknown; plugin?: unknown; form?: unknown } | undefined;
	if (!source || typeof source.kind !== 'string') return undefined;
	// The plugin family is open: every kind:'plugin' source is injected
	// context. Tailored members are recognized first; the rest fall through
	// to the generic chip, the way DSH's own client labels by plugin name.
	if (source.kind === 'plugin') {
		// Runtime-context: the pinned plugin + snapshot form; text prefix
		// corroborates (structural marker + text signal together, BC-11). A
		// snapshot without the prefix still falls through to 'plugin' below.
		if (
			source.plugin === RUNTIME_CONTEXT_PLUGIN &&
			source.form === RUNTIME_CONTEXT_FORM &&
			textOfContent(data?.content).startsWith(RUNTIME_CONTEXT_TEXT_PREFIX)
		) {
			return 'runtime-context';
		}
		// Compaction checkpoint: the pinned compact marker, exactly
		// dsh-compaction's isCompactCheckpointSource (kind + plugin only — no
		// form member). The /compact replacement user/message whose text
		// carries the <compacted-summary> body.
		if (source.plugin === 'compact') return 'compaction';
		// User-approval policy notices (2026-09-18): promoted from the open
		// family to a tailored producer — the chip label is catalog-sourced
		// (ctxChipUserApproval) instead of the raw wire string. Exact-string
		// match only: scoped siblings (@deepseek-ai/dsh-user-approval) stay
		// in the open family below.
		if (source.plugin === 'user-approval') return 'user-approval';
		// 2026-11-02 promotion (The Chip Label Promotion ADR D1/D2): the three
		// recurring floor plugins get catalog labels instead of raw wire
		// strings — exact-string only, scoped siblings stay in the open
		// family, and the wire name rides the chip tooltip (D3).
		if (source.plugin === 'goal') return 'goal';
		if (source.plugin === 'tool-goal') return 'tool-goal';
		if (source.plugin === 'time-context') return 'time-context';
		// 2026-11-02 promotion (The Chip Label Promotion ADR D1/D2): the three
		// recurring floor plugins get catalog labels instead of raw wire
		// strings — exact-string only, scoped siblings stay in the open
		// family, and the wire name rides the chip tooltip (D3).
		if (source.plugin === 'goal') return 'goal';
		if (source.plugin === 'tool-goal') return 'tool-goal';
		if (source.plugin === 'time-context') return 'time-context';
		// Open family: tool-jobs notices, user-approval policy changes,
		// hooks relays, time-context snapshots, … — the chip is named after
		// the wire plugin string at render time.
		return 'plugin';
	}
	// 2026-11-02 live-wire amendment (The Chip Label Promotion ADR, amendments):
	// DSH v4 ledgers carry the promoted vocabulary on source.KIND — wire census
	// 2026-11-02: kind 'time-context' form 'snapshot' ×1731, kind 'user-approval'
	// ×612, kind 'goal' {goalId,revision,round}, kind 'tool-goal' form 'notice'
	// {summary}. The plugin-string members above stay for the older wire shape;
	// these kind arms are the live contract. Exact-string only (D2).
	if (source.kind === 'goal') return 'goal';
	if (source.kind === 'tool-goal') return 'tool-goal';
	if (source.kind === 'time-context') return 'time-context';
	if (source.kind === 'user-approval') return 'user-approval';
	// Instructions: agent-instructions kind + instructions form (AGENTS.md).
	if (source.kind === 'agent-instructions' && source.form === 'instructions') return 'instructions';
	// Skill-catalog: skill-catalog kind + catalog form (entries name+describe skills).
	if (source.kind === 'skill-catalog' && source.form === 'catalog') return 'skill-catalog';
	// Skill-invocation: skill-invocation kind + instructions form — the
	// <skill_content> body injected after a user-explicit skill load
	// (SkillInvocationSource, dsh-skill). Structural only: the skill name the
	// chip displays is read from the entry's metaSource at render time.
	if (source.kind === 'skill-invocation' && source.form === 'instructions') return 'skill-invocation';
	// Cross-session recall (session-reference, form 'recall'): the chip
	// names itself after the first reference label when one is readable.
	if (source.kind === 'session-reference') return 'recall';
	// Merge-extensible fall-through: any other non-'user' kind (webhook,
	// team-message, future kinds) stays visible, named after its kind —
	// the same documented default DSH's own client falls through on.
	if (source.kind !== 'user') return 'injected';
	// kind:'user' is the operator's own prompt and stays a bubble.
	return undefined;
}
