import { expect, test, type Page } from '@playwright/test';
import { ADULT_MIN_SIZE, clippedCase, sizeCase, sizesForSlug } from './support/catalogue';
import { cards, chipsOn, headerSizes, resultCount, sizeLabel } from './support/page-helpers';

/**
 * The size filter, which is the product.
 *
 * §11's launch gate reads: search, filter to a size, and every card claims that size in
 * stock. Everything else on the site is navigation around this one promise, so it is the
 * first thing worth a test and the thing most worth testing against real data - the claim
 * is about a live catalogue, not about a fixture.
 */

test.describe('size filter', () => {
  test('every card claims the filtered size', async ({ page }) => {
    const { size } = await sizeCase();
    await page.goto(`/patike?velicina=${size}`);

    await expect(page.locator('#rezultati')).toBeVisible();
    const total = await resultCount(page);
    // Guard against a vacuous pass. An empty grid satisfies "every card claims the size"
    // for free, and that is precisely how a broken filter would look.
    expect(total).toBeGreaterThan(0);
    expect(await headerSizes(page)).toBe(sizeLabel(size));

    const list = cards(page);
    const count = await list.count();
    expect(count).toBeGreaterThan(0);

    const label = sizeLabel(size);
    const silent: string[] = [];
    for (let i = 0; i < count; i += 1) {
      const chips = await chipsOn(list.nth(i));
      if (!chips.some((chip) => chip.trim() === label)) {
        silent.push((await list.nth(i).locator('h3').innerText()).trim());
      }
    }

    expect(silent, `cards giving no sign they have EU ${size}: ${silent.join(' | ')}`).toHaveLength(
      0,
    );
  });

  test('a shoe with a long size run still shows the filtered one', async ({ page }) => {
    const clipped = await clippedCase();
    test.skip(clipped === null, 'no shoe in the catalogue stocks more than ten sizes below one');

    // Straight at the family rather than through a search, so the card is certain to be
    // on the page and the test is about the chips rather than about ranking.
    await page.goto(
      `/patike?model=${encodeURIComponent(clipped!.familyKey)}&velicina=${clipped!.size}&djecije=1`,
    );

    const card = cards(page).filter({ has: page.locator(`a[href*="${clipped!.slug}"]`) });
    await expect(card).toHaveCount(1);

    const chips = await chipsOn(card.first());
    expect(
      chips.map((c) => c.trim()),
      `${clipped!.slug} stocks ${clipped!.below} sizes below EU ${clipped!.size}`,
    ).toContain(sizeLabel(clipped!.size));
    // The rest are still accounted for rather than silently dropped.
    expect(chips.some((c) => c.trim().startsWith('+'))).toBe(true);
  });

  test('the database agrees with what the cards claim', async ({ page }) => {
    const { size } = await sizeCase();
    await page.goto(`/patike?velicina=${size}`);

    const list = cards(page);
    const count = await list.count();
    expect(count).toBeGreaterThan(0);

    // A sample rather than the page: each slug is its own round trip to Neon, and the
    // point is to catch a filter that is wrong in kind, not to re-verify SQL row by row.
    const sample = Math.min(count, 5);
    for (let i = 0; i < sample; i += 1) {
      const href = await list.nth(i).locator('a').first().getAttribute('href');
      expect(href, 'a card with no link').toBeTruthy();
      const slug = href!.split('?')[0]!.replace('/patika/', '');
      const sizes = await sizesForSlug(slug);
      expect(sizes, `${slug} is on a page filtered to ${size}`).toContain(size);
    }
  });

  test('a size nobody stocks says so instead of showing anything', async ({ page }) => {
    const { missing } = await sizeCase();
    await page.goto(`/patike?velicina=${missing}`);

    await expect(page.getByText('Nema rezultata za tu pretragu.')).toBeVisible();
    await expect(cards(page)).toHaveCount(0);
    // Two of them: one in the picker, one in the empty state. The empty state's is the
    // one someone reading "nothing found" will reach for.
    await expect(page.getByRole('link', { name: 'Obriši filtere' }).last()).toBeVisible();
  });

  test('ticking a size runs the search and keeps the typed query', async ({ page }) => {
    const { size } = await sizeCase();
    await page.goto('/patike');

    // One form, deliberately: two forms meant clicking a size discarded whatever had
    // been typed, which silently turned a model search into a bare size search.
    await page.getByRole('combobox', { name: 'Pretraži' }).fill('air');

    // Suggestions open over the picker — on a phone they cover the whole grid — so they
    // are dismissed the way a person would, by tapping outside them. Waited for first,
    // because tapping before they arrive leaves them to open over the chips afterwards.
    await page
      .getByRole('listbox')
      .waitFor({ timeout: 5_000 })
      .catch(() => {});
    await page.locator('header p').first().click();
    await expect(page.getByRole('listbox')).toHaveCount(0);

    // The chip, not the input inside it. The checkbox is `sr-only` — a 1x1 clipped box —
    // and forcing a click onto it toggles in Chromium but not in WebKit, where the mobile
    // run failed on exactly that. Tapping the visible chip is also what a thumb does.
    const chip = page.locator(`label:has(input[name="velicina"][value="${size}"])`);
    await chip.click();
    await expect(page.locator(`input[name="velicina"][value="${size}"]`)).toBeChecked();

    await page.getByRole('button', { name: 'Pretraži' }).click();

    await expect(page).toHaveURL(new RegExp(`velicina=${size}`));
    await expect(page).toHaveURL(/q=air/);
    expect(await headerSizes(page)).toBe(sizeLabel(size));
  });
});

/**
 * The picker itself: whole adult sizes in an even grid, everything else one tap away inside
 * the same box.
 *
 * Asserted by geometry as much as by content, because the request was about shape — the
 * base sizes in full rows of equal cells, and opening the full view not moving the page.
 */
test.describe('size picker', () => {
  const grid = (page: Page) => page.locator('#velicine-grid');
  const visibleSizes = (page: Page) =>
    grid(page)
      .locator('label')
      .evaluateAll((labels) =>
        labels
          .filter((l) => (l as HTMLElement).offsetParent !== null)
          .map((l) => Number((l.querySelector('input') as HTMLInputElement).value)),
      );

  test('shows whole adult sizes in an even grid', async ({ page }) => {
    await page.goto('/');
    const sizes = await visibleSizes(page);

    expect(sizes.length).toBeGreaterThan(0);
    expect(sizes.every((s) => Number.isInteger(s) && s >= ADULT_MIN_SIZE)).toBe(true);
    // Halves, thirds and children's sizes exist in the catalogue, only not on show.
    const all = await grid(page).locator('input[name="velicina"]').count();
    expect(all).toBeGreaterThan(sizes.length);

    const cells = await grid(page)
      .locator('label')
      .evaluateAll((labels) =>
        labels
          .filter((l) => (l as HTMLElement).offsetParent !== null)
          .map((l) => Math.round(l.getBoundingClientRect().width)),
      );
    expect(new Set(cells).size, 'every cell the same width').toBe(1);

    await expect(page.getByText('Prikaži sve brojeve', { exact: true })).toBeVisible();
    await expect(page.getByText(/dječije brojeve/)).toHaveCount(0);
  });

  test('showing every size scrolls inside the box instead of growing it', async ({ page }) => {
    await page.goto('/');
    const before = await grid(page).boundingBox();
    const button = await page.getByRole('button', { name: 'Pretraži' }).boundingBox();

    await page.getByText('Prikaži sve brojeve', { exact: true }).click();
    await expect(page.getByText('Prikaži manje brojeva', { exact: true })).toBeVisible();

    const sizes = await visibleSizes(page);
    expect(
      sizes.some((s) => !Number.isInteger(s)),
      'halves and thirds shown',
    ).toBe(true);
    expect(
      sizes.some((s) => s < ADULT_MIN_SIZE),
      "children's sizes shown",
    ).toBe(true);

    const after = await grid(page).boundingBox();
    expect(Math.round(after!.height)).toBe(Math.round(before!.height));
    const scrollable = await grid(page).evaluate((el) => el.scrollHeight > el.clientHeight);
    expect(scrollable).toBe(true);
    // Nothing below the picker moved.
    const buttonAfter = await page.getByRole('button', { name: 'Pretraži' }).boundingBox();
    expect(Math.round(buttonAfter!.y)).toBe(Math.round(button!.y));

    // It opens on the adult sizes, not on the children's at the top of the list.
    const first = await grid(page).locator('label[data-base]').first().boundingBox();
    const box = (await grid(page).boundingBox())!;
    expect(first!.y).toBeGreaterThanOrEqual(box.y - 1);
    expect(first!.y + first!.height).toBeLessThanOrEqual(box.y + box.height + 1);
  });

  test('a half or a third already chosen opens the full view on it', async ({ page }) => {
    await page.goto('/');
    // One the catalogue actually stocks, taken from the picker rather than invented.
    const third = await grid(page)
      .locator('input[name="velicina"]')
      .evaluateAll((inputs) =>
        inputs
          .map((i) => (i as HTMLInputElement).value)
          .find((v) => Number(v) >= 40 && !Number.isInteger(Number(v))),
      );
    expect(third, 'the catalogue stocks no half or third size at all').toBeTruthy();
    await page.goto(`/patike?velicina=${third}`);

    const chip = grid(page).locator(`label:has(input[value="${third}"])`);
    await expect(chip).toBeVisible();
    await expect(chip.locator('input')).toBeChecked();
    await expect(page.getByText('Prikaži manje brojeva', { exact: true })).toBeVisible();
  });

  test.describe('without JavaScript', () => {
    test.use({ javaScriptEnabled: false });

    test('the full view still opens', async ({ page }) => {
      await page.goto('/');
      const base = (await visibleSizes(page)).length;
      await page.getByText('Prikaži sve brojeve', { exact: true }).click();
      expect((await visibleSizes(page)).length).toBeGreaterThan(base);
    });
  });
});
