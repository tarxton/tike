/**
 * A product page that could not be understood.
 *
 * Distinct from a transport failure on purpose: the crawl's circuit breaker counts these
 * to decide whether a shop's markup has changed underneath us, and a network blip must
 * not look like a broken selector.
 *
 * Shared by every adapter — it belongs to the crawling contract, not to one shop.
 */
export class ParseError extends Error {
  constructor(
    message: string,
    readonly url: string,
  ) {
    super(`${message} (${url})`);
    this.name = 'ParseError';
  }
}
