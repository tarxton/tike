import { expect, test } from '@playwright/test';
import {
  clickCountFor,
  clicksAfter,
  deleteClicks,
  latestClickId,
  offerCase,
  sizeCase,
} from './support/catalogue';
import { cards } from './support/page-helpers';

/**
 * The outclick, which is the business.
 *
 * Per-shop referral counts are the artifact a CPC conversation would rest on, so a click
 * that redirects without logging is a lost sale twice over - and it fails silently, since
 * the shopper still reaches the shop. §11 asks for the redirect and the matching row
 * together, and that is the only way to catch half of it working.
 *
 * Rows this suite writes are deleted again. The click log holds a couple of dozen rows,
 * all of them from testing, and §13 forbids describing them as traffic; a suite on every
 * pull request would quietly inflate the number it exists to protect.
 */

test.describe('outclick', () => {
  test('redirects to the shop and logs the click', async ({ request }, testInfo) => {
    // A different offer per project. Both projects run this at once, and "the redirect
    // wrote exactly one row" is unanswerable when the other browser is writing one for
    // the same offer at the same moment.
    const offer = await offerCase(testInfo.project.name === 'mobile' ? 1 : 0);
    test.skip(offer === null, 'no in-stock offer with a usable URL');
    const size = offer!.sizes[0];

    const before = await latestClickId();
    const href =
      size === undefined ? `/go/${offer!.offerId}` : `/go/${offer!.offerId}?velicina=${size}`;
    const response = await request.get(href, { maxRedirects: 0 });

    // 302, not 301: the destination is inventory, not a permanent move.
    expect(response.status()).toBe(302);
    const location = response.headers()['location'];
    expect(location).toBeTruthy();
    expect(new URL(location!).host).toBe(offer!.host);

    const logged = await clicksAfter(before, offer!.offerId);
    try {
      expect(logged, 'the redirect happened but nothing was logged').toHaveLength(1);
      expect(logged[0]!.shopId).toBe(offer!.shopId);
      // The size is recorded only when that shop could actually sell it - "people wanted
      // a 44 here" is worthless if the shop never had one.
      expect(logged[0]!.sizeEu).toBe(size ?? null);
    } finally {
      await deleteClicks(logged.map((c) => c.id));
    }
  });

  test('a nonsense offer id is refused without logging anything', async ({ request }) => {
    const bogus = [0, -1, 999999999];

    expect((await request.get('/go/0', { maxRedirects: 0 })).status()).toBe(400);
    expect((await request.get('/go/-1', { maxRedirects: 0 })).status()).toBe(400);
    expect((await request.get('/go/abc', { maxRedirects: 0 })).status()).toBe(400);
    expect((await request.get('/go/999999999', { maxRedirects: 0 })).status()).toBe(404);

    // Counted against those ids rather than against the table's high-water mark. The
    // first version compared max(id) before and after, which failed the moment the test
    // beside it logged a legitimate click - the suite racing itself, not a bug.
    expect(await clickCountFor(bogus), 'a refused outclick wrote a click row').toBe(0);
  });

  test('shop links are marked sponsored and open away from the site', async ({ page }) => {
    const { size } = await sizeCase();
    await page.goto(`/patike?velicina=${size}`);

    const first = cards(page).first();
    await first.locator('a').first().click();
    await expect(page).toHaveURL(/\/patika\//);

    const rows = page.getByTestId('shop-rows').locator('> li > a');
    const count = await rows.count();
    expect(count).toBeGreaterThan(0);

    for (let i = 0; i < count; i += 1) {
      const link = rows.nth(i);
      // Paid-adjacent outbound links have to disclose themselves, and robots.txt
      // disallows /go/ for the same reason: a crawler following one would log clicks
      // nobody made.
      const rel = await link.getAttribute('rel');
      expect(rel).toContain('nofollow');
      expect(rel).toContain('sponsored');
      expect(await link.getAttribute('target')).toBe('_blank');
      expect(await link.getAttribute('href')).toMatch(/^\/go\/\d+/);
    }
  });

  test('robots refuses the placeholder host and disallows the outclick on a real one', async ({
    request,
  }) => {
    const placeholder = await request.get('/robots.txt');
    expect(await placeholder.text()).toContain('Disallow: /');

    // A real domain serves the permissive rules. Asserted by asking as one, because the
    // rule that matters - /go/ never crawled - only exists on that branch.
    const real = await request.get('/robots.txt', { headers: { host: 'patike.ba' } });
    const body = await real.text();
    expect(body).toContain('Allow: /');
    expect(body).toContain('Disallow: /go/');
    expect(body).toContain('Disallow: /api/');
  });
});
