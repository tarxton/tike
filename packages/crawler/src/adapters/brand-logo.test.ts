import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { brandLogoUrl } from './brand-logo';
import { juventaProductApiUrl, parseJuventa } from './juventa';
import { parseMagento2 } from './magento2';
import { parseNbshop } from './nbshop';
import { parseOfficeshoes } from './officeshoes';

/**
 * Each shop shows the brand's logo somewhere different, and one fills the slot with a
 * placeholder. Fixtures captured 2026-09-22, reduced by the sanitizer like every other.
 */
const fixture = (name: string) =>
  readFileSync(join(import.meta.dirname, '../../fixtures/brand-logos', name), 'utf8');

describe('brand logos, per shop', () => {
  it('reads Sport Vision’s logo from the product header', () => {
    const offer = parseNbshop(
      fixture('sportvision.html'),
      'https://www.sportvision.ba/patike/53220882-asics-japan-s-st',
    );
    expect(offer.brandLogoUrl).toBe(
      'https://www.sportvision.ba/files/images/2024/7/5/Asics-logo-new.png',
    );
  });

  it('refuses Sport Reality’s “no image” picture as a brand’s logo', () => {
    const offer = parseNbshop(
      fixture('sportreality-placeholder.html'),
      'https://www.sportreality.ba/patike/111073-bds-frozen',
    );
    expect(offer.brand).toBe('BDS');
    expect(offer.brandLogoUrl).toBeNull();
  });

  it('reads Office Shoes’ brand logo link', () => {
    const offer = parseOfficeshoes(
      fixture('officeshoes.html'),
      'https://www.officeshoes.ba/cipele-tommy-hilfiger-plitke-patike-basket-core-lite-16a4/75052',
    );
    expect(offer.brandLogoUrl).toBe(
      'https://cdn.officeshoes.ws/product_images/brandlogos/tommy_hilfiger_l.jpg',
    );
  });

  it('reads Đak’s brand block, and only when it names this brand', () => {
    const url = 'https://www.djaksport.ba/hummel-patike-za-zene-218420-9203';
    expect(parseMagento2(fixture('djak.html'), url).brandLogoUrl).toBe(
      'https://www.djaksport.ba/media/amasty/shopby/option_images/slider/hummel.svg',
    );
    const otherBrand = fixture('djak.html').replace('alt="HUMMEL"', 'alt="PUMA"');
    expect(parseMagento2(otherBrand, url).brandLogoUrl).toBeNull();
  });

  it('reaches past Đak’s 120x45 thumbnail to the upload it was cut from', () => {
    const resized = fixture('djak.html').replace(
      'https://www.djaksport.ba/media/amasty/shopby/option_images/slider/hummel.svg',
      'https://www.djaksport.ba/media/images/cache/amasty/shopby/option_images/slider/resized/120x45/hummel.png',
    );
    expect(
      parseMagento2(resized, 'https://www.djaksport.ba/hummel-patike-za-zene-218420-9203')
        .brandLogoUrl,
    ).toBe('https://www.djaksport.ba/media/amasty/shopby/option_images/slider/hummel.png');
  });

  it('reads Juventa’s from the API, made absolute', () => {
    const json = readFileSync(
      join(import.meta.dirname, '../../fixtures/juventa/02-air-max-90-sale.json'),
      'utf8',
    );
    const offer = parseJuventa(json, juventaProductApiUrl('https://juventasport.com', '405683'));
    expect(offer.brandLogoUrl).toBe(
      'https://juventasport.com/storage/brands/ryJrSEt9toAF9sPkMIij88gmsAbJd0Q2nN6GQEwM.png',
    );
  });
});

describe('brandLogoUrl', () => {
  it('makes a relative address absolute', () => {
    expect(brandLogoUrl('/files/a.png', 'https://shop.test/p/1')).toBe(
      'https://shop.test/files/a.png',
    );
  });

  it.each([
    [null],
    [''],
    ['data:image/gif;base64,R0lGOD'],
    ['https://www.sportreality.ba/files/images/logo/sr_no_image.jpg'],
    ['/img/placeholder.png'],
  ])('is null for %s', (src) => {
    expect(brandLogoUrl(src, 'https://shop.test/p/1')).toBeNull();
  });
});
