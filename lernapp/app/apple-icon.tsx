import { ImageResponse } from 'next/og'

export const size = { width: 180, height: 180 }
export const contentType = 'image/png'

/** Icon für den iPhone-Home-Bildschirm: drei Kästchen wie bei einer Klickerfrage. */
export default function AppleIcon() {
  const box = (filled: boolean, top: number) => (
    <div
      style={{
        position: 'absolute',
        left: 38,
        top,
        width: 30,
        height: 30,
        borderRadius: 7,
        background: filled ? '#15803d' : 'transparent',
        border: filled ? 'none' : '6px solid #f5f5f4',
      }}
    />
  )
  const line = (top: number, width: number, color: string) => (
    <div style={{ position: 'absolute', left: 82, top: top + 10, width, height: 11, borderRadius: 6, background: color }} />
  )
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', position: 'relative', background: '#0c0a09' }}>
        {box(true, 42)}
        {line(42, 62, '#f5f5f4')}
        {box(false, 80)}
        {line(80, 50, '#a8a29e')}
        {box(true, 118)}
        {line(118, 56, '#f5f5f4')}
      </div>
    ),
    size,
  )
}
