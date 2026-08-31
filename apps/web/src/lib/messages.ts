/**
 * All user-facing copy.
 *
 * One unlabelled BCS variant, always the word "patike". Keeping strings here rather
 * than inline in JSX means adding hr/sr/en later is mechanical instead of a rewrite.
 */
export const t = {
  siteName: 'tike',
  tagline: 'Pronađi patike u svojoj veličini',
  intro: 'Odaberi svoj broj i vidi šta je stvarno na stanju u BiH prodavnicama.',

  chooseSize: 'Tvoj broj',
  chooseSizeShort: 'Broj',
  changeSize: 'Promijeni broj',
  allSizes: 'Svi brojevi',
  size: 'Veličina',
  showKids: 'Prikaži dječije brojeve',
  hideKids: 'Sakrij dječije brojeve',
  multiSizeHint: 'Možeš odabrati više brojeva odjednom.',
  discount: 'Popust',
  oldPrice: 'Stara cijena',

  search: 'Pretraži',
  searchPlaceholder: 'npr. air force, dunk, samba',
  resultsFor: 'Rezultati za',
  clearSearch: 'poništi pretragu',
  orBrowseBySize: 'ili samo odaberi svoj broj',
  brand: 'Brend',
  allBrands: 'Svi brendovi',

  results: 'rezultata',
  resultOne: 'rezultat',
  // Not "nema patika u tom broju" — the empty state also fires on a model query or a
  // brand facet, and blaming the size sends the user to fix the wrong filter.
  noResults: 'Nema rezultata za tu pretragu.',
  noResultsHint: 'Probaj drugi broj ili model.',
  clearFilters: 'Obriši filtere',

  previousPage: 'Prethodna',
  nextPage: 'Sljedeća',
  page: 'Stranica',
  emptyPage: 'Nema rezultata na toj stranici.',
  backToFirstPage: 'Nazad na prvu stranicu',

  inShop: 'U prodavnici',
  goToShop: 'Idi u prodavnicu',
  availableSizes: 'Dostupno u brojevima',
  priceNote: 'Cijene se povremeno ažuriraju i mogu se razlikovati u prodavnici.',

  footerAbout: 'tike pretražuje ponudu BiH prodavnica. Ne prodajemo obuću.',
} as const;

/**
 * BCS plural for "rezultat".
 *
 * The singular is used for any count ending in 1 except 11 — so 1 and 21 rezultat,
 * but 11 rezultata. Everything else takes the same genitive form.
 */
export function pluralResults(count: number): string {
  const lastTwo = count % 100;
  const last = count % 10;
  return last === 1 && lastTwo !== 11 ? t.resultOne : t.results;
}

/**
 * BCS plural for "prodavnica".
 *
 * 1 prodavnica, 2-4 prodavnice, 5+ prodavnica — with the usual 11-14 exception, which
 * takes the many-form despite ending in 1-4.
 */
export function pluralShops(count: number): string {
  const lastTwo = count % 100;
  const last = count % 10;
  if (last === 1 && lastTwo !== 11) return 'prodavnica';
  if (last >= 2 && last <= 4 && !(lastTwo >= 12 && lastTwo <= 14)) return 'prodavnice';
  return 'prodavnica';
}

/** "Prikazano 49-96 od 1.207." — which slice of the whole set is on screen. */
export function showingRange(from: number, to: number, total: number): string {
  return `Prikazano ${from}-${to} od ${formatCount(total)}.`;
}

/** Thousands separator, BiH style: 1.207 rather than 1,207. */
export function formatCount(n: number): string {
  return n.toLocaleString('de-DE');
}

/** "12990" -> "129,90 KM" */
export function formatPrice(minor: number, currency: string): string {
  const major = (minor / 100).toFixed(2).replace('.', ',');
  return currency === 'BAM' ? `${major} KM` : `${major} €`;
}

/** 44 -> "44", 44.5 -> "44½", 44.67 -> "44⅔" */
export function formatSize(size: number): string {
  const whole = Math.floor(size);
  const frac = Math.round((size - whole) * 100);
  if (frac === 0) return String(whole);
  if (frac === 50) return `${whole}½`;
  if (frac === 33) return `${whole}⅓`;
  if (frac === 67) return `${whole}⅔`;
  return size.toString().replace('.', ',');
}
