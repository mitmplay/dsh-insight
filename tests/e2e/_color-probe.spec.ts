// throwaway — decisive color probe
import { test, expect } from '@playwright/test';
test('probe trash color', async ({ page }) => {
	await page.goto('http://127.0.0.1:5175', { waitUntil: 'domcontentloaded', timeout: 30000 });
	const row = page.locator('[data-testid=sidebar-session-card]').first();
	await row.click({ timeout: 15000 });
	const trigger = page.locator('[data-testid=subagent-anchor-trigger]').first();
	await expect(trigger).toBeVisible({ timeout: 25000 });
	await trigger.click();
	const trash = page.locator('[data-testid=subagent-popup-close-all]');
	await expect(trash).toBeVisible({ timeout: 10000 });
	const info = await trash.evaluate((el) => ({
		cls: el.className,
		btnColor: getComputedStyle(el).color,
		svgColor: el.querySelector('svg') ? getComputedStyle(el.querySelector('svg')!).color : 'none',
		rectFill: el.querySelector('svg rect, svg path')
			? getComputedStyle(el.querySelector('svg rect, svg path')!).color
			: 'none',
		rectAttr:
			el.querySelector('svg rect, svg path')?.getAttribute('fill') ??
			el.querySelector('svg rect, svg path')?.getAttribute('stroke') ??
			'none'
	}));
	console.log('COLORPROBE', JSON.stringify(info));
});
