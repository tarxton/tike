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

/**
 * A product page that was read perfectly and has nothing to sell.
 *
 * Not a parse failure, and the difference is load-bearing. Djak lists every product it
 * has ever carried in its sitemap and 70% of them are sold out; counting those as
 * failures would put the shop permanently over the 5% circuit breaker and abort every
 * run, on a shop whose markup is fine.
 *
 * Throwing rather than returning an offer with no sizes, because a sold-out configurable
 * carries no usable price either — Magento zeroes them — and inventing one to satisfy the
 * schema would put a fabricated number in front of a shopper. The offer is simply not
 * seen this run, and the staleness rule already retires anything unseen across three
 * successful runs, keeping its price history and its inbound links.
 *
 * Only ever thrown once a page has positively identified itself as a product. A template
 * change takes that identification with it and raises `ParseError`, so the breaker still
 * sees real breakage.
 */
export class UnavailableError extends Error {
  constructor(
    message: string,
    readonly url: string,
  ) {
    super(`${message} (${url})`);
    this.name = 'UnavailableError';
  }
}
