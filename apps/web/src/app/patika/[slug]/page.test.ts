import { describe, expect, it } from 'vitest';
import { backHref, goHref } from './page';

describe('goHref', () => {
  it('carries the size when this shop stocks it', () => {
    expect(goHref(12, [44], [42, 43, 44])).toBe('/go/12?velicina=44');
  });

  it('omits the size when this shop does not stock it', () => {
    // Office Shoes is the cheapest New Balance 327 but only has a 42. Logging "someone
    // wanted a 44" against them would be a number they could not have acted on.
    expect(goHref(12, [44], [42])).toBe('/go/12');
  });

  it('picks the first selected size the shop actually has', () => {
    expect(goHref(12, [45, 44], [44])).toBe('/go/12?velicina=44');
  });

  it('carries nothing when no size is selected', () => {
    expect(goHref(12, [], [42, 43, 44])).toBe('/go/12');
  });
});

describe('backHref', () => {
  it('returns to the results page the visitor came from, filters intact', () => {
    expect(backHref('http://localhost:3000/patike?q=nike&velicina=44&akcija=1')).toBe(
      '/patike?q=nike&velicina=44&akcija=1',
    );
  });

  it('falls back to a plain search when there is no referer', () => {
    expect(backHref(null)).toBe('/patike');
  });

  it('discards the host, so an external referer cannot redirect off-site', () => {
    expect(backHref('https://evil.example.com/patike?q=x')).toBe('/patike?q=x');
  });

  it('ignores a referer that is not a results page', () => {
    // Product to product, or in from the home page: "back" should not send someone to a
    // page they have never seen.
    expect(backHref('http://localhost:3000/patika/nesto-drugo')).toBe('/patike');
    expect(backHref('http://localhost:3000/')).toBe('/patike');
  });

  it('survives a malformed referer', () => {
    expect(backHref('not a url')).toBe('/patike');
  });
});
