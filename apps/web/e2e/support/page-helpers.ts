import { expect, type Locator, type Page } from '@playwright/test';
import { formatSize } from '../../src/lib/messages';

/**
 * Reading the site the way a shopper does.
 *
 * Selectors go through roles and visible text wherever the DOM offers them, and fall back
 * to a structural locator where it does not. Nothing here matches on a Tailwind class:
 * those change whenever the design does, and a test that breaks on a colour tells nobody
 * anything.
 */

/**
 * How a size reads on screen: 44, 44½, 44⅔.
 *
 * The site's own formatter rather than a copy of it. A test comparing "44.67" against the
 * rendered "44⅔" fails while the page is perfectly correct, and the first version of the
 * clipped-chip test did exactly that.
 */
export const sizeLabel = formatSize;

/** The result grid. One `<li>` per card, whether the card is one shop or five. */
export function cards(page: Page): Locator {
  return page.locator('#rezultati > li');
}

/** The size chips a card claims to have in stock, as displayed. */
export async function chipsOn(card: Locator): Promise<string[]> {
  return card.locator('ul li').allInnerTexts();
}

/**
 * "129,90 KM" -> 12990.
 *
 * Minor units, because that is how every price in this project is stored and compared;
 * parsing to a float would reintroduce exactly the rounding the schema avoids.
 */
export function parsePrice(text: string): number | null {
  const match = /(\d{1,3}(?:\.\d{3})*|\d+),(\d{2})\s*KM/.exec(text);
  if (!match) return null;
  const major = Number(match[1]!.replace(/\./g, ''));
  return major * 100 + Number(match[2]);
}

/** Every price on the page, in the order it appears. */
export async function pricesIn(scope: Locator): Promise<number[]> {
  const text = await scope.allInnerTexts();
  return text.map(parsePrice).filter((p): p is number => p !== null);
}

/**
 * Type into the search box and wait for the suggestions.
 *
 * Typing is retried until the dropdown appears, because the box is a React component that
 * only listens once it has hydrated. `page.goto` resolves on the load event, which is
 * earlier than that: keystrokes landing in between sit in the DOM while React's state
 * stays empty, so `typed.current` never flips, no request is ever made, and the dropdown
 * simply never comes. Under six parallel workers that window is wide enough to hit - it
 * failed only in the mobile project, only when the whole suite ran at once.
 *
 * Which is a real property of the page, not only of the test: someone typing on a slow
 * phone before the bundle lands gets no suggestions. What they do get is the plain form
 * underneath, and pressing Enter still searches - the degradation the component is built
 * around, and a separate test asserts it.
 *
 * Keystrokes rather than `fill`, so the debounce and the abort logic see what a person
 * would produce.
 */
export async function suggestFor(page: Page, prefix: string): Promise<Locator> {
  const box = page.getByRole('combobox', { name: 'Pretraži' });
  const list = page.getByRole('listbox');

  await expect
    .poll(
      async () => {
        await box.fill('');
        await box.pressSequentially(prefix, { delay: 30 });
        // Long enough for the 150ms debounce plus one round trip to Neon.
        await page.waitForTimeout(1_200);
        return list.count();
      },
      { timeout: 30_000, message: 'the suggestion list never appeared' },
    )
    .toBeGreaterThan(0);

  return list;
}

/** The size the page header says is filtered, or null when it claims none. */
export async function headerSizes(page: Page): Promise<string | null> {
  const header = page.locator('header p').first();
  const text = await header.innerText();
  const match = /Broj\s+(.+)$/.exec(text.replace(/\s+/g, ' ').trim());
  return match ? match[1]!.trim() : null;
}

/** How many results the page claims, read from its own count. */
export async function resultCount(page: Page): Promise<number> {
  const text = await page.locator('header strong').first().innerText();
  return Number(text.replace(/\./g, ''));
}
