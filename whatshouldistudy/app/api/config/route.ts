import { NextResponse } from 'next/server'
import { priceFor } from '@/lib/pricing.ts'
import { mailConfigured } from '@/lib/server/mail.ts'
import { paymentMode, visitorCountry } from '@/lib/server/token.ts'
import { SITES } from '@/lib/site/config.ts'
import type { SiteId } from '@/lib/site/config.ts'

/** Payment mode, the price in the visitor's currency, and whether the site can send mail. */
export async function GET(req: Request) {
  const site = new URL(req.url).searchParams.get('site') as SiteId | null
  const price = priceFor(visitorCountry(req), SITES[site && site in SITES ? site : 'global'].currency)
  return NextResponse.json({ payments: paymentMode(), price, mail: mailConfigured() }, { headers: { 'Cache-Control': 'private, no-store' } })
}
