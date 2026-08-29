import robotsParser, { type Robot } from 'robots-parser';

/**
 * Polite HTTP client.
 *
 * Etiquette is enforced here rather than left to callers, so no crawl path can
 * accidentally skip it:
 *   - robots.txt is fetched once per host and every URL is checked against it
 *   - requests to a host are serialized, spaced by the larger of the shop's
 *     Crawl-delay and our own floor
 *   - the User-Agent identifies the crawler and links to a contact page
 *   - a 403 is fatal: the shop is refusing an identified crawler, and the answer is
 *     to stop and contact them, never to retry under another identity
 */

export const USER_AGENT =
  process.env.CRAWLER_USER_AGENT ?? 'tike-bot/0.1 (+https://github.com/tarxton/tike)';

export class ForbiddenError extends Error {}
export class RobotsDisallowedError extends Error {}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class PoliteFetcher {
  private robots: Robot | null = null;
  private lastRequestAt = 0;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly baseUrl: string,
    private readonly minDelayMs: number,
  ) {}

  /** Reads robots.txt and adopts its Crawl-delay when stricter than our floor. */
  async init(): Promise<{ crawlDelayMs: number; effectiveDelayMs: number }> {
    const robotsUrl = new URL('/robots.txt', this.baseUrl).href;
    const res = await fetch(robotsUrl, { headers: { 'user-agent': USER_AGENT } });
    const body = res.ok ? await res.text() : '';
    this.robots = robotsParser(robotsUrl, body);
    const crawlDelayMs = (this.robots.getCrawlDelay(USER_AGENT) ?? 0) * 1000;
    return { crawlDelayMs, effectiveDelayMs: Math.max(crawlDelayMs, this.minDelayMs) };
  }

  isAllowed(url: string): boolean {
    // Absent or unreadable robots.txt means no restrictions were published.
    return this.robots?.isAllowed(url, USER_AGENT) ?? true;
  }

  /**
   * Fetch one URL. Requests are serialized per instance, so concurrency against a
   * single shop is 1 by construction.
   */
  async get(url: string): Promise<string> {
    if (!this.isAllowed(url)) {
      throw new RobotsDisallowedError(`robots.txt disallows ${url}`);
    }
    const run = this.queue.then(async () => {
      const wait = this.lastRequestAt + this.minDelayMs - Date.now();
      if (wait > 0) await sleep(wait);
      this.lastRequestAt = Date.now();
      const res = await fetch(url, { headers: { 'user-agent': USER_AGENT } });
      if (res.status === 403) {
        throw new ForbiddenError(
          `403 from ${url}: the shop is refusing an identified crawler. Stop crawling it ` +
            `and contact the shop instead of working around the block.`,
        );
      }
      if (!res.ok) throw new Error(`${res.status} ${res.statusText} from ${url}`);
      return res.text();
    });
    this.queue = run.catch(() => undefined);
    return run;
  }
}
