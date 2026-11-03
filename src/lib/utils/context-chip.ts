/**
 * Context-chip naming and affordances, shared by every surface that draws
 * a ContextInjection chip (the stage's prompt/context bubbles AND the
 * inline chip rows inside an assistant turn — The Turn Kept Whole, D2).
 *
 * All readers work off the entry's verbatim wire source (BC-11): the name
 * is the producer's own string (skill name · recall label · plugin string ·
 * kind string), never inferred from text.
 */
import type { DsiEntry } from '$lib/types';
import { addPanelFromSidebar } from '$lib/services/panels/panel-registry';

type Producer = NonNullable<Extract<DsiEntry, { kind: 'user-message' }>['meta']>;
type Source = Record<string, unknown> | undefined;

/** The wire-carried chip name for name-bearing producers, read from the
 *  entry's verbatim source (BC-11): the invoked skill's name, the first
 *  recall reference's label, the injecting plugin's own string, or an
 *  unknown kind string; undefined when none is readable (the chip falls
 *  back to its bare category). */
export function chipNameOf(meta: Producer, metaSource: Source): string | undefined {
	const str = (v: unknown): string | undefined => (typeof v === 'string' && v !== '' ? v : undefined);
	switch (meta) {
		case 'skill-invocation':
			return str(metaSource?.name);
		case 'recall': {
			const refs = metaSource?.references;
			if (!Array.isArray(refs)) return undefined;
			return str((refs[0] as { label?: unknown } | undefined)?.label);
		}
		case 'plugin':
			return str(metaSource?.plugin);
		// The 2026-11-02 promotions (The Chip Label Promotion ADR D3): the
		// visible label is the catalog translation; the wire plugin string
		// rides the chip tooltip instead of vanishing.
		case 'goal':
		case 'tool-goal':
		case 'time-context':
		// The v4 wire rides source.kind (2026-11-02 census); the older shape
		// rode source.plugin — either way the raw string reaches the tooltip.
			return str(metaSource?.plugin) ?? str(metaSource?.kind);
		case 'injected':
			return str(metaSource?.kind);
		case 'user-approval':
		// The v4 wire shape is kind 'user-approval' (2026-09-18 promotion
		// matched the older plugin shape); the bare producer needs no name —
		// kept nameable for the tooltip the same way.
			return str(metaSource?.plugin) ?? str(metaSource?.kind);
		default:
			return undefined;
	}
}

/** One named contribution to a runtime-context snapshot, as the durable
 * source records it. Shape-parity with DSH's own chat
 * (ui-chat ContextBody snapshotSections). */
export interface SnapshotSection {
	name: string;
	text: string;
}

/**
 * The runtime-context snapshot's named contributions, read off the entry's
 * verbatim wire source (ADR "The Section Split", D1). All-or-nothing, the
 * same contract DSH's chat applies: every section must carry a non-empty
 * string name and a string text, and the list must be non-empty — one
 * malformed element discards the whole list. Undefined when the source is
 * absent or unreadable, which callers render as the plain body.
 * @param metaSource - the entry's verbatim source object, if any.
 * @returns the sections in wire order, or undefined when unusable.
 */
export function snapshotSectionsOf(metaSource: Source): SnapshotSection[] | undefined {
	const sections = metaSource?.sections;
	if (!Array.isArray(sections) || sections.length === 0) return undefined;
	const parsed: SnapshotSection[] = [];
	for (const item of sections) {
		if (typeof item !== 'object' || item === null) return undefined;
		const { name, text } = item as { name?: unknown; text?: unknown };
		if (typeof name !== 'string' || name === '' || typeof text !== 'string') return undefined;
		parsed.push({ name, text });
	}
	return parsed;
}

/**
 * The sender session of a subagent report/settled chip, read from the
 * entry's verbatim source (`subagent-report`/`subagent-settled` carry
 * `senderSessionId`): the open affordance targets that child panel.
 * Structural only — every other chip yields undefined (no affordance).
 */
function subagentSenderOf(meta: Producer, metaSource: Source): string | undefined {
	if (meta !== 'injected') return undefined;
	const kind = metaSource?.kind;
	if (kind !== 'subagent-report' && kind !== 'subagent-settled') return undefined;
	const sender = metaSource?.senderSessionId;
	return typeof sender === 'string' && sender !== '' ? sender : undefined;
}

/** The chip's `onopen` callback — present only on subagent report/settled
 *  chips whose source names a sender session. Opens the sender's panel
 *  through the floor registry (graceful no-op when no floor is mounted);
 *  the sender row is never focused. */
export function subagentOpenOf(meta: Producer, metaSource: Source): (() => void) | undefined {
	const sender = subagentSenderOf(meta, metaSource);
	return sender === undefined ? undefined : () => addPanelFromSidebar({ sessionId: sender, agentPreset: null });
}
