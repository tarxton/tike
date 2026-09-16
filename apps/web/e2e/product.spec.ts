import { expect, test } from '@playwright/test';
import { aliasCase, productCase, sizeCase } from './support/catalogue';
import { cards, parsePrice } from './support/page-helpers';

/**
 * One shoe, every shop that sells it.
 *
 * The page the grouping work was for: a card can honestly say "3 prodavnice" only because
 * this exists to answer which three and at what price. §11 asks that it list at least two
 * shops cheapest-first, so that ordering is asserted rather than assumed - it is the
 * site's entire argument, and getting it backwards would recommend the dearest shop.
 */

test.describe('product page', () => {
  test('lists every shop, cheapest first', async ({ page }) => {
    const product = await productCase();
    test.skip(product === null, 'no product is carried by two shops at different prices right now');

    await page.goto(`/patika/${product!.slug}`);
    await expect(page.locator('h1')).not.toBeEmpty();

    const rows = page.getByTestId('shop-rows').locator('> li');
    await expect(rows).toHaveCount(product!.shopCount);

    const prices: number[] = [];
    for (let i = 0; i < product!.shopCount; i += 1) {
      // The first price in a row is what the shop charges today; an old price, when there
      // is one, follows it struck through.
      const price = parsePrice(await rows.nth(i).innerText());
      expect(price, `row ${i} shows no price`).not.toBeNull();
      prices.push(price!);
    }

    expect(prices).toEqual([...prices].sort((a, b) => a - b));
    expect(prices).toEqual(product!.prices);

    // Only when some other shop is dearer - "cheapest" of two identical prices says
    // nothing, and this case was chosen to have a spread.
    await expect(rows.first().getByText('najjeftinije')).toBeVisible();
    await expect(page.getByText(/Ušteda do/)).toBeVisible();
  });

  test('says which shops have your size and which do not', async ({ page }) => {
    const product = await productCase();
    test.skip(product === null, 'no multi-shop product available');
    const { size } = await sizeCase();

    await page.goto(`/patika/${product!.slug}?velicina=${size}`);
    const rows = page.getByTestId('shop-rows').locator('> li');
    const count = await rows.count();
    expect(count).toBeGreaterThan(0);

    for (let i = 0; i < count; i += 1) {
      const row = rows.nth(i);
      const text = await row.innerText();

      // Every row states one or the other. The cheapest shop having sold out of your
      // size is the single most useful thing this page can say, and silence on it is
      // indistinguishable from "yes".
      expect(text, `row ${i} says nothing about the size`).toMatch(/tvoj broj/);
      const claims = !text.includes('nema tvoj broj');

      // Chips are that shop's own sizes, truncated at fourteen - so they are only
      // evidence when nothing was truncated.
      const chips = await row.locator('ul li').allInnerTexts();
      if (!chips.some((c) => c.trim().startsWith('+'))) {
        const listed = chips.some((c) => c.trim() === String(size));
        expect(
          listed,
          `row ${i} says "${claims ? 'tvoj broj' : 'nema tvoj broj'}" and its chips disagree`,
        ).toBe(claims);
      }
    }
  });

  test('a card opens the product page with the size carried along', async ({ page }) => {
    const { size } = await sizeCase();
    await page.goto(`/patike?velicina=${size}`);

    const first = cards(page).first();
    const title = (await first.locator('h3').innerText()).trim();
    await first.locator('a').first().click();

    await expect(page).toHaveURL(new RegExp(`/patika/.+velicina=${size}`));
    // The product page shows the canonical model, which is the same string the card
    // shows - one shoe, one name, whichever shop is cheapest.
    await expect(page.locator('h1')).toHaveText(title);
  });

  test('back returns to the same results, at the same place in them', async ({ page }) => {
    const { size } = await sizeCase();
    const results = `/patike?velicina=${size}`;
    await page.goto(results);

    const list = cards(page);
    const count = await list.count();
    expect(count).toBeGreaterThan(4);

    // Down the page, because that is the case that was broken: the header arrow is an
    // ordinary link, so it pushes a new history entry and there is nothing to restore.
    const target = list.nth(count - 1);
    await target.scrollIntoViewIfNeeded();
    const before = await page.evaluate(() => window.scrollY);
    expect(before).toBeGreaterThan(0);

    await target.locator('a').first().click();
    await expect(page).toHaveURL(/\/patika\//);

    await page.getByRole('link', { name: 'Nazad na pretragu' }).click();
    await expect(page).toHaveURL(new RegExp(`velicina=${size}`));

    // Lazily loaded images settle a few pixels either way; the failure this guards
    // against was landing at the very top, two screens from where you were.
    await expect
      .poll(async () => page.evaluate(() => window.scrollY), { timeout: 10_000 })
      .toBeGreaterThan(before - 400);
  });

  test('an unknown slug is a 404', async ({ page }) => {
    const response = await page.goto('/patika/ova-patika-ne-postoji-12345');
    expect(response?.status()).toBe(404);
  });

  test('a slug a product outgrew still resolves, permanently', async ({ request }) => {
    const alias = await aliasCase();
    test.skip(alias === null, 'no product has been renamed yet, so there is no alias to follow');

    const response = await request.get(`/patika/${alias!.from}`, { maxRedirects: 0 });
    // 308 rather than 307: a temporary redirect asks crawlers to keep treating the dead
    // URL as canonical, which is the opposite of what a merge means.
    expect(response.status()).toBe(308);
    expect(response.headers()['location']).toContain(`/patika/${alias!.to}`);
  });
});
