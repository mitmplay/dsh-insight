import { chromium } from '@playwright/test';
const browser = await chromium.launch({
	headless: false,
	args: ['--auto-open-devtools-for-tabs', '--window-size=1500,950', '--window-position=80,60']
});
const ctx = await browser.newContext({ noViewport: true });
const p1 = await ctx.newPage();
await p1.goto('http://localhost:5175/?profile=wh');
const p2 = await ctx.newPage();
await p2.goto('http://localhost:5176/?profile=wh');
console.log('READY — two tabs open, DevTools auto-attached to each');
// hold open until the operator closes it
await new Promise(() => {});
