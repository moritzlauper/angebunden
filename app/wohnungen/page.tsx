import Wohnungssuche from './wohnungssuche'
import { WohnungenText, wohnungenMetadata } from './seo'

export const metadata = wohnungenMetadata()

export default function Page() {
  return <Wohnungssuche unten={<WohnungenText />} />
}
