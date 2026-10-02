import { ImageResponse } from 'next/og'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { SITE_TAGLINE, SITE_URL } from '../site'
import { PUNKT } from '../marke'
import { OG } from './farben'

/**
 * Die festen Vorschaubilder für WhatsApp, Google und die sozialen Netze: links
 * Wortmarke und eine Zeile, rechts eine Karte aus echten Daten. Die Karten
 * zeichnet `pipeline/vorschau-karten.ts` vor, hier kommt nur noch der Text
 * darüber. Ein Bild pro Route, ohne Serveranteil beim Bauen gerendert.
 *
 * Das Bild gilt nur für das Segment, in dem die Datei liegt: `opengraph-image`
 * vererbt sich nicht an Unterordner. Jede Route, die geteilt werden soll,
 * braucht deshalb eine eigene Datei.
 */

export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

const og = (datei: string) => readFile(join(process.cwd(), 'app/og', datei))
const regular = await og('Geist-Regular.ttf')
const semibold = await og('Geist-SemiBold.ttf')

const domain = SITE_URL.replace(/^https?:\/\//, '')

export function altText(stadtName: string) {
  return `angebunden · ${SITE_TAGLINE} in ${stadtName}`
}

async function karte(datei: string) {
  return `data:image/svg+xml;base64,${(await og(datei)).toString('base64')}`
}

function Wortmarke({ groesse }: { groesse: number }) {
  const d = Math.round(groesse * 0.24)
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-end',
        fontSize: groesse,
        fontWeight: 600,
        letterSpacing: '-0.035em',
        lineHeight: 1,
        color: OG.text,
      }}
    >
      angebunden
      <div
        style={{
          width: d,
          height: d,
          borderRadius: 999,
          background: PUNKT,
          marginLeft: Math.round(groesse * 0.03),
          marginBottom: Math.round(groesse * 0.045),
        }}
      />
    </div>
  )
}

function Pille({ farbe, children }: { farbe: string; children: string }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        padding: '10px 20px 10px 16px',
        borderRadius: 999,
        background: 'rgba(255,255,255,0.1)',
        border: '1.5px solid rgba(255,255,255,0.16)',
        fontSize: 24,
        color: OG.text,
        marginRight: 12,
      }}
    >
      <div style={{ width: 14, height: 14, borderRadius: 999, background: farbe, marginRight: 12 }} />
      {children}
    </div>
  )
}

/** Die Adresse unten links, dort liegt keine Karte darunter. */
function Domain() {
  return <div style={{ display: 'flex', fontSize: 22, color: OG.sehrLeise, marginLeft: 44, marginBottom: 2 }}>{domain}</div>
}

/** Karte als Grund, links ein Verlauf, damit der Text lesbar bleibt. */
function Rahmen({ bild, grund, children }: { bild: string; grund: string; children: React.ReactNode }) {
  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', position: 'relative', background: grund, fontFamily: 'Geist' }}>
      {/* eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text */}
      <img src={bild} width={1200} height={630} style={{ position: 'absolute', left: 0, top: 0 }} />
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: 740,
          height: 630,
          backgroundImage: `linear-gradient(90deg, ${grund} 0%, ${grund} 50%, ${grund}00 100%)`,
        }}
      />
      <div
        style={{
          position: 'relative',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          width: '100%',
          height: '100%',
          padding: '64px 72px 56px',
        }}
      >
        {children}
      </div>
    </div>
  )
}

const schriften = {
  ...size,
  fonts: [
    { name: 'Geist', data: regular, weight: 400 as const, style: 'normal' as const },
    { name: 'Geist', data: semibold, weight: 600 as const, style: 'normal' as const },
  ],
}

/** Vorschaubild einer Stadtseite: alle Häuser, eingefärbt nach Rang. */
export async function stadtBild(stadtName: string, datei: string) {
  return new ImageResponse(
    (
      <Rahmen bild={await karte(datei)} grund={OG.grund}>
        <div style={{ display: 'flex' }}>
          <Pille farbe={OG.rampe[0]}>{stadtName}</Pille>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <Wortmarke groesse={104} />
          <div style={{ display: 'flex', fontSize: 44, lineHeight: 1.2, color: OG.text, marginTop: 28, maxWidth: 560 }}>
            {`Wie gut ist dein Haus in ${stadtName} angebunden?`}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'flex-end' }}>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <div
              style={{
                display: 'flex',
                width: 300,
                height: 12,
                borderRadius: 999,
                backgroundImage: `linear-gradient(90deg, ${OG.rampe.join(', ')})`,
              }}
            />
            <div style={{ display: 'flex', justifyContent: 'space-between', width: 300, marginTop: 10, fontSize: 20, color: OG.leise }}>
              <span>gut angebunden</span>
              <span>weit weg</span>
            </div>
          </div>
          <Domain />
        </div>
      </Rahmen>
    ),
    schriften
  )
}

/** Vorschaubild der Wohnungssuche, für die ganze Stadt oder einen Kreis. */
export async function wohnungenBild(ort = 'Zürich') {
  return new ImageResponse(
    (
      <Rahmen bild={await karte('karte-zuerich.svg')} grund={OG.grund}>
        <div style={{ display: 'flex' }}>
          <Pille farbe={OG.rampe[0]}>{ort}</Pille>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <Wortmarke groesse={104} />
          <div style={{ display: 'flex', fontSize: 44, lineHeight: 1.2, color: OG.text, marginTop: 28, maxWidth: 600 }}>
            {`Alle Mietwohnungen in ${ort} auf einer Karte`}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'flex-end' }}>
          <div style={{ display: 'flex', fontSize: 22, color: OG.leise, maxWidth: 560 }}>
            Flatfox, Ron Orp, WOKO · alle 10 Min. neu
          </div>
          <Domain />
        </div>
      </Rahmen>
    ),
    schriften
  )
}

/** Titel einer Hälfte im Startbild, unten über dem Verlauf. */
function Haelfte({ farbe, titel, zeile }: { farbe: string; titel: string; zeile: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', width: 600, paddingLeft: 56 }}>
      <div style={{ display: 'flex', alignItems: 'center', fontSize: 50, fontWeight: 600, letterSpacing: '-0.03em', lineHeight: 1, color: OG.text }}>
        <div style={{ width: 16, height: 16, borderRadius: 999, background: farbe, marginRight: 18, marginTop: 4 }} />
        {titel}
      </div>
      <div style={{ display: 'flex', fontSize: 24, color: OG.leise, marginTop: 14, marginLeft: 34 }}>{zeile}</div>
    </div>
  )
}

/**
 * Vorschaubild der Startseite: links die Erreichbarkeit, rechts der
 * Velonavi, je eine Hälfte. Die Karten liegen oben frei, die Titel stehen
 * unten, die Wortmarke klein darunter wie in den übrigen Bildern.
 */
export async function beidesBild() {
  const grund = '#0b0a10'
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', position: 'relative', background: grund, fontFamily: 'Geist' }}>
        {/* eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text */}
        <img src={await karte('karte-beides.svg')} width={1200} height={630} style={{ position: 'absolute', left: 0, top: 0 }} />
        <div
          style={{
            position: 'absolute',
            left: 0,
            top: 330,
            width: 1200,
            height: 300,
            backgroundImage: `linear-gradient(180deg, ${grund}00 0%, ${grund}f0 42%, ${grund} 100%)`,
          }}
        />
        <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', width: '100%', height: '100%', paddingBottom: 40 }}>
          <div style={{ display: 'flex' }}>
            <Haelfte farbe={OG.rampe[0]} titel="Erreichbarkeitskarte" zeile="Jedes Haus nach ÖV-Reisezeit" />
            <Haelfte farbe={OG.stufen[1]} titel="Velonavi" zeile="Die schnellste Veloroute" />
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end', marginTop: 44, paddingLeft: 56 }}>
            <Wortmarke groesse={40} />
            <Domain />
          </div>
        </div>
      </div>
    ),
    schriften
  )
}

/** Vorschaubild des Velonavi: eine echte Route bei Nacht. */
export async function velonaviBild() {
  return new ImageResponse(
    (
      <Rahmen bild={await karte('karte-velonavi.svg')} grund={OG.nacht}>
        <div style={{ display: 'flex' }}>
          <Pille farbe={OG.stufen[1]}>Velonavi Zürich</Pille>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div
            style={{
              display: 'flex',
              fontSize: 72,
              fontWeight: 600,
              letterSpacing: '-0.03em',
              lineHeight: 1.04,
              color: OG.text,
              maxWidth: 600,
            }}
          >
            Die schnellste Veloroute durch Zürich
          </div>
          <div style={{ display: 'flex', marginTop: 30 }}>
            <Pille farbe={OG.vorzug}>Vorzugsrouten</Pille>
            <Pille farbe={OG.stufen[3]}>Verkehr</Pille>
            <Pille farbe={OG.stufen[4]}>Lichtsignale</Pille>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'flex-end' }}>
          <Wortmarke groesse={40} />
          <Domain />
        </div>
      </Rahmen>
    ),
    schriften
  )
}
