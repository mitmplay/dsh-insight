import { describe, expect, it } from 'vitest';
import { focusedSlot, insertAtAnchor, slotAfter } from '../../src/index';

describe('slotAfter — the below-the-anchor slot rule', () => {
	it('anchor + 1 when the anchor exists', () => {
		expect(slotAfter(0, 9)).toBe(1);
		expect(slotAfter(2, 9)).toBe(3);
	});
	it('the caller fallback when no pane carries the anchor (< 0)', () => {
		expect(slotAfter(-1, 4)).toBe(4);
	});
});

describe('insertAtAnchor — ordering and boundary anchors', () => {
	it('inserts BEFORE the anchor index (stable order elsewhere)', () => {
		expect(insertAtAnchor(['a', 'b', 'c'], 1, 'x')).toEqual(['a', 'x', 'b', 'c']);
		expect(insertAtAnchor(['a', 'b'], 0, 'x')).toEqual(['x', 'a', 'b']);
		expect(insertAtAnchor(['a', 'b'], 2, 'x')).toEqual(['a', 'b', 'x']);
	});
	it('empty list: any anchor appends the item', () => {
		expect(insertAtAnchor([], 0, 'x')).toEqual(['x']);
		expect(insertAtAnchor([], 7, 'x')).toEqual(['x']);
		expect(insertAtAnchor([], -3, 'x')).toEqual(['x']);
	});
	it('negative anchor clamps to the front; past-the-end clamps to append', () => {
		expect(insertAtAnchor(['a', 'b'], -5, 'x')).toEqual(['x', 'a', 'b']);
		expect(insertAtAnchor(['a', 'b'], 99, 'x')).toEqual(['a', 'b', 'x']);
	});
	it('input list is never mutated', () => {
		const original = ['a', 'b'];
		insertAtAnchor(original, 1, 'x');
		expect(original).toEqual(['a', 'b']);
	});
});

describe('focusedSlot — the insert-before-focused rule', () => {
	it('the focus index when focused', () => {
		expect(focusedSlot(2, 5)).toBe(2);
		expect(focusedSlot(0, 5)).toBe(0);
	});
	it('0 when nothing is focused (negative or past the end)', () => {
		expect(focusedSlot(-1, 5)).toBe(0);
		expect(focusedSlot(5, 5)).toBe(0);
		expect(focusedSlot(0, 0)).toBe(0);
	});
});
