import { expect, test } from '@playwright/test';
import { kidsOnlyFamily, searchTerm, sizeCase } from './support/catalogue';
import { cards, suggestFor } from './support/page-helpers';

/**
 * The model typeahead - the site's only client component.
 *
 * Which makes it the only feature here that can be broken by a bundle that never loaded,
 * and that has happened: for a while the phone was served HTML whose every script 403'd,
 * so nothing hydrated and the one control made of JavaScript was the only thing that
 * looked broken. A test that exercises it in a real browser is the cheapest guard against
 * that class of failure.
 *
 * It must also degrade: with no JavaScript at all the field is a plain `name="q"` input in
 * the filter form, and pressing Enter still runs the freeform search.
 */

test.describe('model typeahead', () => {
  test('suggests models and puts the chosen name in the box', async ({ page }) => {
    const term = await searchTerm();
    await page.goto('/patike');

    const list = await suggestFor(page, term.slice(0, 4));
    const box = page.getByRole('combobox', { name: 'Pretraži' });
    const options = list.getByRole('option');
    expect(await options.count()).toBeGreaterThan(0);

    const chosen = (await options.first().locator('span').first().innerText())
      .replace(/\s+/g, ' ')
      .trim();

    await options.first().click();

    // Typing "p6" and picking "Nike P-6000" used to leave "p6" in the box while the grid
    // changed behind it: nothing said which shoe had been selected, or that anything had.
    await expect(box).toHaveValue(chosen);
    await expect(list).toBeHidden();
  });

  test('picking a model filters the grid and drops the brand chips', async ({ page }) => {
    const term = await searchTerm();
    await page.goto('/patike');

    const options = (await suggestFor(page, term.slice(0, 4))).getByRole('option');
    await expect(options.first()).toBeVisible();

    // Every row lands on filtered results, one colourway or thirty. Going straight to a
    // product page for a single-colourway family read as a shortcut and behaved as a trap.
    await options.first().click();
    await page.waitForURL(/model=/);
    expect(page.url()).not.toContain('/patika/');

    await expect(page.getByText('Model')).toBeVisible();
    // A model belongs to exactly one brand, so a brand filter would collapse to a single
    // chip already implied by the model above it.
    await expect(page.getByRole('navigation', { name: 'Brend' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'prikaži sve' })).toBeVisible();
    expect(await cards(page).count()).toBeGreaterThan(0);
  });

  test('on the home page a picked model waits for "Pretraži", sizes and all', async ({ page }) => {
    const { size } = await sizeCase();
    await page.goto('/');

    // Model first, size after: the order someone is likely to use, which a pick that
    // jumped straight to the results made impossible.
    const term = await searchTerm();
    const options = (await suggestFor(page, term.slice(0, 4))).getByRole('option');
    await expect(options.first()).toBeVisible();
    const name = (await options.first().locator('span').first().innerText())
      .replace(/\s+/g, ' ')
      .trim();
    await options.first().click();

    await expect(page.getByRole('combobox', { name: 'Pretraži' })).toHaveValue(name);
    await page.waitForTimeout(500);
    expect(new URL(page.url()).pathname, 'picking a model left the home page').toBe('/');

    await page.locator(`label:has(input[name="velicina"][value="${size}"])`).click();
    await page.getByRole('button', { name: 'Pretraži' }).click();

    await page.waitForURL(/model=/);
    const url = new URL(page.url());
    expect(url.pathname).toBe('/patike');
    expect(url.searchParams.get('velicina')).toBe(String(size));
    expect(url.searchParams.get('model')).toBeTruthy();
    // The chosen model, not its name as free text, which would match every variation.
    expect(url.searchParams.get('q')).toBeNull();

    // And the box on the results page still says which model this is.
    await expect(page.getByRole('combobox', { name: 'Pretraži' })).toHaveValue(name);
  });

  test("a size ticked on a model's results keeps the model when searched", async ({ page }) => {
    const { size } = await sizeCase();
    const term = await searchTerm();
    await page.goto('/patike');
    const options = (await suggestFor(page, term.slice(0, 4))).getByRole('option');
    await options.first().click();
    await page.waitForURL(/model=/);
    const model = new URL(page.url()).searchParams.get('model');

    // The form used to carry only sizes and text, so this dropped the model entirely.
    await page.locator(`label:has(input[name="velicina"][value="${size}"])`).click();
    await page.getByRole('button', { name: 'Pretraži' }).click();
    await page.waitForURL(new RegExp(`velicina=${size}`));
    expect(new URL(page.url()).searchParams.get('model')).toBe(model);
  });

  test("a model that only exists as a child's shoe still shows it", async ({ page }) => {
    const family = await kidsOnlyFamily();
    test.skip(family === null, 'no family in the catalogue is children-only right now');

    await page.goto(`/patike?model=${encodeURIComponent(family!.key)}`);
    // Children's listings are hidden by default so an unfiltered search is not a wall of
    // them, but a model chosen by name is an explicit request for that model.
    expect(await cards(page).count()).toBeGreaterThan(0);
  });

  test('the endpoint answers on its own', async ({ request }) => {
    const term = await searchTerm();
    const response = await request.get(`/api/modeli?q=${encodeURIComponent(term.slice(0, 4))}`);
    expect(response.status()).toBe(200);

    const body = (await response.json()) as {
      items: { key: string; model: string; colourways: number; shopCount: number }[];
    };
    expect(body.items.length).toBeGreaterThan(0);
    for (const item of body.items) {
      expect(item.key).toBeTruthy();
      expect(item.model).toBeTruthy();
      expect(item.colourways).toBeGreaterThan(0);
    }

    // A query too short to mean anything returns nothing rather than the catalogue.
    const short = await request.get('/api/modeli?q=a');
    expect(short.status()).toBe(200);
    expect(((await short.json()) as { items: unknown[] }).items).toHaveLength(0);
  });
});

/**
 * The same search box with the bundle taken away.
 *
 * Not a hypothetical: the phone spent a week being served HTML whose every client chunk
 * 403'd, and the only thing that looked broken was the one control made of JavaScript.
 * Everything else kept working, which is why it took a week to notice - and that is the
 * property being asserted here, deliberately, rather than assumed.
 *
 * The filter form posts to a server action, which Next renders as a real form so it
 * submits without JavaScript. If that ever stops being true, the site loses its floor.
 */
test.describe('without JavaScript', () => {
  test.use({ javaScriptEnabled: false });

  test('typing and submitting still searches', async ({ page }) => {
    const term = await searchTerm();
    await page.goto('/patike');

    await page.getByRole('combobox', { name: 'Pretraži' }).fill(term);
    await page.getByRole('button', { name: 'Pretraži' }).click();

    await expect(page).toHaveURL(new RegExp(`q=${encodeURIComponent(term)}`));
    expect(await cards(page).count()).toBeGreaterThan(0);
  });

  test('the size chips still compose a query', async ({ page }) => {
    const { size } = await sizeCase();
    await page.goto('/patike');

    await page.locator(`label:has(input[name="velicina"][value="${size}"])`).click();
    await page.getByRole('button', { name: 'Pretraži' }).click();

    await expect(page).toHaveURL(new RegExp(`velicina=${size}`));
    expect(await cards(page).count()).toBeGreaterThan(0);
  });
});
