/**
 * Group shop listings into canonical products.
 *
 * Three shops can list the same shoe three times; a shopper wants one card saying
 * "3 shops, from 159 KM". This job decides which offers are the same shoe and creates
 * the `product` row they all point at.
 *
 * Run with `pnpm --filter @tike/jobs match [--dry-run]`.
 *
 * Safety: only conclusive matches (barcode, manufacturer style code) and high-confidence
 * fuzzy pairs are merged. Middling pairs are reported and left alone — an unmerged
 * duplicate is untidy, a wrong merge is a lie about what a shop sells.
 */

import { eq, sql } from 'drizzle-orm';
import {
  cleanModel,
  isAutoMergeable,
  isPlausibleSizeSpan,
  matchOffers,
  normalizeForSearch,
  slugify,
  type MatchCandidate,
  type MatchMethod,
  type MatchResult,
} from '@tike/core';
import { brand as brandTable, offer, product, withDb } from '@tike/db';

const dryRun = process.argv.includes('--dry-run');

interface Row extends MatchCandidate {
  title: string;
  imageUrl: string | null;
  shopId: number;
}

/**
 * Union-find that refuses to put two listings from one shop into the same product.
 *
 * `matchOffers` already rejects same-shop pairs, but union-find merges transitively and
 * that guard cannot see it coming: fifteen Buzz colourways of "Pegasus Premium" each
 * matched the one Sport Vision listing of that model, and so each other through it —
 * one card standing in for fifteen different shoes.
 *
 * A shop lists a given product once. Enforcing that on the finished cluster, not only
 * on the pair, is what makes the rule actually hold.
 */
class Groups {
  private parent = new Map<number, number>();
  /** Shops represented in a cluster, tracked on its root. */
  private shops = new Map<number, Set<number>>();

  find(x: number): number {
    const p = this.parent.get(x);
    if (p === undefined) {
      this.parent.set(x, x);
      return x;
    }
    if (p === x) return x;
    const root = this.find(p);
    this.parent.set(x, root);
    return root;
  }

  private shopsOf(root: number): Set<number> {
    const existing = this.shops.get(root);
    if (existing) return existing;
    const created = new Set<number>();
    this.shops.set(root, created);
    return created;
  }

  /** Registers an offer and the shop that listed it, before any merging happens. */
  add(offerId: number, shopId: number): void {
    this.shopsOf(this.find(offerId)).add(shopId);
  }

  /**
   * Merges two clusters unless that would give one shop two listings of the same
   * product. Returns false when the merge was refused.
   */
  tryUnion(a: number, b: number): boolean {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra === rb) return true;

    const sa = this.shopsOf(ra);
    const sb = this.shopsOf(rb);
    for (const shopId of sa) if (sb.has(shopId)) return false;

    this.parent.set(ra, rb);
    for (const shopId of sa) sb.add(shopId);
    this.shops.delete(ra);
    return true;
  }

  clusters(): Map<number, number[]> {
    const out = new Map<number, number[]>();
    for (const id of this.parent.keys()) {
      const root = this.find(id);
      const list = out.get(root) ?? [];
      list.push(id);
      out.set(root, list);
    }
    return out;
  }
}

await withDb(async (db) => {
  const rows = (
    await db.execute(sql`
      select o.id, o.shop_id, o.title, o.raw_brand, o.sku, o.image_url, o.gender::text as gender,
             -- In-stock sizes only. NBSHOP renders a shop's whole size scale and disables
             -- what it cannot sell, so one women's Puma lists EU 16 to 51 with four sizes
             -- actually available. Fed to the guards, that range overlaps everything —
             -- it stops separating kids' shoes from adults', and then the span check
             -- throws the cluster away. What a shop can sell today is the honest signal.
             coalesce(
               (select json_agg(s.size_eu) from offer_size s
                where s.offer_id = o.id and s.in_stock),
               '[]'::json
             ) as sizes,
             -- Barcodes drive matching tier 1. They live per size, so an offer carries a
             -- set; two offers sharing any one of them are the same shoe.
             coalesce(
               (select json_agg(distinct s.gtin) from offer_size s
                where s.offer_id = o.id and s.gtin is not null),
               '[]'::json
             ) as gtins
      from offer o
      join shop sh on sh.id = o.shop_id
      where sh.active
      order by o.id
    `)
  ).rows as Record<string, unknown>[];

  const candidates: Row[] = rows.map((r) => {
    const rawBrand = r.raw_brand === null ? null : String(r.raw_brand);
    const title = String(r.title);
    const shopId = Number(r.shop_id);
    return {
      offerId: Number(r.id),
      shopId,
      title,
      brand: rawBrand,
      model: cleanModel(title, rawBrand),
      sku: r.sku === null ? null : String(r.sku),
      gtins: Array.isArray(r.gtins) ? r.gtins.map(String) : [],
      gender: r.gender === null ? null : String(r.gender),
      sizesEu: Array.isArray(r.sizes) ? r.sizes.map(Number) : [],
      imageUrl: r.image_url === null ? null : String(r.image_url),
    };
  });

  console.log(`loaded ${candidates.length} offers`);

  // Compare within a brand only. Cross-brand matches are rejected anyway, and blocking
  // keeps this linear-ish as the catalogue grows instead of quadratic over everything.
  const byBrand = new Map<string, Row[]>();
  for (const c of candidates) {
    const key = c.brand ? normalizeForSearch(c.brand) : '';
    if (!key) continue;
    const list = byBrand.get(key) ?? [];
    list.push(c);
    byBrand.set(key, list);
  }

  const groups = new Groups();
  for (const c of candidates) groups.add(c.offerId, c.shopId);

  const methodOf = new Map<number, MatchMethod>();
  const review: { a: Row; b: Row; confidence: number }[] = [];
  const mergeable: { a: Row; b: Row; result: MatchResult }[] = [];
  let comparisons = 0;

  for (const [, list] of byBrand) {
    for (let i = 0; i < list.length; i += 1) {
      for (let j = i + 1; j < list.length; j += 1) {
        comparisons += 1;
        const a = list[i]!;
        const b = list[j]!;
        const result = matchOffers(a, b);
        if (!result) continue;

        if (isAutoMergeable(result)) {
          mergeable.push({ a, b, result });
        } else {
          review.push({ a, b, confidence: result.confidence });
        }
      }
    }
  }

  // Strongest evidence claims its partner first. Order matters now that a merge can be
  // refused: a barcode match has to win the slot before a fuzzy title can take it.
  mergeable.sort((x, y) => y.result.confidence - x.result.confidence);

  let contested = 0;
  for (const { a, b, result } of mergeable) {
    if (groups.tryUnion(a.offerId, b.offerId)) {
      methodOf.set(a.offerId, result.method);
      methodOf.set(b.offerId, result.method);
    } else {
      contested += 1;
    }
  }

  // Union-find merges transitively, so a pairwise guard is not enough: a junior listing
  // can match both a kids and an adult one and chain all three together. Validate the
  // finished group, and drop any that spans an implausible range.
  const byId = new Map(candidates.map((c) => [c.offerId, c]));
  const allClusters = [...groups.clusters().values()].filter((ids) => ids.length > 1);
  const rejected: number[][] = [];
  const clusters = allClusters.filter((ids) => {
    const sizes = ids.flatMap((id) => byId.get(id)!.sizesEu);
    if (isPlausibleSizeSpan(sizes)) return true;
    rejected.push(ids);
    return false;
  });

  for (const ids of rejected) {
    const sizes = ids.flatMap((id) => byId.get(id)!.sizesEu);
    console.warn(
      `  rejected group (size span ${Math.min(...sizes)}-${Math.max(...sizes)}): ` +
        ids.map((id) => `"${byId.get(id)!.model}"`).join(' + '),
    );
  }

  const grouped = clusters.reduce((n, ids) => n + ids.length, 0);

  console.log(
    `compared ${comparisons} pairs within ${byBrand.size} brands\n` +
      `  merged:  ${clusters.length} products from ${grouped} offers\n` +
      `  dropped: ${rejected.length} groups spanning an implausible size range\n` +
      `  refused: ${contested} merges that would have doubled up one shop\n` +
      `  review:  ${review.length} uncertain pairs (left unmatched)\n` +
      `  singles: ${candidates.length - grouped} offers with no counterpart`,
  );

  const multiShop = clusters.filter(
    (ids) => new Set(ids.map((id) => candidates.find((c) => c.offerId === id)!.shopId)).size > 1,
  );
  console.log(`  of those, ${multiShop.length} products are carried by more than one shop`);

  for (const { a, b, confidence } of review.slice(0, 5)) {
    console.log(`  review ${confidence}: "${a.model}" <-> "${b.model}"`);
  }

  if (dryRun) {
    console.log('\ndry run: nothing written');
    return;
  }

  // Matching derives its answer from the current catalogue rather than accumulating it,
  // so a run has to be able to reach a *different* answer than the last one. Without
  // clearing first, a corrected matcher leaves the previous run's wrong groups sitting
  // in the database and the correction appears to have done nothing.
  //
  // Products carrying a reviewed decision in product_alias are kept: those encode a
  // human judgement, which this job has no business discarding.
  const cleared = await db.transaction(async (tx) => {
    await tx
      .update(offer)
      .set({ productId: null, matchMethod: null, matchConfidence: null })
      .where(sql`product_id is not null`);
    const removed = await tx
      .delete(product)
      .where(sql`not exists (select 1 from product_alias a where a.product_id = product.id)`)
      .returning({ id: product.id });
    return removed.length;
  });
  console.log(`cleared ${cleared} previously derived products`);

  // Brands are created lazily so product rows can reference them.
  const brandIds = new Map<string, number>();
  for (const name of new Set(candidates.map((c) => c.brand).filter(Boolean) as string[])) {
    const slug = slugify(name);
    const [row] = await db
      .insert(brandTable)
      .values({ slug, name })
      .onConflictDoUpdate({ target: brandTable.slug, set: { name } })
      .returning({ id: brandTable.id });
    brandIds.set(normalizeForSearch(name), row!.id);
  }

  let created = 0;
  for (const ids of clusters) {
    const members = ids
      .map((id) => candidates.find((c) => c.offerId === id)!)
      .sort((x, y) => x.model.length - y.model.length);
    const lead = members[0]!;

    // The shortest model name is usually the cleanest: shops append their own
    // qualifiers ("- BUBBLE LOVE", "(GS)") to the same underlying shoe.
    const model = lead.model;
    const slugBase = slugify([lead.brand, model].filter(Boolean).join(' '));

    await db.transaction(async (tx) => {
      const [created_] = await tx
        .insert(product)
        .values({
          brandId: lead.brand ? (brandIds.get(normalizeForSearch(lead.brand)) ?? null) : null,
          slug: `${slugBase}-${lead.offerId}`,
          model,
          styleCode: lead.sku,
          gender: (lead.gender as 'men' | 'women' | 'unisex' | 'kids' | null) ?? null,
          heroImageUrl: lead.imageUrl,
          searchDoc: normalizeForSearch([lead.brand, model, lead.sku].filter(Boolean).join(' ')),
        })
        .onConflictDoUpdate({ target: product.slug, set: { model } })
        .returning({ id: product.id });

      const productId = created_!.id;
      for (const member of members) {
        await tx
          .update(offer)
          .set({
            productId,
            matchMethod: methodOf.get(member.offerId) ?? 'fuzzy',
            matchConfidence: 1,
          })
          .where(eq(offer.id, member.offerId));
      }
    });
    created += 1;
  }

  console.log(`\nwrote ${created} products`);
});
