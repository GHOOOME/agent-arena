import { chromium } from '@playwright/test';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });

await page.goto('http://localhost:3000', { waitUntil: 'networkidle' });
await page.getByText('Work / Window / Race').waitFor({ timeout: 10_000 });
await page.locator('.arena-work-window').first().waitFor({ timeout: 10_000 });

await page.getByRole('button', { name: /添加窗口/ }).first().click();
await page.locator('.arena-select-trigger').first().click();
await page.locator('.arena-select-menu').waitFor({ timeout: 5_000 });
await page.keyboard.press('Escape');

await page.getByRole('button', { name: /窗口设置/ }).first().click();
await page.getByRole('button', { name: /合并预览/ }).first().click();
await page.locator('.arena-merge-panel').waitFor({ timeout: 10_000 });
const mergeState = page.locator('.arena-merge-summary, .arena-merge-empty').first();
await mergeState.waitFor({ timeout: 10_000 });
const mergeSummary = await mergeState.textContent().catch(() => '');
const mergePanelVisible = await page.locator('.arena-merge-panel').first().isVisible().catch(() => false);

await page.getByRole('button', { name: /归档选中/ }).click();
await page.getByRole('alertdialog').waitFor({ timeout: 5_000 });
const confirmTitle = await page.locator('#arena-confirm-title').textContent();
await page.getByRole('button', { name: '取消' }).click();

const result = {
  cards: await page.locator('.arena-work-window').count(),
  selects: await page.locator('.arena-select-trigger').count(),
  runtimeSelectVisible: await page.getByRole('button', { name: /新窗口执行引擎/ }).isVisible().catch(() => false),
  winnerVisible: await page.getByText('Winner').first().isVisible().catch(() => false),
  confirmTitle,
  mergePanelVisible,
  mergeSummary,
  approvalInboxCount: await page.locator('.arena-approval-inbox').count(),
};

await page.screenshot({ path: '/tmp/llm-arena-workbench-smoke.png', fullPage: true });

await page.setViewportSize({ width: 390, height: 900 });
await page.goto('http://localhost:3000', { waitUntil: 'networkidle' });
await page.getByText('Work / Window / Race').waitFor({ timeout: 10_000 });
await page.locator('.arena-work-window').first().waitFor({ timeout: 10_000 });
const mobileOverflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
await page.screenshot({ path: '/tmp/llm-arena-workbench-mobile-smoke.png', fullPage: true });

result.mobileOverflow = mobileOverflow;

await browser.close();

console.log(JSON.stringify(result, null, 2));
