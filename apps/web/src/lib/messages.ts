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
  showAllSizes: 'Prikaži sve brojeve',
  showBaseSizes: 'Prikaži manje brojeva',
  sizeUnavailable: 'Nijedna prodavnica trenutno nema ovaj broj.',
  multiSizeHint: 'Možeš odabrati više brojeva odjednom.',
  discount: 'Popust',
  oldPrice: 'Stara cijena',

  search: 'Pretraži',
  searchPlaceholder: 'npr. air force, dunk, samba',
  resultsFor: 'Rezultati za',
  clearSearch: 'poništi pretragu',
  brand: 'Brend',
  allBrands: 'Svi brendovi',
  fewerBrands: 'Manje brendova',
  clearBrands: 'Poništi brendove',
  model: 'Model',
  clearModel: 'prikaži sve',

  onSale: 'Na sniženju',
  genderMen: 'Muške',
  genderWomen: 'Ženske',
  genderKids: 'Dječije',
  genderUnisex: 'Unisex',
  genderNote: 'Proizvodi bez oznake pola ostaju prikazani.',

  sortBy: 'Sortiraj',
  sortNewest: 'Najnovije',
  sortCheapest: 'Najjeftinije',
  sortDearest: 'Najskuplje',
  sortDiscount: 'Najveće sniženje',
  sortAlphabetical: 'Abecedno',
  sortRelevance: 'Najbolje pogađa',

  results: 'rezultata',
  resultOne: 'rezultat',
  // Not "nema patika u tom broju" — the empty state also fires on a model query or a
  // brand facet, and blaming the size sends the user to fix the wrong filter.
  noResults: 'Nema rezultata za tu pretragu.',
  noExactResults: 'Nema tačnih rezultata za',
  showingSimilar: 'Prikazujemo slične.',
  noResultsHint: 'Probaj drugi broj ili model.',
  clearFilters: 'Obriši filtere',

  previousPage: 'Prethodna',
  nextPage: 'Sljedeća',
  page: 'Stranica',
  emptyPage: 'Nema rezultata na toj stranici.',
  backToFirstPage: 'Nazad na prvu stranicu',

  backToSearch: 'Nazad na pretragu',
  otherColourways: 'Druge boje ovog modela',
  atShops: 'Cijene po prodavnicama',
  andMoreShops: 'i još',
  cheapest: 'najjeftinije',
  yourSize: 'tvoj broj',
  noSizeHere: 'nema tvoj broj',
  styleCode: 'Šifra modela',
  soldOut: 'Trenutno nema ni u jednoj prodavnici.',
  availableSizes: 'Dostupno u brojevima',
  priceNote: 'Cijene se povremeno ažuriraju i mogu se razlikovati u prodavnici.',
  lastUpdated: 'Zadnji put ažurirano',
  priceCheckedAt: 'Cijena provjerena',

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

/**
 * BCS plural for "boja", the colourway count in the model dropdown.
 *
 * Same shape as prodavnica: 1 boja, 2-4 boje, 5+ boja, and 11-14 take the many-form
 * despite their last digit.
 */
export function pluralColours(count: number): string {
  const lastTwo = count % 100;
  const last = count % 10;
  if (last === 1 && lastTwo !== 11) return 'boja';
  if (last >= 2 && last <= 4 && !(lastTwo >= 12 && lastTwo <= 14)) return 'boje';
  return 'boja';
}

/**
 * "Prikaži sve 4 boje" / "Prikaži svih 12 boja" — the link out of the colourway shelf.
 *
 * The determiner has to agree with the noun's case, which the count decides: 2-4 take
 * the accusative ("sve 4 boje"), 5 and up the genitive ("svih 12 boja").
 */
export function seeAllColourways(count: number): string {
  const noun = pluralColours(count);
  return `Prikaži ${noun === 'boje' ? 'sve' : 'svih'} ${formatCount(count)} ${noun}`;
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

/** The shops' own time, whatever the server's clock says: Workers run in UTC. */
const SHOP_TIME_ZONE = 'Europe/Sarajevo';

/** "2026-09-18" for the day an instant falls on in BiH, for comparing days. */
function localDay(at: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: SHOP_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at);
}

/**
 * When a price was checked, the way someone here would say it: "danas u 03:19",
 * "jučer u 17:01", "16. 9. u 17:25".
 *
 * In BiH time, not the server's. The site runs on Workers in UTC, so a crawl at 01:30 in
 * Sarajevo in summer happened at 23:30 the day before by the server's clock — printed
 * naively it would read as "jučer" to someone who watched it run that morning.
 *
 * `now` is a parameter so the words can be tested; the page passes the request time.
 */
export function formatCheckedAt(checkedAt: Date, now: Date): string {
  const time = new Intl.DateTimeFormat('hr-HR', {
    timeZone: SHOP_TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(checkedAt);

  const day = localDay(checkedAt);
  if (day === localDay(now)) return `danas u ${time}`;
  if (day === localDay(new Date(now.getTime() - 24 * 60 * 60 * 1000))) return `jučer u ${time}`;

  const [, month, date] = day.split('-').map(Number);
  return `${date}. ${month}. u ${time}`;
}
