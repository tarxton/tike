import { describe, expect, it } from 'vitest';
import { goHref } from './page';

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
