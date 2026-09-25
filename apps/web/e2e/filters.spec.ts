import { expect, test, type Page } from '@playwright/test';
import {
  deleteSearchMisses,
  exactAndVariationCase,
  searchTerm,
  sizeCase,
} from './support/catalogue';
import { cards, parsePrice, resultCount } from './support/page-helpers';

/**
 * The controls around the grid.
 *
 * Each of these locks in a fault that was reported from the live site rather than found
 * by reading the code, which is the argument for having the suite at all: they were all
 * cheap to see and none of them showed up in a unit test.
 */

/** A query nothing can match, so the empty state is the one offering the way out. */
const NOTHING = 'qzzxvnothing';

test.describe('filters', () => {
  // The site logs a search that finds nothing, and this one is not a visitor's.
  test.afterAll(async () => {
    await deleteSearchMisses(NOTHING);
  });

  test('"Obriši filtere" empties the size picker, not only the URL', async ({ page }) => {
    const { size } = await sizeCase();
    await page.goto(`/patike?velicina=${size}&q=${NOTHING}`);
    await expect(page.getByText('Nema rezultata za tu pretragu.')).toBeVisible();

    const chip = page.locator(`input[name="velicina"][value="${size}"]`);
    await expect(chip).toBeChecked();

    await page.getByRole('link', { name: 'Obriši filtere' }).last().click();
    await expect(page).toHaveURL(/\/patike$/);

    // The chips are uncontrolled inputs - `defaultChecked` applies on mount and never
    // again - and a client navigation reuses the DOM node, so the picker used to keep
    // ticks the URL had already dropped.
    await expect(chip).not.toBeChecked();
    await expect(page.locator('input[name="velicina"]:checked')).toHaveCount(0);
  });

  test('cheapest-first really is cheapest first', async ({ page }) => {
    const { size } = await sizeCase();
    await page.goto(`/patike?velicina=${size}&sort=najjeftinije`);

    const list = cards(page);
    const count = await list.count();
    expect(count).toBeGreaterThan(1);

    const prices: number[] = [];
    for (let i = 0; i < count; i += 1) {
      const price = parsePrice(await list.nth(i).innerText());
      expect(price, `card ${i} shows no price`).not.toBeNull();
      prices.push(price!);
    }
    expect(prices).toEqual([...prices].sort((a, b) => a - b));

    await page.goto(`/patike?velicina=${size}&sort=najskuplje`);
    const dear: number[] = [];
    const dearCount = await list.count();
    for (let i = 0; i < dearCount; i += 1) {
      dear.push(parsePrice(await list.nth(i).innerText())!);
    }
    expect(dear).toEqual([...dear].sort((a, b) => b - a));
    expect(dear[0]).toBeGreaterThan(prices[0]!);
  });

  test('the sort menu closes when you pick an order, and when you tap outside it', async ({
    page,
  }) => {
    const { size } = await sizeCase();
    await page.goto(`/patike?velicina=${size}`);

    const trigger = page.getByText('Sortiraj:');
    const option = page.getByRole('link', { name: 'Najjeftinije' });

    await trigger.click();
    await expect(option).toBeVisible();

    // A native <details> has no idea a link inside it navigated, so the menu used to
    // stay open over the reordered results - and on a phone there is no stray click to
    // dismiss it, leaving the trigger as the only way out.
    await option.click();
    await expect(page).toHaveURL(/sort=najjeftinije/);
    await expect(option).toBeHidden();

    await trigger.click();
    await expect(page.getByRole('link', { name: 'Najskuplje' })).toBeVisible();
    await page.locator('header p').first().click();
    await expect(page.getByRole('link', { name: 'Najskuplje' })).toBeHidden();
  });

  test('a brand chip narrows the results and can be switched off again', async ({ page }) => {
    const { size } = await sizeCase();
    await page.goto(`/patike?velicina=${size}`);
    const all = await resultCount(page);

    const chip = page.getByRole('navigation', { name: 'Brend' }).getByRole('link').first();
    const brand = (await chip.innerText()).trim();
    await chip.click();

    await expect(page).toHaveURL(/brend=/);
    const narrowed = await resultCount(page);
    expect(narrowed).toBeGreaterThan(0);
    expect(narrowed).toBeLessThan(all);

    // Every active chip switches itself off: that is why there is no "all brands" reset.
    const active = page.getByRole('navigation', { name: 'Brend' }).getByRole('link', {
      name: brand,
      exact: true,
    });
    await active.click();
    await expect.poll(async () => resultCount(page)).toBe(all);
  });

  test('pagination moves through the results without losing the filter', async ({ page }) => {
    const term = await searchTerm();
    await page.goto(`/patike?q=${encodeURIComponent(term)}`);

    const total = await resultCount(page);
    test.skip(
      total <= 48,
      `only ${total} results for "${term}" - one page, nothing to page through`,
    );

    const firstTitle = await cards(page).first().locator('h3').innerText();
    await page.getByRole('link', { name: 'Sljedeća' }).click();

    await expect(page).toHaveURL(/strana=2/);
    await expect(page).toHaveURL(new RegExp(`q=${encodeURIComponent(term)}`));
    await expect(page.getByText(/Prikazano 49-/)).toBeVisible();
    expect((await cards(page).first().locator('h3').innerText()).trim()).not.toBe(
      firstTitle.trim(),
    );
  });

  test('a search lists the exact model before its variations', async ({ page }) => {
    const model = await exactAndVariationCase();
    test.skip(model === null, 'no model name exists both alone and as a prefix');

    await page.goto(`/patike?q=${encodeURIComponent(model!)}`);
    const titles = (await cards(page).locator('h3').allInnerTexts()).map((t) =>
      t.trim().toLowerCase(),
    );
    expect(titles.length).toBeGreaterThan(1);

    // "samba" should read Samba, Samba, Samba… then Samba OG, XLG, LT — not a plain Samba
    // turning up again after the variations, which is what scoring shop titles produced.
    const firstVariation = titles.findIndex((t) => t !== model);
    const lastExact = titles.lastIndexOf(model!);
    test.skip(firstVariation === -1, 'only exact matches on the first page');
    expect(lastExact, `titles: ${titles.join(' | ')}`).toBeLessThan(firstVariation);
  });

  test('the last page is as quick as the first', async ({ page, request }) => {
    await page.goto('/patike');
    const total = await resultCount(page);
    const last = Math.ceil(total / 48);
    test.skip(last < 20, `only ${last} pages - too few for the offset to cost anything`);

    // Timed on the bare request, so it measures the server rather than image loading.
    // Before the size and shop lists were built for the page alone, this took 14s: they
    // were evaluated for every row on the way to the offset, so the cost grew with the
    // page number, and the pager links the last page from every page.
    const started = Date.now();
    const response = await request.get(`/patike?strana=${last}`);
    const elapsed = Date.now() - started;
    expect(response.status()).toBe(200);
    expect(elapsed, `page ${last} took ${elapsed}ms`).toBeLessThan(8_000);

    await page.goto(`/patike?strana=${last}`);
    expect(await cards(page).count()).toBeGreaterThan(0);
    await expect(
      page.getByText(new RegExp(`od ${total.toLocaleString('de-DE')}\\.`)),
    ).toBeVisible();
  });

  test('a page past the end says so instead of looking like an empty search', async ({ page }) => {
    await page.goto('/patike?strana=9999');
    await expect(page.getByText('Nema rezultata na toj stranici.')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Nazad na prvu stranicu' })).toBeVisible();
  });
});

/** Tick one more base size than the page was loaded with, and return its value. */
async function tickAnotherSize(page: Page): Promise<string> {
  const label = page
    .locator('label[data-base]:has(input[name="velicina"]:not(:disabled):not(:checked))')
    .first();
  const value = (await label.locator('input').getAttribute('value'))!;
  await label.click();
  // By value: the locator above would re-resolve to the next unticked size.
  await expect(page.locator(`input[name="velicina"][value="${value}"]`)).toBeChecked();
  return value;
}

const sizesIn = (url: string) =>
  (new URL(url).searchParams.get('velicina') ?? '').split(',').filter(Boolean);

test.describe('a size ticked but not yet searched', () => {
  test('is used by the next filter chosen', async ({ page }) => {
    const { size } = await sizeCase();
    await page.goto(`/patike?velicina=${size}`);
    const extra = await tickAnotherSize(page);

    // Ticking alone does not search, and should not; the next filter should see it.
    await page.getByRole('link', { name: 'Muške', exact: true }).first().click();
    await expect(page).toHaveURL(/pol=men/);
    expect(sizesIn(page.url()).sort()).toEqual([String(size), extra].sort());
  });

  test('is used by the order chosen, and the menu still closes', async ({ page }) => {
    const { size } = await sizeCase();
    await page.goto(`/patike?velicina=${size}`);
    const extra = await tickAnotherSize(page);

    await page.getByText('Sortiraj:').click();
    const option = page.getByRole('link', { name: 'Najjeftinije' });
    await option.click();
    await expect(page).toHaveURL(/sort=najjeftinije/);
    expect(sizesIn(page.url())).toContain(extra);
    await expect(option).toBeHidden();
  });

  test('searching again keeps the order and the other filters', async ({ page }) => {
    const { size } = await sizeCase();
    await page.goto(`/patike?velicina=${size}&sort=najjeftinije&pol=men`);
    const extra = await tickAnotherSize(page);

    await page.getByRole('button', { name: 'Pretraži' }).click();
    await expect(page).toHaveURL(new RegExp(`velicina=[^&]*${extra}`));
    const url = new URL(page.url());
    expect(url.searchParams.get('sort')).toBe('najjeftinije');
    expect(url.searchParams.get('pol')).toBe('men');
  });
});
