import { wohnungenBild } from '../../og/vorschaubild'
import { KREISE, kreisVon } from '../kreise'

export const dynamicParams = false

export function generateStaticParams() {
  return KREISE.map((k) => ({ kreis: k.slug }))
}

export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'
export const alt = 'angebunden · Mietwohnungen in einem Zürcher Stadtkreis auf einer Karte'

export default async function Image({ params }: { params: Promise<{ kreis: string }> }) {
  const kreis = kreisVon((await params).kreis)
  return wohnungenBild(kreis ? `Zürich Kreis ${kreis.nummer}` : 'Zürich')
}
