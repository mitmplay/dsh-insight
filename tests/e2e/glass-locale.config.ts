// Minimal config for a GLASS run of locale.spec.ts against the LIVE dev
// server (no build, no preview, no stub): the glass fixture resolves
// goto('/') against DSI_E2E_GLASS_BASE_URL (set to :5175 in the env).
// Run: DSI_E2E_GLASS_CDP_URL=http://127.0.0.1:<port> DSI_E2E_GLASS_BASE_URL=http://127.0.0.1:5175 \
//      npx playwright test --config tests/e2e/glass-locale.config.ts
export default {
	testDir: '.',
	testMatch: /.*\.spec\.ts/, // glass-lane specs (locale, strip regression, …)
	timeout: 60_000,
	expect: { timeout: 10_000 },
	workers: 1,
	reporter: [['list']],
	use: { trace: 'retain-on-failure' }
};
