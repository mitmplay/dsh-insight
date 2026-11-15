import { describe, expect, it } from 'vitest';
import { validateContainerBaseCi } from '../../scripts/validate-container-base-ci.mjs';

// Task 3.1-T (ADR-0064 D5): the repo's first CI workflow is validated
// in-repo — YAML parses, path filter covers the package, every command
// exists as a package script or a standard tool invocation.
describe('container-base CI workflow (W3 3.1-T)', () => {
	it('parses, path-filters the package, and every step is a known command', () => {
		const { problems, stepCount } = validateContainerBaseCi();
		expect(problems, problems.join('\n')).toEqual([]);
		expect(stepCount).toBeGreaterThanOrEqual(5);
	});
});
