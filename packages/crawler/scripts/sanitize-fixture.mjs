/**
 * Reduce a captured page to the parts the parser actually reads.
 *
 * Shop pages carry third-party credentials in inline scripts — Google Maps keys,
 * Flowplayer JWTs, a Facebook access token, values literally named ClientSecret.
 * Redacting them one pattern at a time is a losing game: every new shop brings new
 * scripts, and a missed one lands in a public repository.
 *
 * So fixtures keep only what the adapter parses:
 *   - schema.org JSON-LD (identity, price)
 *   - the product size list (per-size availability)
 *   - breadcrumbs and title (gender detection)
 *
 * Everything else — scripts, styles, iframes, inline event handlers — is dropped.
 * That removes the entire class of problem, and shrinks fixtures by ~99%.
 */

import * as cheerio from 'cheerio';

/**
 * Office Shoes puts identity in schema.org microdata rather than JSON-LD, so the subset
 * worth keeping is the Product scope's own attribute-bearing elements plus the size list.
 * The whole scope is far too much: it contains recommendation carousels with their own
 * prices, which is precisely what a fixture must not teach the parser to accept.
 */
export function sanitizeOfficeshoesFixture(html) {
  const $ = cheerio.load(html);
  const scope = $('[itemtype="http://schema.org/Product"]').first();

  const meta = scope
    .find('meta[itemprop], link[itemprop]')
    .toArray()
    .map((el) => $.html(el))
    .join('\n');
  const heading = scope.find('h1').first().toString() ?? '';
  const price = scope.find('.product-price').first().toString() ?? '';

  // `rel` on a size is the shop's stock count for it. tike stores availability, not
  // quantities, so republishing the numbers in a public repository would be handing out
  // a competitor's inventory for no reason. The parser never reads it.
  const sizeList = scope.find('ul.sizes').first();
  sizeList.find('li[rel]').removeAttr('rel');
  const sizes = sizeList.toString() ?? '';

  return [
    '<!doctype html>',
    '<html lang="bs">',
    '<head>',
    `<title>${$('title').first().text()}</title>`,
    '</head>',
    '<body>',
    '<section class="productpage" itemscope itemtype="http://schema.org/Product">',
    meta,
    heading,
    price,
    sizes,
    '</section>',
    '</body>',
    '</html>',
    '',
  ].join('\n');
}

export function sanitizeFixture(html) {
  const $ = cheerio.load(html);

  // Keep JSON-LD; drop every other script, and all styles and embeds.
  $('script').each((_, el) => {
    if ($(el).attr('type') !== 'application/ld+json') $(el).remove();
  });
  $('style, link[rel="stylesheet"], iframe, noscript, svg, source, picture').remove();

  // Inline handlers and data blobs can carry tokens too.
  $('*').each((_, el) => {
    const attribs = el.attribs ?? {};
    for (const name of Object.keys(attribs)) {
      if (name.startsWith('on')) $(el).removeAttr(name);
    }
  });

  const ld = $('script[type="application/ld+json"]')
    .toArray()
    .map((el) => `<script type="application/ld+json">${$(el).contents().text()}</script>`)
    .join('\n');

  const title = $('title').first().text();
  const breadcrumb = $('.breadcrumb').first().toString() ?? '';
  const sizes = $('.product-attributes-wrapper').first().toString() ?? '';
  const heading = $('h1').first().toString() ?? '';

  return [
    '<!doctype html>',
    '<html lang="bs">',
    '<head>',
    `<title>${title}</title>`,
    ld,
    '</head>',
    '<body>',
    heading,
    breadcrumb,
    sizes,
    '</body>',
    '</html>',
    '',
  ].join('\n');
}

/**
 * Magento 2 keeps identity, price and sizes inside a script, which is exactly what this
 * module otherwise throws away — so the block is **rebuilt** rather than copied.
 *
 * Only the four keys the parser reads survive: productId, the size attribute, prices, and
 * one gallery image URL. Copying the original would carry along whatever else Magento put
 * in its 42 init blocks, and rebuilding makes it impossible for a credential or a stock
 * quantity to ride into a public repository unnoticed.
 */
export function sanitizeMagento2Fixture(html) {
  const $ = cheerio.load(html);
  const heading = $('h1').first().toString() ?? '';

  let config = null;
  for (const el of $('script[type="text/x-magento-init"]').toArray()) {
    const raw = $(el).contents().text();
    if (!raw.includes('jsonConfig')) continue;
    try {
      const data = JSON.parse(raw);
      for (const modules of Object.values(data ?? {})) {
        for (const cfg of Object.values(modules ?? {})) {
          if (cfg?.jsonConfig) config = cfg.jsonConfig;
        }
      }
    } catch {
      // A block we cannot read is a block we cannot vouch for; drop it.
    }
    break;
  }

  const attributes = config?.attributes ?? [];
  const list = Array.isArray(attributes) ? attributes : Object.values(attributes);
  const size = list.find((a) => a?.code?.toLowerCase() === 'size');

  const minimal = {
    productId: config?.productId ?? '',
    // Option ids and child product ids are Magento's internal keys, not something the
    // parser reads, so only the labels are kept.
    attributes: size
      ? [{ code: 'size', options: (size.options ?? []).map((o) => ({ label: o.label })) }]
      : [],
    prices: config?.prices ?? {},
  };

  const swatch = {
    '[data-role=swatch-options]': {
      'Magento_Swatches/js/swatch-renderer': { jsonConfig: minimal },
    },
  };

  const gallery = html.match(
    /"mage\/gallery\/gallery"\s*:\s*\{[\s\S]*?"data"\s*:\s*(\[[\s\S]*?\])\s*,/,
  );
  let galleryBlock = '';
  if (gallery?.[1]) {
    try {
      const first = JSON.parse(gallery[1]).find((d) => d.img)?.img;
      if (first) {
        galleryBlock =
          '<script type="text/x-magento-init">' +
          JSON.stringify({
            '[data-gallery-role=gallery-placeholder]': {
              'mage/gallery/gallery': { data: [{ img: first }] },
            },
          }) +
          '</script>';
      }
    } catch {
      // No image is survivable; the parser returns null for it.
    }
  }

  // The shop's own brand and audience attributes, rebuilt from the two values the parser
  // reads. The block they live in on the real page is a size-chart widget with a hundred
  // lines of jQuery around them; copying it would carry all of that into the repository
  // for two strings.
  const shopAttributes = ['productBrand', 'productGender']
    .map((name) => {
      const found = html.match(new RegExp(`var\\s+${name}\\s*=\\s*"([^"]*)"`));
      return found ? `var ${name} = ${JSON.stringify(found[1])};` : null;
    })
    .filter(Boolean)
    .join('\n');

  return [
    heading,
    shopAttributes ? `<script>\n${shopAttributes}\n</script>` : '',
    `<script type="text/x-magento-init">${JSON.stringify(swatch)}</script>`,
    galleryBlock,
  ]
    .filter(Boolean)
    .join('\n');
}
