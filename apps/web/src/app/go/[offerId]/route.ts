import { sql } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { db } from '@tike/db';

export const dynamic = 'force-dynamic';

/**
 * Tracked outclick.
 *
 * The click is the monetization evidence: per-shop referral counts are what a retailer
 * is shown when negotiating a CPC deal. It is recorded in the same round trip that
 * resolves the destination, so the redirect stays fast.
 *
 * No IP or raw user agent is stored — only the size the visitor had filtered on, which
 * is the number a shop actually wants (what they are failing to stock).
 */
export async function GET(request: Request, { params }: { params: Promise<{ offerId: string }> }) {
  const { offerId } = await params;
  const id = Number(offerId);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: 'invalid offer' }, { status: 400 });
  }

  const sizeParam = Number(new URL(request.url).searchParams.get('velicina'));
  const size = Number.isFinite(sizeParam) && sizeParam > 0 ? sizeParam : null;

  const result = await db().execute(sql`
    with target as (
      select o.id, o.shop_id, o.url
      from offer o join shop s on s.id = o.shop_id
      where o.id = ${id} and s.active
    ),
    logged as (
      insert into click (offer_id, shop_id, size_eu)
      select id, shop_id, ${size} from target
      returning 1
    )
    select url from target
  `);

  const row = (result.rows as { url?: string }[])[0];
  if (!row?.url) {
    return NextResponse.json({ error: 'unknown offer' }, { status: 404 });
  }

  // 302, not 301: the destination is inventory, not a permanent move.
  return NextResponse.redirect(row.url, 302);
}
