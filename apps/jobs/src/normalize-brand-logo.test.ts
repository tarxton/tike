import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import {
  brandLogoKey,
  LOGO_MAX_HEIGHT,
  LOGO_MAX_WIDTH,
  LogoRejected,
  normalizeBrandLogo,
} from './normalize-brand-logo';

type Rgba = { r: number; g: number; b: number; alpha: number };

/** A mark centred on a wide margin, as shops often pad their logos. */
async function paddedMark(background: Rgba, mark: Rgba): Promise<Buffer> {
  const inner = await sharp({
    create: { width: 300, height: 100, channels: 4, background: mark },
  })
    .png()
    .toBuffer();
  return sharp({ create: { width: 900, height: 500, channels: 4, background } })
    .composite([{ input: inner, left: 300, top: 200 }])
    .png()
    .toBuffer();
}

describe('normalizeBrandLogo', () => {
  it('trims the margin off a transparent PNG and keeps its proportions', async () => {
    const out = await normalizeBrandLogo(
      await paddedMark({ r: 0, g: 0, b: 0, alpha: 0 }, { r: 20, g: 20, b: 20, alpha: 1 }),
    );
    expect(out.width).toBe(300);
    expect(out.height).toBe(100);
    expect((await sharp(out.data).metadata()).format).toBe('webp');
  });

  it('keeps transparency inside the mark, so it sits on any background', async () => {
    const block = await sharp({
      create: { width: 100, height: 100, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 1 } },
    })
      .png()
      .toBuffer();
    // Two letters with clear space between them, like most wordmarks.
    const twoMarks = await sharp({
      create: { width: 600, height: 300, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    })
      .composite([
        { input: block, left: 100, top: 100 },
        { input: block, left: 400, top: 100 },
      ])
      .png()
      .toBuffer();
    const out = await normalizeBrandLogo(twoMarks);
    expect(out.width).toBe(400);
    expect((await sharp(out.data).metadata()).hasAlpha).toBe(true);
  });

  it('trims a JPEG’s white margin the same way', async () => {
    const jpeg = await sharp(
      await paddedMark({ r: 255, g: 255, b: 255, alpha: 1 }, { r: 200, g: 0, b: 0, alpha: 1 }),
    )
      .jpeg()
      .toBuffer();
    const out = await normalizeBrandLogo(jpeg);
    expect(out.width).toBeLessThanOrEqual(304);
    expect(out.height).toBeLessThanOrEqual(104);
  });

  it('refuses a white logo meant for a dark header', async () => {
    const white = await paddedMark(
      { r: 0, g: 0, b: 0, alpha: 0 },
      { r: 255, g: 255, b: 255, alpha: 1 },
    );
    await expect(normalizeBrandLogo(white)).rejects.toBeInstanceOf(LogoRejected);
  });

  it('refuses an image with nothing visible in it', async () => {
    const empty = await sharp({
      create: { width: 50, height: 50, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    })
      .png()
      .toBuffer();
    await expect(normalizeBrandLogo(empty)).rejects.toBeInstanceOf(LogoRejected);
  });

  it('rasterises an SVG and bounds it to the box', async () => {
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="200" viewBox="0 0 1200 200">' +
        '<rect x="0" y="0" width="1200" height="200" fill="#111"/></svg>',
    );
    const out = await normalizeBrandLogo(svg);
    expect(out.width).toBeLessThanOrEqual(LOGO_MAX_WIDTH);
    expect(out.height).toBeLessThanOrEqual(LOGO_MAX_HEIGHT);
    expect(out.width / out.height).toBeCloseTo(6, 0);
  });
});

describe('normalizeBrandLogo on a small SVG', () => {
  it('draws it at the box’s size rather than its own 120px', async () => {
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="45" viewBox="0 0 120 45">' +
        '<rect x="0" y="0" width="120" height="45" fill="#111"/></svg>',
    );
    const out = await normalizeBrandLogo(svg);
    expect(out.height).toBe(LOGO_MAX_HEIGHT);
    expect(out.width).toBeGreaterThan(400);
  });
});

describe('brandLogoKey', () => {
  it('lives under brands/, where the photo sweep and re-render never look', () => {
    expect(brandLogoKey('nike', 'https://x.test/nike.png')).toMatch(
      /^brands\/nike\/[0-9a-f]{32}\.webp$/,
    );
  });
});
