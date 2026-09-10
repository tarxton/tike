import { createHash } from 'node:crypto';
import sharp from 'sharp';

/**
 * One rendition for every shop.
 *
 * Retailers photograph shoes against whatever their studio uses and crop to whatever
 * their own grid wants, and those differences arrive intact:
 *
 *   buzz, sportvision, sportreality   640x640 on #f6f6f6
 *   djak                              505x505 on #ffffff
 *   officeshoes                       640x440 on #ffffff
 *
 * On a page that shows all five side by side that reads as a fault in the site. Office
 * Shoes was the worst of it — the only shop whose images are not square, so its white
 * photograph sat letterboxed inside the card's grey well with a visible band above and
 * below.
 *
 * So the backdrop is discarded rather than accommodated. `trim` removes the flat border
 * the shop baked in, the shoe is scaled into a fixed square with an even margin, and the
 * result is flattened onto white. Whatever a shop does to its photographs, tike shows the
 * same frame.
 */

/** Wide enough for a card at 2x on a phone, which is the largest place one is shown. */
export const WIDTH = 640;
const QUALITY = 80;

/**
 * How much of the frame the shoe may fill.
 *
 * Trim leaves the shoe touching all four edges, which looks cramped beside a card border
 * and crops the drop shadow shops photograph under the sole. A twelfth of the frame back
 * is enough to breathe without wasting the tile.
 */
const FILL = 0.88;

/**
 * How far a pixel may differ from the corner and still count as backdrop.
 *
 * Low, because these backdrops are flat: the risk being managed is a white shoe on a
 * white background losing its edge, not a gradient being left behind. Verified against
 * six white-on-white listings, which trim without clipping.
 */
const TRIM_THRESHOLD = 12;

export interface Rendition {
  data: Buffer;
  width: number;
  height: number;
  bytes: number;
}

export async function normalizeImage(input: Buffer): Promise<Rendition> {
  const inner = Math.round(WIDTH * FILL);

  // Two passes rather than one chain: `resize` with `fit: contain` pads to the target in
  // the same operation, so asking it to both shrink the shoe and centre it would fight
  // over which dimension the margin belongs to.
  const shoe = await sharp(input)
    .trim({ threshold: TRIM_THRESHOLD })
    .resize(inner, inner, { fit: 'inside' })
    .flatten({ background: '#ffffff' })
    .toBuffer();

  const output = await sharp(shoe)
    .resize(WIDTH, WIDTH, { fit: 'contain', background: '#ffffff' })
    .flatten({ background: '#ffffff' })
    .webp({ quality: QUALITY })
    .toBuffer({ resolveWithObject: true });

  return {
    data: output.data,
    width: output.info.width,
    height: output.info.height,
    bytes: output.info.size,
  };
}

/**
 * Bumped when the rendition changes, so a new shape lands beside the old one rather than
 * overwriting it. Rolling back a bad transform is then a column update, not nine thousand
 * fresh requests to five retailers.
 */
export const RENDITION = 'v2';

/**
 * Object key: a hash of the source URL, under the shop that published it.
 *
 * The hash rather than the original path because shop URLs carry their own cache-busting
 * segments and are not always valid object keys; the shop prefix keeps the bucket legible
 * and makes one retailer's images removable in one operation, which is what an opt-out or
 * a takedown request actually needs.
 *
 * It lives here, beside the transform, rather than in the job that first needed it. The
 * re-rendering job imported it from there and thereby imported that job's top-level
 * `main()` — so asking for a key silently started a crawl of every uncached image.
 */
export function objectKey(shopSlug: string, sourceUrl: string): string {
  const hash = createHash('sha256').update(sourceUrl).digest('hex').slice(0, 32);
  return `${RENDITION}/products/${shopSlug}/${hash}.webp`;
}
