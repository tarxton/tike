import { expect, test, type Page } from '@playwright/test';
import { clippedCase, nearOnlyCase, sizeCase, sizesForSlug } from './support/catalogue';
import { cards, chipsOn, headerSizes, resultCount, sizeLabel } from './support/page-helpers';
import { BASE_MAX_SIZE, BASE_MIN_SIZE } from '../src/lib/sizes';

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

    // The size itself, or a half or a third of it: some brands never make the plain
    // number, and the search includes those shoes on purpose (outlined, not filled).
    const labels = [size, size + 0.33, size + 0.5, size + 0.67].map(sizeLabel);
    const silent: string[] = [];
    for (let i = 0; i < count; i += 1) {
      const chips = await chipsOn(list.nth(i));
      if (!chips.some((chip) => labels.includes(chip.trim()))) {
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
      expect(
        sizes.some((s) => s >= size && s < size + 1),
        `${slug} is on a page filtered to ${size} but stocks ${sizes.join(', ')}`,
      ).toBe(true);
    }
  });

  test('a whole size brings its halves and thirds, outlined rather than filled', async ({
    page,
  }) => {
    const near = await nearOnlyCase();
    test.skip(near === null, 'no shoe stocks a third of a size without the size itself');

    await page.goto(`/patike?model=${encodeURIComponent(near!.familyKey)}&velicina=${near!.size}`);
    const card = cards(page).filter({ has: page.locator(`a[href*="${near!.slug}"]`) });
    await expect(card).toHaveCount(1);

    // The near size is there, and styled as not-quite-yours: no filled chip claims the
    // plain number the shoe does not come in.
    const chip = card.locator('ul li', { hasText: new RegExp(`^${sizeLabel(near!.nearSize)}$`) });
    await expect(chip).toHaveCount(1);
    // Asserted as what it is rather than what it is not: Tailwind reports colours in
    // oklch, so "not the dark fill" would pass for a filled chip too.
    const background = await chip.evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(background).toMatch(/rgb\(255, 255, 255\)|oklch\(1 0 0\)/);
    await expect(
      card.locator('ul li', { hasText: new RegExp(`^${sizeLabel(near!.size)}$`) }),
    ).toHaveCount(0);
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

  test('shows every whole size from 28 to 51 in an even grid', async ({ page }) => {
    await page.goto('/');
    const sizes = await visibleSizes(page);

    // The whole range, always, so the grid keeps its shape.
    const expected = Array.from(
      { length: BASE_MAX_SIZE - BASE_MIN_SIZE + 1 },
      (_, i) => BASE_MIN_SIZE + i,
    );
    expect(sizes).toEqual(expected);
    // Halves, thirds and the smallest sizes exist in the catalogue, only not on show.
    const all = await grid(page).locator('input[name="velicina"]').count();
    expect(all).toBeGreaterThan(sizes.length);

    const layout = await grid(page)
      .locator('label')
      .evaluateAll((labels) => {
        const shown = labels.filter((l) => (l as HTMLElement).offsetParent !== null);
        return {
          rows: new Set(shown.map((l) => Math.round(l.getBoundingClientRect().top))).size,
        };
      });
    // Full rows: three of eight wide, four of six on a phone.
    expect(expected.length % layout.rows, `${expected.length} sizes in ${layout.rows} rows`).toBe(
      0,
    );
    expect(layout.rows).toBeGreaterThanOrEqual(3);

    await expect(page.getByText('Prikaži sve brojeve', { exact: true })).toBeVisible();
    await expect(page.getByText(/dječije brojeve/)).toHaveCount(0);
  });

  test('every size button is the same size, halves and thirds included', async ({ page }) => {
    await page.goto('/');
    await page.getByText('Prikaži sve brojeve', { exact: true }).click();

    const boxes = await grid(page)
      .locator('label .size-chip')
      .evaluateAll((chips) =>
        chips
          .filter((c) => (c as HTMLElement).offsetParent !== null)
          .map((c) => {
            const r = c.getBoundingClientRect();
            return { text: c.textContent, size: `${Math.round(r.width)}x${Math.round(r.height)}` };
          }),
      );
    expect(boxes.some((b) => /[½⅓⅔]/.test(b.text ?? ''))).toBe(true);
    const sizes = new Set(boxes.map((b) => b.size));
    expect([...sizes], 'distinct button sizes in the full view').toHaveLength(1);
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
      sizes.some((s) => s < BASE_MIN_SIZE),
      'sizes below the grid shown',
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

    // One scrollbar, never two. On a touch screen it is ours, because iOS draws none until
    // a scroll is under way and the box read as one that cut the list off. On a desktop it
    // is the browser's own, and ours drawn beside it made two.
    const thumb = page.locator('#velicine-thumb');
    const touch = await page.evaluate(
      () => matchMedia('(hover: none) and (pointer: coarse)').matches,
    );
    // Asserted on the style rather than measured: headless Chromium hides native
    // scrollbars altogether, so a width would read 0 where a real desktop draws one.
    const nativeScrollbar = await grid(page).evaluate((el) =>
      getComputedStyle(el).getPropertyValue('scrollbar-width'),
    );
    if (!touch) {
      await expect(page.locator('.size-scrollbar')).toBeHidden();
      expect(nativeScrollbar, 'the browser keeps its own scrollbar').toBe('thin');
      return;
    }
    expect(nativeScrollbar, 'no native scrollbar beside ours').toBe('none');
    await expect(thumb).toBeVisible();
    const top = async () => {
      const t = await page.locator('.size-scrollbar').boundingBox();
      const h = await thumb.boundingBox();
      return Math.round(h!.y - t!.y);
    };
    const thumbBefore = await top();
    await grid(page).evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    await page.waitForTimeout(150);
    expect(await top(), 'the thumb follows the scroll').toBeGreaterThan(thumbBefore);
  });

  test('a size in the grid that nobody stocks cannot be ticked', async ({ page }) => {
    await page.goto('/');
    const unstocked = grid(page).locator('label:has(input:disabled)');
    // Today every size from 28 to 51 is stocked somewhere; 51 had two offers and 50 four,
    // so this is the test that runs the day one of them sells out.
    test.skip((await unstocked.count()) === 0, 'every size in the grid is stocked today');

    await unstocked.first().click({ force: true });
    await expect(unstocked.first().locator('input')).not.toBeChecked();
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
