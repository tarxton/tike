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
  searchPlaceholder: 'npr. air force, adidas, nike',
  brand: 'Brend',
  allBrands: 'Svi brendovi',

  results: 'rezultata',
  noResults: 'Nema patika u tom broju.',
  noResultsHint: 'Probaj drugi broj ili obriši filtere.',
  clearFilters: 'Obriši filtere',

  inShop: 'U prodavnici',
  goToShop: 'Idi u prodavnicu',
  availableSizes: 'Dostupno u brojevima',
  priceNote: 'Cijene se povremeno ažuriraju i mogu se razlikovati u prodavnici.',

  footerAbout: 'tike pretražuje ponudu BiH prodavnica. Ne prodajemo obuću.',
} as const;

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
