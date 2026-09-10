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

/** Same question for the flood fill, which is allowed a little more room. */
const BACKDROP_TOLERANCE = 18;

/**
 * Only lift a backdrop that is already close to white.
 *
 * A shop that photographs on charcoal has made a deliberate choice, and turning it white
 * would be inventing a picture rather than reframing one.
 */
const MIN_BACKDROP_LIGHTNESS = 200;

/**
 * Repaint the backdrop white, working inwards from the edges.
 *
 * Trimming alone is not enough and the first version of this file got it wrong: `trim`
 * crops to the bounding box of the non-background content, and a shoe is not a rectangle,
 * so the shop's backdrop survives inside that box all around the silhouette. Buzz and
 * Sport Vision photograph on #f6f6f6, which left a visibly grey rectangle sitting on the
 * white square.
 *
 * Flood fill from the border rather than a global "recolour every near-white pixel",
 * because the second one cannot tell a grey backdrop from a grey shoe: only pixels
 * connected to the edge are backdrop, and a grey panel in the middle of a trainer is
 * safe by construction.
 */
async function whitenBackdrop(input: Buffer): Promise<Buffer> {
  const { data, info } = await sharp(input)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;

  const seed = [data[0]!, data[1]!, data[2]!];
  if (Math.min(...seed) < MIN_BACKDROP_LIGHTNESS) return input;

  const isBackdrop = (i: number) =>
    Math.abs(data[i]! - seed[0]!) <= BACKDROP_TOLERANCE &&
    Math.abs(data[i + 1]! - seed[1]!) <= BACKDROP_TOLERANCE &&
    Math.abs(data[i + 2]! - seed[2]!) <= BACKDROP_TOLERANCE;

  // An explicit stack rather than recursion: 640x640 is 410k pixels, and a recursive
  // fill over a mostly-uniform image overflows the call stack long before it finishes.
  const seen = new Uint8Array(width * height);
  const stack: number[] = [];
  for (let x = 0; x < width; x += 1) stack.push(x, 0, x, height - 1);
  for (let y = 0; y < height; y += 1) stack.push(0, y, width - 1, y);

  while (stack.length > 0) {
    const y = stack.pop()!;
    const x = stack.pop()!;
    if (x < 0 || y < 0 || x >= width || y >= height) continue;
    const pixel = y * width + x;
    if (seen[pixel]) continue;
    const i = pixel * channels;
    if (!isBackdrop(i)) continue;
    seen[pixel] = 1;
    data[i] = 255;
    data[i + 1] = 255;
    data[i + 2] = 255;
    stack.push(x + 1, y, x - 1, y, x, y + 1, x, y - 1);
  }

  return sharp(data, { raw: { width, height, channels } }).png().toBuffer();
}

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
  const shoe = await sharp(await whitenBackdrop(input))
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
export const RENDITION = 'v3';

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

/**
 * Where the very first rendition put an object.
 *
 * Kept so re-rendering can read the least-processed copy tike holds rather than the
 * current one. Running a 640px webp through resize and re-encode a second time softens
 * it for no reason when an earlier generation is sitting in the same bucket.
 */
export function originKey(shopSlug: string, sourceUrl: string): string {
  const hash = createHash('sha256').update(sourceUrl).digest('hex').slice(0, 32);
  return `products/${shopSlug}/${hash}.webp`;
}
