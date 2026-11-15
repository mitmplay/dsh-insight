// ADR-0064 D5 / task 3.1-T: the container-base CI workflow validated in-repo,
// so the gate logic is runnable without GitHub runners. GitHub Actions runs
// the same steps; this script pins the contract the workflow must keep.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

export function validateContainerBaseCi() {
	const raw = readFileSync(join(ROOT, '.github/workflows/container-base.yml'), 'utf8');
	const wf = /** @type {any} */ (parseYaml(raw));
	const problems = [];

	// name + trigger surface
	if (wf.name !== 'container-base') problems.push('workflow name must be container-base');
	// YAML 1.1 quirk: bare "on" parses as boolean true
	const wfAny = /** @type {any} */ (wf);
	const onKey = /** @type {any} */ (true);
	const on = wfAny[onKey] ?? wfAny.on;
	if (!on?.push?.paths && !on?.pull_request?.paths) {
		problems.push('workflow must path-filter push AND pull_request');
	}
	const pathFilters = [...(on.push?.paths ?? []), ...(on.pull_request?.paths ?? [])];
	if (!pathFilters.some((p) => String(p).includes('packages/container-base/**'))) {
		problems.push('path filter must cover packages/container-base/**');
	}

	// every step command is a known script or a standard tool invocation
	const pkgScripts = JSON.parse(
		readFileSync(join(ROOT, 'packages/container-base/package.json'), 'utf8')
	).scripts;
	const rootScripts = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).scripts;
	const standardTools = /^pnpm\s+(install|--filter\s+\S+\s+(exec|run|test))|^npm\s+pack|^uses:/;
	const steps = [];
	for (const step of wf.jobs?.gate?.steps ?? []) {
		if (step.run) steps.push(step);
	}
	if (steps.length === 0) problems.push('gate job must have run steps');

	for (const step of steps) {
		const cmd = String(step.run).trim();
		if (standardTools.test(cmd)) continue;
		// pnpm --filter <name> run <script> — script must exist in the package
		const m = cmd.match(/^pnpm --filter (@\S+) run (\S+)/);
		if (m) {
			const target = m[1] === '@deepseek-insight/container-base' ? pkgScripts : rootScripts;
			if (!target?.[m[2]]) problems.push(`unknown script in step '${step.name}': ${cmd}`);
			continue;
		}
		if (cmd.startsWith('pnpm install')) continue;
		problems.push(`step '${step.name}' is not a standard tool invocation: ${cmd}`);
	}

	// the D5 gate must include all five witnesses
	const allCmds = steps.map((s) => String(s.run)).join('\n');
	/** @type {[string, RegExp][]} */
	const musts = [
		['vitest suites', /container-base test/],
		['svelte-check', /svelte-check/],
		['build:package', /run build:package/],
		['publint', /run lint:package/],
		['pack dry-run', /npm pack --dry-run/]
	];
	for (const [label, re] of musts) {
		if (!re.test(allCmds)) problems.push(`gate must include ${label}`);
	}

	return { problems, stepCount: steps.length };
}
