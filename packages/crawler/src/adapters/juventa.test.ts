import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ParseError } from '../errors';
import {
  extractGender,
  extractModel,
  juventaListingUrl,
  juventaProductApiUrl,
  parseJuventa,
  parseJuventaListing,
} from './juventa';

/**
 * Fixtures are the shop's own API responses reduced to the keys the parser reads
 * (`sanitizeJuventaFixture`), captured 2026-09-21.
 */
const fixture = (name: string) =>
  readFileSync(join(import.meta.dirname, '../../fixtures/juventa', name), 'utf8');

const BASE = 'https://juventasport.com';
const api = (id: string) => juventaProductApiUrl(BASE, id);

describe('extractModel', () => {
  it.each([
    ['Muške patike za trčanje GALAXY 8', 'GALAXY 8'],
    ['Ženske patike RUN 70S 2.0', 'RUN 70S 2.0'],
    [
      'Ženske patike performance running CLOUDSURFER TRAIL 2 WATERPROOF',
      'CLOUDSURFER TRAIL 2 WATERPROOF',
    ],
    ['Muške patike performance outdor CLOUDHORIZON 2 WATERPROOF', 'CLOUDHORIZON 2 WATERPROOF'],
    ['Muške košarkaške patike LEBRON WITNESS IX', 'LEBRON WITNESS IX'],
    ['Dječije patike HEART LIGHTS - BUBBLE LOVE', 'HEART LIGHTS - BUBBLE LOVE'],
    ['Muške patike P-6000', 'P-6000'],
  ])('%s -> %s', (name, model) => {
    expect(extractModel(name)).toBe(model);
  });

  it('drops the shop’s own INDOOR and TURF type label, which the IC or TF suffix repeats', () => {
    expect(extractModel('Muške patike INDOOR TIEMPO REACTGATO IC')).toBe('TIEMPO REACTGATO IC');
    expect(extractModel('Muške patike TURF SUPERFLY 11 CLUB TF')).toBe('SUPERFLY 11 CLUB TF');
    expect(extractModel('Dječije patike TURF JR VAPOR 17 CLUB')).toBe('JR VAPOR 17 CLUB');
  });

  it('survives the shop’s typos', () => {
    expect(extractModel('Muške patikeTURF PHANTOM 6 LOW CLUB TF')).toBe('PHANTOM 6 LOW CLUB TF');
    expect(extractModel('Muške patikeE TURF PREDATOR CLUB FT')).toBe('PREDATOR CLUB FT');
    expect(extractModel('Dječije patike AIR MAX FIRE)')).toBe('AIR MAX FIRE');
  });

  it('falls back to everything after the category word when nothing is in capitals', () => {
    expect(extractModel('Muške patike Field Jupiter Engineered')).toBe('Field Jupiter Engineered');
  });
});

describe('extractGender', () => {
  // Every spelling below is a real name in the shop's catalogue, surveyed 2026-09-21.
  it.each([
    ['Muške patike P-6000', 'men'],
    ['M uške patike COURT VISION LOW', 'men'],
    ['Muzške patike BREAKNET 3.0', 'men'],
    ['uške patike za trčanje GALAXY 8', 'men'],
    ['Muška patika za trčanje GALAXY 8', 'men'],
    ['Muške košarkaške patike LEBRON WITNESS IX', 'men'],
    ['Muške performance outdoor patike CLOUD 6', 'men'],
    ['Ženske patike RUN 70S 2.0', 'women'],
    ['Ženska patike BARREDA', 'women'],
    ['Žesnke patike BARREDA', 'women'],
    ['Žemske patike BARREDA', 'women'],
    ['Zženske patike za rukomet COURTSTABIL', 'women'],
    ['Ženskje patike BARREDA', 'women'],
    ['Dječije patike TENSAUR SPORT 3.0', 'kids'],
    ['Dječija patika VL COURT 3.0', 'kids'],
    ['Djječije patike VL COURT 3.0', 'kids'],
    ['Djećije patike VL COURT 3.0', 'kids'],
    ['ječije patike VL COURT 3.0', 'kids'],
    ['Dječije kopačke F50 HYPERFAST CLUB TF', 'kids'],
    ['Unisex patike za odbojku WAVE MOMENTUM PRO MID', 'unisex'],
    ['Patike za odbojku WAVE MOMENTUM', null],
  ])('%s -> %s', (name, gender) => {
    expect(extractGender(name)).toBe(gender);
  });
});

describe('parseJuventaListing', () => {
  it('reads the ids and knows the last page from the shop’s own total', () => {
    const body = JSON.stringify({
      products: { page: 3, per_page: 20, total: 55, data: [{ id: 101 }, { id: '102' }] },
    });
    expect(parseJuventaListing(body, 3)).toEqual({ ids: ['101', '102'], total: 55, last: true });
    expect(parseJuventaListing(body, 2).last).toBe(false);
  });

  it('treats an empty page as the end', () => {
    const body = JSON.stringify({ products: { per_page: 20, total: 999, data: [] } });
    expect(parseJuventaListing(body, 9).last).toBe(true);
  });

  it('refuses a response that is not the listing', () => {
    expect(() => parseJuventaListing('<!doctype html>', 1)).toThrow();
    expect(() => parseJuventaListing('{"error":"x"}', 1)).toThrow();
  });

  it('builds the listing URL the storefront itself requests', () => {
    expect(juventaListingUrl(BASE, ['9000', '8980'], 2)).toBe(
      'https://juventasport.com/getItems?type_id%5B%5D=9000&type_id%5B%5D=8980&page=2',
    );
  });
});

describe('parseJuventa', () => {
  it('reads identity, price and the page a shopper opens', () => {
    const offer = parseJuventa(fixture('01-galaxy-8.json'), api('428195'));
    expect(offer.externalId).toBe('428195');
    // The outclick lands on the storefront, not on the API the data came from.
    expect(offer.url).toBe('https://juventasport.com/product/428195');
    expect(offer.brand).toBe('ADIDAS');
    expect(offer.sku).toBe('IH9808');
    expect(offer.title).toBe('ADIDAS GALAXY 8');
    expect(offer.gender).toBe('men');
    expect(offer.priceRaw).toBe('108.00');
    expect(offer.originalPriceRaw).toBeNull();
    expect(offer.currency).toBe('BAM');
  });

  it('reads a markdown and the price it was reduced from', () => {
    const offer = parseJuventa(fixture('02-air-max-90-sale.json'), api('405683'));
    expect(offer.priceRaw).toBe('244.00');
    expect(offer.originalPriceRaw).toBe('325.00');
  });

  it('keeps sold-out sizes, marked as sold out', () => {
    // They are what lets tike say "this shop has it, just not in your size".
    const offer = parseJuventa(fixture('02-air-max-90-sale.json'), api('405683'));
    expect(offer.sizes).toHaveLength(10);
    expect(offer.sizes.find((s) => s.euRaw === '42.5')?.inStock).toBe(false);
    expect(offer.sizes.find((s) => s.euRaw === '44')?.inStock).toBe(true);
  });

  it('reads the EU size, not the shop’s other label, which changes scale by brand', () => {
    // US for Nike ("8.5"), UK with "-" for a half for adidas ("7-"), EU for Skechers.
    expect(
      parseJuventa(fixture('02-air-max-90-sale.json'), api('405683')).sizes.map((s) => s.euRaw),
    ).toEqual(['42', '42.5', '43', '44', '44.5', '45', '45.5', '46', '47', '47.5']);
    expect(
      parseJuventa(fixture('01-galaxy-8.json'), api('428195')).sizes.map((s) => s.euRaw),
    ).toEqual(['41', '42', '42.5', '43', '44', '45', '47', '48']);
  });

  it('puts the shop’s main picture first, as absolute URLs', () => {
    const offer = parseJuventa(fixture('02-air-max-90-sale.json'), api('405683'));
    expect(offer.imageUrl).toBe(
      'https://juventasport.com/storage/products/Bro02bsgUbxLavs3gHfSjjzVc7Yp3jyP3Us9L2WF.webp',
    );
    expect(offer.imageUrls).toHaveLength(4);
    expect(new Set(offer.imageUrls).size).toBe(4);
  });

  it('reads children’s, women’s and unisex shoes as such', () => {
    expect(parseJuventa(fixture('03-kids-heart-lights.json'), api('427918')).gender).toBe('kids');
    expect(parseJuventa(fixture('07-women-brmd-sale.json'), api('403060')).gender).toBe('women');
    expect(parseJuventa(fixture('04-nb-530-unisex.json'), api('372251')).gender).toBe('unisex');
  });

  it('survives a model glued to the category word', () => {
    const offer = parseJuventa(fixture('06-typo-uno-rugged.json'), api('360338'));
    expect(offer.title).toBe('SKECHERS UNO RUGGED - WAT-AIR-PROOF OLV');
  });

  it('names a shoe the shop gives no model by its style code', () => {
    // "Muške patike za trčanje" is the whole name. Without the code, thirteen of these
    // would sit on the grid as thirteen identical "Za trčanje" cards.
    const offer = parseJuventa(fixture('05-anta-no-model.json'), api('353305'));
    expect(offer.title).toBe('ANTA 812515523-1');
  });

  it('never returns an offer with no sizes', () => {
    const product = JSON.parse(fixture('01-galaxy-8.json')) as Record<string, unknown>;
    expect(() => parseJuventa(JSON.stringify({ ...product, options: [] }), api('1'))).toThrow(
      ParseError,
    );
  });

  it('rejects anything that is not a product', () => {
    expect(() => parseJuventa('<!doctype html><div id="app"></div>', api('1'))).toThrow(ParseError);
    expect(() => parseJuventa('{}', api('1'))).toThrow(ParseError);
  });
});
