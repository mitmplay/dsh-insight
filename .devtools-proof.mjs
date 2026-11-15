import { chromium } from '@playwright/test';
import { execSync, spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const browser = await chromium.launch({
	headless: false,
	args: ['--remote-debugging-port=9223', '--window-size=1500,950']
});
const ver = JSON.parse(execSync('curl -s http://127.0.0.1:9223/json/version').toString());
const browserWs = ver.webSocketDebuggerUrl;
const ws = new WebSocket(browserWs);
let msgId = 0;
const pending = new Map();
const events = [];
ws.onmessage = (ev) => {
	const msg = JSON.parse(ev.data);
	if (msg.id && pending.has(msg.id)) {
		const { resolve, reject } = pending.get(msg.id);
		pending.delete(msg.id);
		msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
	} else if (msg.method) events.push(msg);
};
const send = (method, params = {}, sessionId) =>
	new Promise((resolve, reject) => {
		const id = ++msgId;
		pending.set(id, { resolve, reject });
		ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
	});
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

async function devtoolsShot(pageUrl, panel, outPath) {
	const { targetId } = await send('Target.createTarget', { url: pageUrl });
	await wait(4000);
	const dt = await send('Target.createTarget', {
		url: `devtools://devtools/bundled/inspector.html?ws=127.0.0.1:9223/devtools/page/${targetId}&panel=${panel}`
	});
	await wait(7000);
	const { sessionId } = await send('Target.attachToTarget', { targetId: dt.targetId, flatten: true });
	await send('Page.enable', {}, sessionId);
	await wait(1500);
	const shot = await send('Page.captureScreenshot', { format: 'png' }, sessionId);
	writeFileSync(outPath, Buffer.from(shot.data, 'base64'));
	console.log('shot:', outPath);
	await send('Target.closeTarget', { targetId: dt.targetId });
	await send('Target.closeTarget', { targetId });
}

await devtoolsShot('http://localhost:5175/?profile=wh', 'storage',
	'/Users/wharsojo/agentic-ai/deepseek-insight/dev/kb/rca/proof-dsi-5175-profile-wh.png');
await devtoolsShot('http://localhost:5176/?profile=wh', 'storage',
	'/Users/wharsojo/agentic-ai/deepseek-insight/dev/kb/rca/proof-playground-5176-profile-wh.png');
ws.close();
console.log('BOTH SHOTS DONE');
