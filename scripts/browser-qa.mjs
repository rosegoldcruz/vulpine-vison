import { chromium } from 'playwright-core';
import path from 'node:path';

const root = process.cwd();
const output = path.join(root, 'docs/design');
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
const errors = [];
page.on('console', (message) => { if (message.type() === 'error') errors.push(`console: ${message.text()}`); });
page.on('pageerror', (error) => errors.push(`page: ${error.message}`));
page.on('response', (response) => { if (response.status() >= 400) errors.push(`http ${response.status()}: ${response.url()}`); });

await page.goto('http://127.0.0.1:3100', { waitUntil: 'networkidle' });
await page.getByLabel('Project name').fill(`Browser QA ${Date.now()}`);
await page.getByRole('button', { name: 'Create project' }).click();
await page.getByText('Project created. Add plans and an authoritative pricing workbook.').waitFor();
await page.locator('input[type=file]').first().setInputFiles([
  path.join(root, 'fixtures/phase-zero/real-plan-a.pdf'),
  path.join(root, 'fixtures/phase-zero/route-workbook.xlsx'),
]);
await page.getByRole('button', { name: 'Add files' }).click();
await page.getByText(/files are now in the server manifest/).waitFor({ timeout: 30_000 });
await page.getByRole('button', { name: 'Run next stage' }).click();
await page.getByText('Processing checkpoint saved. Review the current required action.').waitFor({ timeout: 90_000 });
const planImage = page.locator('.blueprint-transform img').first();
if (await planImage.count()) {
  await planImage.evaluate((image) => image.complete && image.naturalWidth > 0
    ? true
    : new Promise((resolve) => image.addEventListener('load', () => resolve(true), { once: true })));
}
await page.screenshot({ path: path.join(output, 'cabinet-brain-workspace-desktop.png'), fullPage: true });

await page.getByLabel('Reviewed classification').selectOption('KITCHEN_ELEVATION');
await page.getByText('Classification reviewed as kitchen elevation.').waitFor();

async function selectRegion() {
  await planImage.scrollIntoViewIfNeeded();
  const box = await planImage.boundingBox();
  if (!box) throw new Error('Rendered plan image has no browser bounding box.');
  await planImage.click({ position: { x: Math.max(12, box.width * .18), y: Math.max(12, box.height * .2) } });
  await planImage.click({ position: { x: Math.max(24, box.width * .42), y: Math.max(24, box.height * .38) } });
}

await selectRegion();
await page.getByRole('button', { name: 'Save source evidence' }).click();
await page.getByText('cabinet source evidence saved.').waitFor();
await page.getByLabel('Evidence kind').selectOption('unit_mix');
await selectRegion();
await page.getByRole('button', { name: 'Save source evidence' }).click();
await page.getByText('unit mix source evidence saved.').waitFor();
await page.waitForTimeout(500);

await page.getByRole('button', { name: 'Record reviewed extraction' }).click();
await page.getByText('Reviewed extraction recorded. Add the evidence-backed takeoff.').waitFor();
const cabinetCode = await page.evaluate(async () => {
  const pointer = JSON.parse(localStorage.getItem('vulpine.workspace.pointer.v1') || '{}');
  const response = await fetch(`/api/jobs/${pointer.jobId}/workspace`, { cache: 'no-store' });
  const payload = await response.json();
  return payload.data.canonical.catalogSkus[0].cabinetCode;
});
await page.getByLabel('Printed cabinet code').fill(cabinetCode);
await page.getByRole('button', { name: 'Create takeoff draft' }).click();
await page.getByText('Takeoff draft recorded. Explicit line approval is now required.').waitFor();
await page.getByRole('button', { name: 'Approve all reviewed takeoff lines' }).click();
await page.getByText('Every takeoff line was explicitly approved.').waitFor();
await page.getByRole('button', { name: 'Record unit mix draft' }).click();
await page.getByText('Unit mix draft recorded. A reviewer must verify every count.').waitFor();
await page.getByRole('button', { name: 'Verify every unit count' }).click();
await page.getByText('Unit mix verified. SKU mapping is ready.').waitFor();
await page.getByRole('button', { name: 'Run deterministic SKU mapping' }).click();
await page.getByText('Deterministic exact-match mapping completed. Resolve any exceptions explicitly.').waitFor();
await page.getByRole('button', { name: 'Compile authoritative estimate' }).click();
await page.getByText('Estimate compiled with deterministic integer arithmetic and server catalog costs.').waitFor();
await page.getByRole('button', { name: 'Run deterministic QA' }).click();
await page.getByText('Deterministic QA completed. Review its exact result before approval.').waitFor();
await page.getByRole('button', { name: 'Approve clean QA result' }).click();
await page.getByText('Latest clean QA result explicitly approved. Customer exports are unlocked.').waitFor();
await page.getByLabel('Customer company').fill('Browser QA Customer');
await page.getByLabel('Recipient').fill('buyer@example.com');
await page.getByRole('button', { name: 'Prepare approved draft' }).click();
await page.getByText('Approved canonical total synchronized and outreach draft prepared. Nothing has been sent.').waitFor();
await page.getByLabel('Add comment').fill('Browser-verified safe-to-send review.');
await page.getByRole('button', { name: 'Save review comment' }).click();
await page.getByText('Review comment saved with authenticated authorship.').waitFor();
await page.screenshot({ path: path.join(output, 'cabinet-brain-canonical-safe-desktop.png'), fullPage: true });

await page.reload({ waitUntil: 'networkidle' });
await page.getByText('Browser-verified safe-to-send review.').waitFor();
await page.locator('.workflow-truth strong').filter({ hasText: 'cabinet bid safe to send' }).waitFor();

await page.getByRole('button', { name: 'Pipeline' }).click();
await page.getByText('Backoffice command center').waitFor();
await page.screenshot({ path: path.join(output, 'cabinet-brain-backoffice-desktop.png'), fullPage: true });

await page.getByRole('button', { name: 'Settings' }).click();
await page.getByText('Processing settings').waitFor();
await page.getByRole('button', { name: 'Projects' }).click();
await page.setViewportSize({ width: 390, height: 844 });
await page.screenshot({ path: path.join(output, 'cabinet-brain-workspace-mobile.png'), fullPage: true });

const result = {
  url: page.url(),
  title: await page.title(),
  canonicalWorkflow: await page.locator('.workflow-truth strong').textContent(),
  renderedSheets: await page.locator('.sheet-thumb').count(),
  consoleErrors: errors,
};
await browser.close();
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
if (errors.length) process.exitCode = 1;
