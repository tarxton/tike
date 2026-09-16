import { expect, test } from '@playwright/test';
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

  test("children's sizes stay behind their toggle", async ({ page }) => {
    await page.goto('/patike');
    const picker = page.getByRole('group', { name: 'Tvoj broj' });

    // Results order by price and children's shoes are structurally cheaper, so an
    // unfiltered search would otherwise open on a wall of them.
    const adultOnly = await picker
      .locator('input[name="velicina"]')
      .evaluateAll((els) => els.map((el) => Number((el as HTMLInputElement).value)));
    expect(adultOnly.length).toBeGreaterThan(0);
    expect(Math.min(...adultOnly)).toBeGreaterThanOrEqual(ADULT_MIN_SIZE);

    await page.goto('/patike?djecije=1');
    const withKids = await page
      .getByRole('group', { name: 'Tvoj broj' })
      .locator('input[name="velicina"]')
      .evaluateAll((els) => els.map((el) => Number((el as HTMLInputElement).value)));
    expect(Math.min(...withKids)).toBeLessThan(ADULT_MIN_SIZE);
  });

  test('ticking a size runs the search and keeps the typed query', async ({ page }) => {
    const { size } = await sizeCase();
    await page.goto('/patike');

    // One form, deliberately: two forms meant clicking a size discarded whatever had
    // been typed, which silently turned a model search into a bare size search.
    await page.getByRole('combobox', { name: 'Pretraži' }).fill('air');

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
