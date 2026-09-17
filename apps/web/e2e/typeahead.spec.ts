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

  test('a model picked on the home page keeps the sizes ticked there', async ({ page }) => {
    const { size } = await sizeCase();
    await page.goto('/');

    // The home page has never submitted the form, so the URL knows nothing about the
    // sizes on screen: picking a model used to throw the ticked size away.
    await page.locator(`label:has(input[name="velicina"][value="${size}"])`).click();
    const term = await searchTerm();
    const options = (await suggestFor(page, term.slice(0, 4))).getByRole('option');
    await expect(options.first()).toBeVisible();
    await options.first().click();

    await page.waitForURL(/model=/);
    const url = new URL(page.url());
    expect(url.pathname).toBe('/patike');
    expect(url.searchParams.get('velicina')).toBe(String(size));
    expect(url.searchParams.get('model')).toBeTruthy();
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
