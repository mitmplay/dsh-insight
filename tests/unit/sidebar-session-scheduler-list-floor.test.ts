/**
 * SidebarSessionSchedulerList — floor arms (coverage headroom, 2026-11-23).
 * Direct mounts — until now the list's coverage rode on
 * tests/unit/scheduler-shelf.test.ts through the host. A frozen clock
 * (vi.setSystemTime) makes the countdown and the relative age exact.
 *
 * Arms pinned, by source line:
 *  - L28-L35 deliveryDate / L42-L47 deliveryRelative: the receipt guards.
 *    `deliveredAt` is `string | null` on the wire (types.ts L1032) and the
 *    shelf suite only ever delivered parseable stamps, so the null
 *    (L29/L43), empty-string (L29/L43 `=== ''`) and unparseable (L31/L45)
 *    arms never ran.
 *  - L109 `rel ?? '—'`: an unreadable receipt still renders the honest
 *    em-dash age — and KEEPS the CheckCheck receipt icon, with
 *    `delivered —` as the exact-date title.
 *  - L155: `kind: undefined` (absent on the wire) is the `!== undefined`
 *    arm — no glyph, em-dash word; an unknown kind takes the
 *    `KIND_ICONS[kind] ?? null` arm — no glyph, but the wire word stays.
 *  - L127: null AND '' targets render the INERT div (no href, no
 *    onrowclick); a target-bearing row is the anchor with the seed deep
 *    link and forwards onrowclick(event, task) with the row's own task.
 *
 * NOT forced (reported to the lead): L164 `meta?.text ?? '—'` — rowMeta is
 * a Map built from the SAME tasks array the {#each} walks, so meta is
 * always found and text is a string in all three arms: the optional chain
 * and the fallback can never observe undefined.
 */
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SidebarSessionSchedulerList from '../../src/lib/components/sidebar/session-scheduler/SidebarSessionSchedulerList.svelte';
import type { DsiScheduledTask } from '$lib/types';

const NOW = Date.parse('2026-11-23T12:00:00Z');
const HOUR = 3_600_000;

const mk = (over: Partial<DsiScheduledTask> & { id: string }): DsiScheduledTask =>
	({
		title: 'Task ' + over.id,
		status: 'active',
	kind: 'at',
		scheduledAt: null,
		targetKind: 'session',
		targetSessionId: null,
		lastDelivery: null,
		...over
	} as DsiScheduledTask);

type RowClick = (event: MouseEvent, task: DsiScheduledTask) => void;

function mountList(tasks: DsiScheduledTask[], loaded = true) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const onrowclick = vi.fn<RowClick>();
	const instance = mount(SidebarSessionSchedulerList, { target, props: { tasks, loaded, onrowclick } });
	flushSync();
	return { target, instance, onrowclick };
}

const rows = (target: HTMLElement): HTMLElement[] =>
	[...target.querySelectorAll('[data-testid="scheduler-shelf-row"]')] as HTMLElement[];

/** The row's honest cells (same reads as the shelf suite's byRow). */
function cells(row: HTMLElement) {
	return {
		dot: row.querySelector('.dot') as HTMLElement,
		title: row.querySelector('.title')?.textContent ?? null,
		kind: row.querySelector('.kind')?.textContent?.trim() ?? null,
		kindIcon: row.querySelector('.kind svg'),
		meta: row.querySelector('.meta')?.textContent?.trim() ?? null,
		metaIcon: row.querySelector('.meta svg'),
		metaTitle: row.querySelector('.meta')?.getAttribute('title') ?? null
	};
}

const receipt = (deliveredAt: string | null) => ({ deliveredAt, targetSessionId: 's-born' });

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(NOW);
});

afterEach(() => {
	vi.useRealTimers();
	document.body.innerHTML = '';
});

describe('SidebarSessionSchedulerList — row modes (L127) and the live countdown', () => {
	it('a target-bearing active row is the ANCHOR: seed href, exact countdown, onrowclick(event, task)', () => {
		const armed = mk({
			id: 'armed',
			title: 'Nightly report',
			kind: 'rrule',
			scheduledAt: new Date(NOW + 125 * 60_000).toISOString(),
			targetSessionId: 's-1'
		});
		const { target, instance, onrowclick } = mountList([armed]);
		const [row] = rows(target);
		expect(row.tagName).toBe('A');
		expect(row.getAttribute('href')).toBe('/?sessionKey=s-1');
		const c = cells(row);
		expect(c.dot.classList.contains('armed')).toBe(true);
		expect(c.title).toBe('Nightly report');
		expect(c.kind).toBe('rrule');
		expect(c.kindIcon).not.toBeNull();
		expect(c.meta).toBe('in 2h 5m');
		expect(c.metaTitle).toBeNull(); // a pending row carries no exact-date title
		row.click();
		expect(onrowclick).toHaveBeenCalledTimes(1);
		const [event, task] = onrowclick.mock.calls[0];
		expect(event.type).toBe('click');
		expect(task).toBe(armed); // the row's OWN task object, never a copy
		unmount(instance);
	});

	it('null AND empty targets render the INERT div — no href, and a click never reaches onrowclick', () => {
		const { target, instance, onrowclick } = mountList([
			mk({ id: 'null-target', targetSessionId: null }),
			mk({ id: 'empty-target', targetSessionId: '' })
		]);
		expect(rows(target)).toHaveLength(2);
		for (const row of rows(target)) {
			expect(row.tagName).toBe('DIV');
			expect(row.hasAttribute('href')).toBe(false);
			row.click();
		}
		expect(onrowclick).not.toHaveBeenCalled();
		unmount(instance);
	});
});

describe('SidebarSessionSchedulerList — unreadable receipts (L28-L47, L109)', () => {
	it.each([
		['null', null],
		['empty', ''],
		['unparseable', 'not-a-date']
	])('a %s deliveredAt renders the em-dash age, keeps the receipt icon, titles "delivered —"', (_label, deliveredAt) => {
		const { target, instance } = mountList([mk({ id: 'done', status: 'ended', lastDelivery: receipt(deliveredAt) })]);
		const c = cells(rows(target)[0]);
		expect(c.dot.classList.contains('ended')).toBe(true);
		expect(c.meta).toBe('—');
		expect(c.metaIcon).not.toBeNull(); // delivered: true — the receipt is real, only its clock is unreadable
		expect(c.metaTitle).toBe('delivered —');
		unmount(instance);
	});

	it('a readable receipt renders the relative age + icon, with the local calendar day in the title', () => {
		const deliveredAt = new Date(NOW - 2 * HOUR).toISOString();
		const { target, instance } = mountList([mk({ id: 'done', status: 'ended', lastDelivery: receipt(deliveredAt) })]);
		const c = cells(rows(target)[0]);
		expect(c.meta).toBe('2h ago');
		expect(c.metaIcon).not.toBeNull();
		// deliveryDate reads the LOCAL calendar parts (by design: "deterministic
		// across locales") — mirror them so the pin holds in any test time zone.
		const d = new Date(deliveredAt);
		const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
		expect(c.metaTitle).toBe(`delivered ${day}`);
		unmount(instance);
	});

	it('an ended row WITHOUT a receipt, and a paused row, stay the plain em-dash — no icon, no title, no countdown', () => {
		const { target, instance } = mountList([
			mk({ id: 'bare-end', status: 'ended', lastDelivery: null }),
			mk({ id: 'paused', status: 'paused', scheduledAt: new Date(NOW + 3 * HOUR).toISOString() })
		]);
		const [ended, paused] = rows(target).map(cells);
		expect(ended.dot.classList.contains('ended')).toBe(true);
		expect(ended.meta).toBe('—');
		expect(ended.metaIcon).toBeNull();
		expect(ended.metaTitle).toBeNull();
		// a paused row never counts down — even with a future scheduledAt
		expect(paused.dot.classList.contains('paused')).toBe(true);
		expect(paused.meta).toBe('—');
		unmount(instance);
	});
});

describe('SidebarSessionSchedulerList — kind column arms (L155), title, host chrome', () => {
	it('absent (undefined) kind → no glyph + em-dash; unknown kind → no glyph, wire word kept; known → glyph', () => {
		const { target, instance } = mountList([
			mk({ id: 'absent', kind: undefined }),
			mk({ id: 'unknown', kind: 'bogus' }),
			mk({ id: 'known', kind: 'cron' })
		]);
		const [absent, unknown, known] = rows(target).map(cells);
		expect(absent.kind).toBe('—');
		expect(absent.kindIcon).toBeNull();
		expect(unknown.kind).toBe('bogus');
		expect(unknown.kindIcon).toBeNull();
		expect(known.kind).toBe('cron');
		expect(known.kindIcon).not.toBeNull();
		unmount(instance);
	});

	it('an empty title renders the em-dash, never an invented name', () => {
		const { target, instance } = mountList([mk({ id: 'bare', title: '' })]);
		expect(cells(rows(target)[0]).title).toBe('—');
		unmount(instance);
	});

	it('loaded=false renders NO rows; more than 10 rows turns on the scroll cap', () => {
		const idle = mountList([mk({ id: 'a' })], false);
		expect(rows(idle.target)).toHaveLength(0);
		unmount(idle.instance);
		const many = Array.from({ length: 11 }, (_, i) => mk({ id: 't' + i }));
		const capped = mountList(many);
		expect(rows(capped.target)).toHaveLength(11);
		expect((capped.target.querySelector('.rows') as HTMLElement).classList.contains('scrollable')).toBe(true);
		unmount(capped.instance);
		const few = mountList(many.slice(0, 10));
		expect((few.target.querySelector('.rows') as HTMLElement).classList.contains('scrollable')).toBe(false);
		unmount(few.instance);
	});
});
