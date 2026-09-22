import { createHash } from 'node:crypto';
import sharp from 'sharp';

/**
 * One brand logo, made fit to sit in the white box beside a product's name.
 *
 * Shops hand logos over in every shape: Đak's are SVG, Office Shoes' are JPEGs on white,
 * Sport Vision's and Juventa's are PNGs with and without transparency, some padded with
 * a wide margin. This trims the margin, bounds the size and re-encodes, so the box shows
 * the mark at one consistent scale whatever the shop sent.
 *
 * Deliberately not the product-photo transform. That one flattens onto white and centres
 * in a square; a logo keeps its own proportions and its transparency.
 */

/** Twice the largest box the page draws, for sharp edges on a high-density screen. */
export const LOGO_MAX_WIDTH = 480;
export const LOGO_MAX_HEIGHT = 160;

/** Share of a logo's visible pixels that must be dark enough to read on white. */
const MIN_INK = 0.02;

export class LogoRejected extends Error {}

export interface LogoRendition {
  data: Buffer;
  width: number;
  height: number;
  bytes: number;
}

export async function normalizeBrandLogo(input: Buffer): Promise<LogoRendition> {
  const opened = sharp(input, { density: await svgDensity(input) }).ensureAlpha();

  let trimmed: Buffer;
  try {
    // Trims whatever colour fills the corner: transparency for a PNG, white for a JPEG.
    trimmed = await opened.clone().trim({ threshold: 12 }).png().toBuffer();
  } catch {
    // A uniform image has nothing to trim, and sharp says so by throwing.
    trimmed = await opened.clone().png().toBuffer();
  }

  await assertVisibleOnWhite(trimmed);

  const { data, info } = await sharp(trimmed)
    .resize({
      width: LOGO_MAX_WIDTH,
      height: LOGO_MAX_HEIGHT,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .webp({ quality: 92, alphaQuality: 100 })
    .toBuffer({ resolveWithObject: true });

  return { data, width: info.width, height: info.height, bytes: info.size };
}

/**
 * The density to rasterise an SVG at: enough for twice the box, and no more.
 *
 * An SVG draws at 72 dpi by default, which leaves a small one blurry once scaled up to the
 * box. A fixed high density was the first answer and the wrong one: it turned a 1200px-wide
 * logo into a 6400px raster, only to shrink it to 480, and timed out on a CI runner.
 * Raster formats ignore density, so they keep sharp's default.
 */
async function svgDensity(input: Buffer): Promise<number> {
  const meta = await sharp(input).metadata();
  if (meta.format !== 'svg' || !meta.width || !meta.height) return 72;
  const scale = Math.min((2 * LOGO_MAX_WIDTH) / meta.width, (2 * LOGO_MAX_HEIGHT) / meta.height);
  return Math.min(1200, Math.max(72, 72 * scale));
}

/**
 * Refuses a logo that would vanish on the white box.
 *
 * Shops keep white-on-transparent versions of logos for dark headers, and one of those
 * stored as a brand's logo would render as an empty box on every product of that brand.
 * A pixel counts as ink when it is visible and noticeably darker than white; a coloured
 * mark counts too, since saturated colours are well below that line.
 */
async function assertVisibleOnWhite(png: Buffer): Promise<void> {
  const { data, info } = await sharp(png)
    .resize({ width: 200, height: 200, fit: 'inside' })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  let visible = 0;
  let ink = 0;
  for (let i = 0; i < data.length; i += info.channels) {
    const alpha = data[i + 3]!;
    if (alpha < 128) continue;
    visible += 1;
    const luminance = 0.2126 * data[i]! + 0.7152 * data[i + 1]! + 0.0722 * data[i + 2]!;
    if (luminance < 215) ink += 1;
  }
  if (visible === 0) throw new LogoRejected('logo has no visible pixels');
  if (ink / visible < MIN_INK) throw new LogoRejected('logo would not show on white');
}

/** `brands/<brand>/<hash of the source>.webp`: outside every prefix the photo jobs touch. */
export function brandLogoKey(brandSlug: string, sourceUrl: string): string {
  const hash = createHash('sha256').update(sourceUrl).digest('hex').slice(0, 32);
  return `brands/${brandSlug}/${hash}.webp`;
}
