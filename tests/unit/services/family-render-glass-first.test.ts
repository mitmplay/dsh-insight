import { describe, expect, it } from 'vitest';
import { familyRenderOrder } from '$lib/services/lineage/lineage';

/**
 * ADR-0037 as-built — the folded glass flushes FIRST under its opener,
 * AHEAD of its ghost siblings (operator bug 2026-10-22: the glass landed
 * last because the ghost cluster kept insertion order, ignoring the
 * member's own wire order).
 */
describe('familyRenderOrder — the glass ghost flushes first (ADR-0037 D4)', () => {
	const mk = (id: string, parent: string | null, order: number | undefined) => ({
		id,
		parent,
		order,
		depth: parent === null ? 0 : 1,
		row: { panel: { id, kind: 'conversation' as const, sessionId: id, agentPreset: null, width: 0 } }
	});

	it('a glass ghost (order -1) renders BEFORE other ghost siblings under the same opener', () => {
		const panels = [mk('opener', null, undefined)];
		const ghosts = [
			{ ...mk('ghost-a', 'opener', 0), row: { ...mk('ghost-a', 'opener', 0).row, kind: 'ghost' as const } },
			{ ...mk('glass-x', 'opener', -1), row: { ...mk('glass-x', 'opener', -1).row, kind: 'ghost' as const } },
			{ ...mk('ghost-b', 'opener', 2), row: { ...mk('ghost-b', 'opener', 2).row, kind: 'ghost' as const } }
		];
		const out = familyRenderOrder(panels, ghosts);
		const ids = out.map((e) => e.member.id);
		expect(ids.indexOf('glass-x')).toBeLessThan(ids.indexOf('ghost-a'));
		expect(ids.indexOf('glass-x')).toBeLessThan(ids.indexOf('ghost-b'));
		// and still directly under its opener
		expect(ids[0]).toBe('opener');
		expect(ids[1]).toBe('glass-x');
	});

	it('ghosts without an order still sort last (the legacy fallback stands)', () => {
		const panels = [mk('opener', null, undefined)];
		const ghosts = [
			{ ...mk('glass-x', 'opener', -1), row: { ...mk('glass-x', 'opener', -1).row, kind: 'ghost' as const } },
			{ ...mk('ghost-noorder', 'opener', undefined), row: { ...mk('ghost-noorder', 'opener', undefined).row, kind: 'ghost' as const } }
		];
		const out = familyRenderOrder(panels, ghosts);
		const ids = out.map((e) => e.member.id);
		expect(ids.indexOf('glass-x')).toBeLessThan(ids.indexOf('ghost-noorder'));
	});

	it('an ORPHAN glass ghost renders even when its opener holds no panel (2026-10-22 bug)', () => {
		// The report: close the last panel and the folded glass vanished —
		// the roster's rows gate saw no panels AND familyRenderOrder never
		// reached a ghost whose parent is not a panel member. The ghost
		// grammar owns the bring-back (ADR-0037 D4), so the orphan cluster
		// heads its own block.
		const panels: ReturnType<typeof mk>[] = [];
		const ghosts = [
			{ ...mk('glass-x', 'opener', -1), row: { ...mk('glass-x', 'opener', -1).row, kind: 'ghost' as const } },
			{ ...mk('ghost-a', 'opener', 0), row: { ...mk('ghost-a', 'opener', 0).row, kind: 'ghost' as const } }
		];
		const out = familyRenderOrder(panels, ghosts);
		const ids = out.map((e) => e.member.id);
		expect(ids).toContain('glass-x');
		expect(ids).toContain('ghost-a');
		// The opener's wire order holds inside the orphan cluster too.
		expect(ids.indexOf('glass-x')).toBeLessThan(ids.indexOf('ghost-a'));
	});
});
