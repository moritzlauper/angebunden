'use client'

import { type ReactNode } from 'react'
import { MUSTER, richtungText, type Richtung } from './fuehrung.ts'
import type { Fuehrungsstand } from './fuehrung-zustand'
import { ui, km, KleinKnopf, HOEHE_MOBIL, UNTEN_MOBIL } from './teile'

/** Ein Pfeil, der nach links oder rechts abbiegt, oder wendet. */
function Pfeil({ richtung, groesse = 44 }: { richtung: Richtung | 'geradeaus' | 'ziel'; groesse?: number }) {
  const pfade: Record<string, string> = {
    rechts: 'M6 20v-7a5 5 0 0 1 5-5h9M16 4l4 4-4 4',
    links: 'M18 20v-7a5 5 0 0 0-5-5H4M8 4 4 8l4 4',
    wende: 'M8 20V8a4 4 0 1 1 8 0v6M12 10l4 4 4-4',
    geradeaus: 'M12 20V5M6 10l6-6 6 6',
    ziel: 'M6 21V4M6 4h11l-2 4 2 4H6',
  }
  return (
    <svg width={groesse} height={groesse} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={pfade[richtung]} />
    </svg>
  )
}

/**
 * Die Anzeige während der Führung: gross, damit man sie im Vorbeifahren liest. Sie steht auf dem Handy
 * oben, wo die Suchfelder waren, auf dem Desktop im Bedienfeld.
 */
export function FuehrungKarte({ f }: { f: Fuehrungsstand }) {
  if (!f.aktiv) return null
  const { naechste, bis, rest, abseits, angekommen } = f.stand
  const symbol = angekommen ? 'ziel' : naechste && bis < 400 ? naechste.richtung : 'geradeaus'
  const titel = angekommen ? 'Am Ziel' : abseits ? 'Neu gerechnet' : naechste ? (bis < 400 ? richtungText(naechste.richtung) : 'Geradeaus') : 'Geradeaus bis zum Ziel'
  const unter = angekommen
    ? 'Die Fahrt ist beendet.'
    : abseits
      ? 'Du bist von der Route abgekommen, der Velonavi sucht einen neuen Weg.'
      : naechste
        ? `${bis < 400 ? `in ${Math.max(5, Math.round(bis / 5) * 5)} m` : `noch ${km(bis)}`}${naechste.strasse ? ` · ${naechste.strasse}` : ''}`
        : `noch ${km(rest)}`
  return (
    <div
      className="flex items-center gap-3 rounded-2xl border px-4 py-3 backdrop-blur-md"
      style={{ background: ui.fg, borderColor: ui.fg, color: ui.bg, boxShadow: ui.schatten }}
      role="status"
      aria-live="polite"
    >
      <Pfeil richtung={symbol} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[18px] font-semibold leading-tight">{titel}</div>
        <div className="truncate text-[13px] opacity-80">{unter}</div>
        {!angekommen && !abseits && naechste && (
          <div className="mt-0.5 text-[11px] opacity-70">Noch {km(rest)} bis zum Ziel</div>
        )}
      </div>
      <button
        onClick={f.beenden}
        className="shrink-0 rounded-full border px-3 py-1.5 text-[12px] font-medium"
        style={{ borderColor: 'currentColor' }}
      >
        Beenden
      </button>
    </div>
  )
}

/** Der Knopf, der die Führung startet. */
export function FuehrungKnopf({ f, routeDa }: { f: Fuehrungsstand; routeDa: boolean }) {
  if (f.aktiv || !routeDa) return null
  return (
    <button
      onClick={f.beginnen}
      className="flex items-center justify-center gap-2 rounded-full border px-4 py-2 text-[13px] font-medium"
      style={{ background: ui.fg, borderColor: ui.fg, color: ui.bg }}
      title="Das Handy sagt dir per Vibration, wo du abbiegen sollst"
    >
      <Pfeil richtung="rechts" groesse={16} />
      Geführt fahren
    </button>
  )
}

function Zeile({ symbol, titel, text, muster, f }: { symbol: ReactNode; titel: string; text: string; muster: keyof typeof MUSTER; f: Fuehrungsstand }) {
  return (
    <div className="flex items-center gap-3">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full" style={{ background: ui.weich }}>
        {symbol}
      </span>
      <div className="min-w-0 flex-1 text-[12px] leading-snug">
        <div className="font-medium">{titel}</div>
        <div style={{ color: ui.muted }}>{text}</div>
      </div>
      <KleinKnopf onClick={() => f.probieren(muster)} titel={`${titel} ausprobieren`}>
        Fühlen
      </KleinKnopf>
    </div>
  )
}

/**
 * Die Einführung beim ersten Start: was die Muster bedeuten, zum Ausprobieren, und was man wissen muss.
 * Sie erscheint nur einmal, danach startet die Führung gleich.
 */
export function FuehrungIntro({ f, mobil }: { f: Fuehrungsstand; mobil: boolean }) {
  if (!f.introOffen) return null
  return (
    <>
      <div className="absolute inset-0 z-40" style={{ background: 'rgba(0, 0, 0, 0.35)' }} onClick={() => f.setIntroOffen(false)} />
      <div
        role="dialog"
        aria-label="Geführt fahren"
        className={'absolute z-50 flex flex-col gap-3.5 overflow-y-auto rounded-2xl border p-4 backdrop-blur-md ' + (mobil ? 'inset-x-3' : 'left-1/2 top-1/2 w-[24rem] -translate-x-1/2 -translate-y-1/2')}
        style={{ background: ui.panel, borderColor: ui.border, boxShadow: ui.schatten, color: ui.fg, bottom: mobil ? UNTEN_MOBIL : undefined, maxHeight: mobil ? HOEHE_MOBIL : 'calc(100% - 1.5rem)' }}
      >
        <div>
          <h2 className="text-[16px] font-semibold">Geführt fahren</h2>
          <p className="mt-1 text-[12px] leading-snug" style={{ color: ui.muted }}>
            Das Handy sagt dir per Vibration, wo du abbiegen sollst. Du musst nicht aufs Display schauen. Ein Stoss kommt ein paar Sekunden vor der Kreuzung, je schneller du fährst, desto früher.
          </p>
        </div>
        <div className="flex flex-col gap-2.5">
          <Zeile f={f} muster="rechts" titel="Einmal lang: rechts" text="Bei der nächsten Kreuzung rechts abbiegen." symbol={<Pfeil richtung="rechts" groesse={20} />} />
          <Zeile f={f} muster="links" titel="Zweimal kurz: links" text="Bei der nächsten Kreuzung links abbiegen." symbol={<Pfeil richtung="links" groesse={20} />} />
          <Zeile f={f} muster="wende" titel="Dreimal kurz: wenden" text="Eine Kehrtwende, meist nach einem verpassten Abzweig." symbol={<Pfeil richtung="wende" groesse={20} />} />
          <Zeile f={f} muster="ziel" titel="Ein langes Signal: Ziel" text="Du bist da. Die Führung endet." symbol={<Pfeil richtung="ziel" groesse={20} />} />
          <Zeile f={f} muster="abseits" titel="Vier kurze: abseits" text="Du bist von der Route abgekommen, der Velonavi rechnet neu." symbol={<span className="text-[15px]" aria-hidden>!</span>} />
        </div>
        {!f.kannVibrieren && (
          <p className="rounded-2xl px-3 py-2 text-[12px] leading-snug" style={{ background: ui.weich }}>
            Dieses Gerät vibriert aus dem Browser nicht, zum Beispiel ein iPhone. In der Android-App geht es. Die Anzeige oben funktioniert trotzdem.
          </p>
        )}
        <ul className="flex list-disc flex-col gap-1 pl-4 text-[12px] leading-snug" style={{ color: ui.muted }}>
          <li>Der Bildschirm bleibt an, sonst verliert das Handy den Standort. Sperr ihn nicht und lass die Seite offen.</li>
          <li>Am Lenker oder in der Jackentasche spürst du die Stösse. Probier die Muster oben kurz aus.</li>
          <li>Es gelten die Verkehrsregeln. Die Route kennt nicht jede Baustelle und jede Einbahn.</li>
        </ul>
        <div className="flex gap-1.5">
          <button
            onClick={f.introFertig}
            className="flex-1 rounded-full border px-3 py-2 text-[13px] font-medium"
            style={{ background: ui.fg, borderColor: ui.fg, color: ui.bg }}
          >
            Losfahren
          </button>
          <KleinKnopf onClick={() => f.setIntroOffen(false)} titel="Nicht starten">
            Abbrechen
          </KleinKnopf>
        </div>
      </div>
    </>
  )
}
