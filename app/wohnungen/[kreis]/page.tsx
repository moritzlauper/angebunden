import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import Wohnungssuche from '../wohnungssuche'
import { WohnungenText, wohnungenMetadata } from '../seo'
import { KREISE, kreisVon } from '../kreise'

/** Eine Seite je Stadtkreis, beim Bauen vorgerendert. Andere Adressen gibt es nicht. */
export const dynamicParams = false

export function generateStaticParams() {
  return KREISE.map((k) => ({ kreis: k.slug }))
}

export async function generateMetadata({ params }: PageProps<'/wohnungen/[kreis]'>): Promise<Metadata> {
  return wohnungenMetadata(kreisVon((await params).kreis))
}

export default async function Page({ params }: PageProps<'/wohnungen/[kreis]'>) {
  const kreis = kreisVon((await params).kreis)
  if (!kreis) notFound()
  return <Wohnungssuche kreis={kreis} unten={<WohnungenText kreis={kreis} />} />
}
