import { ImageResponse } from 'next/og'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { SITE_TAGLINE, SITE_URL } from '../site'
import { PUNKT } from '../marke'

/**
 * Das feste Vorschaubild einer Stadtseite für WhatsApp, Google und die sozialen
 * Netze: die Wortmarke gross, darunter die Frage. Ein Bild pro Stadt, ohne
 * Serveranteil beim Bauen gerendert. Die Haus-Werte eines geteilten Links stehen
 * im mitgeschickten Text, nicht im Bild.
 */

export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

const regular = await readFile(join(process.cwd(), 'app/og/Geist-Regular.ttf'))
const semibold = await readFile(join(process.cwd(), 'app/og/Geist-SemiBold.ttf'))

const domain = SITE_URL.replace(/^https?:\/\//, '')

export function altText(stadtName: string) {
  return `angebunden · ${SITE_TAGLINE} in ${stadtName}`
}

export function vorschaubild(stadtName: string) {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#f7f7f5',
          color: '#18181b',
          padding: 90,
          fontFamily: 'Geist',
        }}
      >
        {/* Die Wortmarke: «angebunden» plus der rote Punkt, gross und mittig. */}
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-end',
            fontSize: 140,
            fontWeight: 600,
            letterSpacing: '-0.035em',
            lineHeight: 1,
          }}
        >
          angebunden
          <div
            style={{
              width: 34,
              height: 34,
              borderRadius: 999,
              background: PUNKT,
              marginLeft: 4,
              marginBottom: 6,
            }}
          />
        </div>

        <div
          style={{
            display: 'flex',
            textAlign: 'center',
            fontSize: 44,
            color: '#3f3f46',
            marginTop: 48,
            maxWidth: 900,
            lineHeight: 1.3,
          }}
        >
          {`Wie gut ist dein Haus in ${stadtName} angebunden?`}
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            marginTop: 64,
            fontSize: 25,
            color: '#a1a1aa',
          }}
        >
          <div style={{ display: 'flex', width: 44, height: 2, background: '#d4d4d8', marginRight: 16 }} />
          {domain}
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [
        { name: 'Geist', data: regular, weight: 400, style: 'normal' },
        { name: 'Geist', data: semibold, weight: 600, style: 'normal' },
      ],
    }
  )
}
