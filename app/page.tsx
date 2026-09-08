import type { Metadata } from 'next'
import Karte from './karte'
import { ladeMeta } from './meta'
import { STAEDTE } from './staedte'
import { stadtMetadata } from './seo'
import { SeoInhalt } from './seo-inhalt'

export async function generateMetadata(): Promise<Metadata> {
  return stadtMetadata(STAEDTE.zuerich, await ladeMeta('zuerich'))
}

export default async function Page() {
  const meta = await ladeMeta('zuerich')
  return (
    <>
      <SeoInhalt stadt={STAEDTE.zuerich} meta={meta} />
      <Karte meta={meta} stadt={STAEDTE.zuerich} />
    </>
  )
}
