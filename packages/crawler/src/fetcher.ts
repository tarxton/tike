import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import robotsParser, { type Robot } from 'robots-parser';
import { FetchError } from './errors';

const execFileAsync = promisify(execFile);

/** Which HTTP client performs the request. See `Transport` in the crawl config. */
export type Transport = 'fetch' | 'curl';

/** Marks the end of a curl body so the status code can be read off the same stream. */
const STATUS_MARKER = '\n__tike_status__';

/**
 * Statuses worth asking again about: the shop is overloaded or briefly broken, not
 * refusing. 403 is deliberately absent — that is an answer, not a hiccup — and so is 404,
 * where asking twice changes nothing.
 *
 * Every 5xx rather than a list of them. A hand-picked set missed Cloudflare's own 520-527
 * range and a 521 killed a full crawl on the very next run; the rule is that a server
 * error is the server's problem and transient by definition, not that certain numbers are
 * special.
 */
function isRetriable(status: number): boolean {
  return status >= 500 || status === 408 || status === 425 || status === 429;
}
const MAX_RETRIES = 3;
/** Doubles per attempt: 2s, 4s, 8s. Slower than the crawl delay, on purpose. */
const RETRY_BASE_MS = 2000;

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
    /**
     * Node's own client by default.
     *
     * `curl` exists for one shop whose WAF rejects Node's TLS fingerprint despite its
     * operator having agreed to the crawl in writing. It changes which client sends the
     * request and nothing else — the User-Agent still says tike-bot, robots.txt is still
     * obeyed, and a 403 from curl is still treated as a refusal and still fatal.
     */
    private readonly transport: Transport = 'fetch',
  ) {}

  /** Reads robots.txt and adopts its Crawl-delay when stricter than our floor. */
  async init(): Promise<{ crawlDelayMs: number; effectiveDelayMs: number }> {
    const robotsUrl = new URL('/robots.txt', this.baseUrl).href;
    // Through the shop's own transport: a WAF that rejects our client would otherwise
    // block robots.txt too, and an unreadable robots.txt reads as "no rules published" —
    // the crawler would proceed with fewer constraints precisely where it has less
    // information, which is exactly backwards.
    const headers = { 'user-agent': USER_AGENT };
    const { status, body: fetched } =
      this.transport === 'curl'
        ? await this.getViaCurl(robotsUrl, headers)
        : await this.getViaFetch(robotsUrl, headers);
    const body = status >= 200 && status < 300 ? fetched : '';
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
  async get(url: string, extraHeaders: Record<string, string> = {}): Promise<string> {
    if (!this.isAllowed(url)) {
      throw new RobotsDisallowedError(`robots.txt disallows ${url}`);
    }
    const run = this.queue.then(async () => {
      // The User-Agent is set last so no caller can quietly replace our identity with a
      // browser's; extra headers exist for endpoints that need one, not for disguise.
      const headers = { ...extraHeaders, 'user-agent': USER_AGENT };

      for (let attempt = 0; ; attempt += 1) {
        const wait = this.lastRequestAt + this.minDelayMs - Date.now();
        if (wait > 0) await sleep(wait);
        this.lastRequestAt = Date.now();

        const { status, body } =
          this.transport === 'curl'
            ? await this.getViaCurl(url, headers)
            : await this.getViaFetch(url, headers);

        if (status === 403) {
          throw new ForbiddenError(
            `403 from ${url}: the shop is refusing an identified crawler. Stop crawling it ` +
              `and contact the shop instead of working around the block.`,
          );
        }
        if (status >= 200 && status < 300) return body;

        // A shop having a bad minute is not a shop refusing us, and it is not a markup
        // change either. One 502 used to abort a 70-minute crawl outright, losing every
        // page still unvisited; backing off and asking again is both politer and the only
        // way a full pass survives a busy hour.
        if (isRetriable(status) && attempt < MAX_RETRIES) {
          const backoff = RETRY_BASE_MS * 2 ** attempt;
          console.warn(`  ${status} from ${url} — retrying in ${backoff}ms`);
          await sleep(backoff);
          continue;
        }
        throw new FetchError(`${status} from ${url}`, status, url);
      }
    });
    this.queue = run.catch(() => undefined);
    return run;
  }

  /**
   * The same request, for a file rather than a page.
   *
   * Shares every guarantee `get` makes — robots, spacing, transport, retries — because an
   * image is another request to the same shop's servers and they do not care that it is
   * binary. Djak proved the transport part matters here too: its CDN answered some image
   * requests from Node with a 403 and every one from curl with a 200.
   */
  async getBinary(url: string): Promise<Uint8Array> {
    if (!this.isAllowed(url)) {
      throw new RobotsDisallowedError(`robots.txt disallows ${url}`);
    }
    const run = this.queue.then(async () => {
      const headers = { 'user-agent': USER_AGENT };
      for (let attempt = 0; ; attempt += 1) {
        const wait = this.lastRequestAt + this.minDelayMs - Date.now();
        if (wait > 0) await sleep(wait);
        this.lastRequestAt = Date.now();

        const { status, body } =
          this.transport === 'curl'
            ? await this.getBinaryViaCurl(url, headers)
            : await this.getBinaryViaFetch(url, headers);

        if (status === 403) throw new ForbiddenError(`403 from ${url}`);
        if (status >= 200 && status < 300) return body;
        if (isRetriable(status) && attempt < MAX_RETRIES) {
          await sleep(RETRY_BASE_MS * 2 ** attempt);
          continue;
        }
        throw new FetchError(`${status} from ${url}`, status, url);
      }
    });
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async getBinaryViaFetch(
    url: string,
    headers: Record<string, string>,
  ): Promise<{ status: number; body: Uint8Array }> {
    const res = await fetch(url, { headers });
    return { status: res.status, body: new Uint8Array(await res.arrayBuffer()) };
  }

  /**
   * curl, with the body kept as bytes.
   *
   * The status marker is searched for in the buffer rather than in a decoded string:
   * decoding a JPEG as UTF-8 to find a delimiter would corrupt the very bytes being
   * fetched.
   */
  private async getBinaryViaCurl(
    url: string,
    headers: Record<string, string>,
  ): Promise<{ status: number; body: Uint8Array }> {
    const headerArgs = Object.entries(headers).flatMap(([k, v]) => ['--header', `${k}: ${v}`]);
    const { stdout } = await execFileAsync(
      'curl',
      [
        '--silent',
        '--show-error',
        '--location',
        '--max-time',
        '45',
        ...headerArgs,
        '--write-out',
        `${STATUS_MARKER}%{http_code}`,
        url,
      ],
      { maxBuffer: 64 * 1024 * 1024, encoding: 'buffer' },
    );

    const buf = stdout as unknown as Buffer;
    const marker = Buffer.from(STATUS_MARKER, 'utf-8');
    const at = buf.lastIndexOf(marker);
    if (at === -1) throw new Error(`curl returned no status for ${url}`);
    const status = Number(
      buf
        .subarray(at + marker.length)
        .toString('utf-8')
        .trim(),
    );
    if (!Number.isFinite(status)) throw new Error(`curl returned an unreadable status for ${url}`);
    return { status, body: new Uint8Array(buf.subarray(0, at)) };
  }

  private async getViaFetch(
    url: string,
    headers: Record<string, string>,
  ): Promise<{ status: number; body: string }> {
    const res = await fetch(url, { headers });
    return { status: res.status, body: await res.text() };
  }

  /**
   * The same request, sent by curl.
   *
   * The status code is appended to the body behind a marker rather than read from headers,
   * because curl writes the body to stdout and there is no second channel to read a status
   * from without parsing a header dump.
   *
   * `execFile`, not a shell: the URL comes from a shop's sitemap, and handing untrusted
   * text to a shell would make a crawl target able to run commands here.
   */
  private async getViaCurl(
    url: string,
    headers: Record<string, string>,
  ): Promise<{ status: number; body: string }> {
    const headerArgs = Object.entries(headers).flatMap(([k, v]) => ['--header', `${k}: ${v}`]);
    const { stdout } = await execFileAsync(
      'curl',
      [
        '--silent',
        '--show-error',
        '--location',
        '--compressed',
        '--max-time',
        '45',
        ...headerArgs,
        '--write-out',
        `${STATUS_MARKER}%{http_code}`,
        url,
      ],
      { maxBuffer: 64 * 1024 * 1024, encoding: 'utf-8' },
    );

    const at = stdout.lastIndexOf(STATUS_MARKER);
    if (at === -1) throw new Error(`curl returned no status for ${url}`);
    const status = Number(stdout.slice(at + STATUS_MARKER.length).trim());
    if (!Number.isFinite(status)) throw new Error(`curl returned an unreadable status for ${url}`);
    return { status, body: stdout.slice(0, at) };
  }
}
