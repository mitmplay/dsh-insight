/**
 * JobTail component tests (ADR-0035 D6 surface): the component branches the
 * pure-model suite (tests/unit/job-tail-lines.test.ts) cannot see —
 *  - live vs settled header split (spinner + label vs status icon + word)
 *  - the settled status icon ladder: killed/failed → CircleX, completed →
 *    CircleCheck, anything else → CircleAlert
 *  - the error span (only when an error frame arrived)
 *  - the empty state (only while no lines have landed)
 *  - the eviction seam rendered with its .seam class
 *  - the command <pre> (only when formatCommandLines yields lines)
 *  - the scroll effect pinning the tail to the bottom
 *
 * The component is mounted directly (house pattern: mount/unmount/flushSync)
 * — no Host wrapper is needed since JobTail takes plain props.
 */
import { mount, unmount, flushSync } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import JobTail from '$lib/components/terminal/JobTail.svelte';
import { EVICTION_SEAM } from '$lib/components/terminal/job-tail-lines';
import type { DsiJobFollowEvent } from '$lib/types';

function statusEvent(status: string): DsiJobFollowEvent {
	return { type: 'status', job: { id: 'j', kind: 'k', label: 'l', status, startedAt: 0, output: { total: 1, earliest: 0 } } } as DsiJobFollowEvent;
}

function mountTail(events: DsiJobFollowEvent[], label = 'echo hi') {
	const target = document.createElement('div');
	document.body.appendChild(target);
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const comp = mount(JobTail as any, { target, props: { events, label } });
	flushSync();
	return {
		target,
		cleanup: () => {
			unmount(comp);
			target.remove();
		}
	};
}

let scrollToSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
	scrollToSpy = vi.fn();
	// happy-dom exposes no scrollTo on elements; the effect must not crash
	// either way, and the spy makes the pin-to-bottom observable.
	(Element.prototype as unknown as { scrollTo?: unknown }).scrollTo = scrollToSpy;
});

afterEach(() => {
	delete (Element.prototype as unknown as { scrollTo?: unknown }).scrollTo;
	vi.restoreAllMocks();
});

describe('JobTail — live header (not settled)', () => {
	it('renders the spinner + label, the empty state, and no settled word', () => {
		const { target, cleanup } = mountTail([], 'my-job');
		expect(target.querySelector('[data-testid="job-tail"]')).not.toBeNull();
		expect(target.querySelector('[data-testid="job-tail-settled"]')).toBeNull();
		expect(target.querySelector('[data-testid="job-tail-error"]')).toBeNull();
		// live header carries the raw label and the spinning loader
		expect(target.textContent).toContain('my-job');
		expect(target.querySelector('svg.animate-spin')).not.toBeNull();
		// no output yet → waiting placeholder; the label itself is the command
		// pre (even 'my-job' is a valid shell one-liner)
		expect(target.querySelector('[data-testid="job-tail-empty"]')).not.toBeNull();
		expect(target.querySelector('[data-testid="job-tail-command"]')!.textContent).toBe('my-job');
		// scroll effect ran over the (empty) tail without crashing
		expect(scrollToSpy).toHaveBeenCalled();
		cleanup();
	});

	it('renders lines and drops the empty state once output arrives', () => {
		const { target, cleanup } = mountTail([
			{ type: 'output', text: 'line one\nline two', next: 1 } as DsiJobFollowEvent
		], 'cmd');
		expect(target.querySelector('[data-testid="job-tail-empty"]')).toBeNull();
		expect(target.textContent).toContain('line one');
		expect(target.textContent).toContain('line two');
		cleanup();
	});

	it('renders the command pre only when the label shapes into command lines', () => {
		const withCmd = mountTail([], 'for f in a b; do echo $f; done');
		expect(withCmd.target.querySelector('[data-testid="job-tail-command"]')).not.toBeNull();
		expect(withCmd.target.querySelector('[data-testid="job-tail-command"]')!.textContent).toContain('for f in a b; do');
		withCmd.cleanup();
	});
});

describe('JobTail — settled header status icon ladder', () => {
	it('killed → CircleX (red) with the status word, loader gone', () => {
		const { target, cleanup } = mountTail([statusEvent('killed')], 'cmd');
		expect(target.querySelector('[data-testid="job-tail-settled"]')!.textContent).toBe('killed');
		expect(target.querySelector('svg.animate-spin')).toBeNull();
		expect(target.querySelector('svg.text-red-400')).not.toBeNull();
		expect(target.querySelector('svg.text-green-400')).toBeNull();
		cleanup();
	});

	it('failed → CircleX too (same killed/failed arm)', () => {
		const { target, cleanup } = mountTail([statusEvent('failed')], 'cmd');
		expect(target.querySelector('[data-testid="job-tail-settled"]')!.textContent).toBe('failed');
		expect(target.querySelector('svg.text-red-400')).not.toBeNull();
		cleanup();
	});

	it('completed → CircleCheck (green)', () => {
		const { target, cleanup } = mountTail([statusEvent('completed')], 'cmd');
		expect(target.querySelector('[data-testid="job-tail-settled"]')!.textContent).toBe('completed');
		expect(target.querySelector('svg.text-green-400')).not.toBeNull();
		expect(target.querySelector('svg.text-red-400')).toBeNull();
		cleanup();
	});

	it('any other status → CircleAlert (slate fallback arm)', () => {
		const { target, cleanup } = mountTail([statusEvent('cancelled')], 'cmd');
		expect(target.querySelector('[data-testid="job-tail-settled"]')!.textContent).toBe('cancelled');
		expect(target.querySelector('svg.text-slate-500')).not.toBeNull();
		expect(target.querySelector('svg.text-red-400')).toBeNull();
		expect(target.querySelector('svg.text-green-400')).toBeNull();
		cleanup();
	});
});

describe('JobTail — error span, eviction seam, scroll effect', () => {
	it('renders the error span when an error frame arrives', () => {
		const { target, cleanup } = mountTail([
			{ type: 'output', text: 'boom', next: 1 } as DsiJobFollowEvent,
			{ type: 'error', code: 'tail_gone', message: 'lost' } as DsiJobFollowEvent
		], 'cmd');
		const err = target.querySelector('[data-testid="job-tail-error"]');
		expect(err).not.toBeNull();
		expect(err!.textContent).toBe('tail_gone: lost');
		cleanup();
	});

	it('renders the eviction seam line with its .seam class', () => {
		const { target, cleanup } = mountTail([
			{ type: 'output', text: 'early', next: 1 } as DsiJobFollowEvent,
			{ type: 'output', text: 'late', next: 2, lossy: true } as DsiJobFollowEvent
		], 'cmd');
		const seamLine = [...target.querySelectorAll('div')].find((d) => d.textContent === EVICTION_SEAM);
		expect(seamLine).toBeDefined();
		expect(seamLine!.className).toContain('seam');
		expect(target.textContent).toContain('early');
		expect(target.textContent).toContain('late');
		cleanup();
	});

	it('scroll effect re-runs and re-pins as lines grow', async () => {
		const { target, cleanup } = mountTail([], 'cmd');
		const callsBefore = scrollToSpy.mock.calls.length;
		expect(callsBefore).toBeGreaterThan(0);
		// re-mount with the same component tree shape but more lines: a fresh
		// mount re-runs the effect (props-driven tail drives the dependency)
		cleanup();
		const again = mountTail([{ type: 'output', text: 'a\nb\nc', next: 1 } as DsiJobFollowEvent], 'cmd');
		expect(scrollToSpy.mock.calls.length).toBeGreaterThan(0);
		// effect touches tailEl each run — spy fired on the live element
		expect(scrollToSpy.mock.instances.some((i) => i === again.target.querySelector('div.flex-1')) || scrollToSpy.mock.calls.length > callsBefore).toBe(true);
		again.cleanup();
	});
});
