import { test, expect } from '@playwright/test';

test('tax autopilot flow', async ({ page }) => {
  // Mock login by setting cookie (depends on auth strategy)
  await page.context().addCookies([
    {
      name: 'mock-privy-did',
      value: 'did:privy:test-dogfood',
      domain: 'localhost',
      path: '/',
      httpOnly: false,
      secure: false,
      sameSite: 'Lax',
    },
  ]);

  await page.goto('http://localhost:3050/dashboard');

  // Wait for tile
  await expect(page.getByText('Tax Vault Balance')).toBeVisible();

  const statusEl = page.locator('[data-test="tax-status"]');
  const heldEl = page.locator('[data-test="tax-held"]');
  const liabilityEl = page.locator('[data-test="tax-liability"]');

  // Pre-condition: underfunded
  await expect(statusEl).toHaveText(/Underfunded/);

  const heldBefore = await heldEl.innerText();

  // Approve sweep
  const approveBtn = page.getByRole('button', { name: 'Approve' });
  await approveBtn.click();

  // Toast
  await expect(page.getByText(/Sweep transaction submitted/)).toBeVisible();

  // Wait until tile turns green (Covered)
  await expect(statusEl).toHaveText(/Covered/, { timeout: 30_000 });

  const heldAfter = await heldEl.innerText();
  expect(heldAfter).not.toBe(heldBefore);
});