// One mail through Resend, for the «Mail» workflow. Without TO it only checks:
// the key works (never printed), which domains Resend may send from, and the
// addresses on the LOOKUP page, so the recipient comes from the publisher's
// own imprint before anything goes out.
const { RESEND_API_KEY: KEY, LOOKUP, TO, FROM, REPLY_TO, BCC, SUBJECT, BODY } = process.env
if (!KEY) throw new Error('RESEND_API_KEY is not set')
const api = (path, init = {}) => fetch(`https://api.resend.com${path}`, { ...init, headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' } })

const domains = await api('/domains')
console.log(`Resend domains: HTTP ${domains.status} ${domains.ok ? (await domains.json()).data.map((d) => `${d.name} (${d.status})`).join(', ') : ''}`)

if (LOOKUP) {
  const html = await (await fetch(LOOKUP, { headers: { 'User-Agent': 'Mozilla/5.0' } })).text()
  const found = new Set([...html.matchAll(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g)].map((m) => m[0].toLowerCase()).filter((a) => !/\.(png|jpe?g|svg|webp|gif)$/.test(a)))
  console.log(`Addresses on ${LOOKUP}: ${[...found].join(', ') || 'none'}`)
}

if (TO) {
  if (!FROM || !SUBJECT || !BODY) throw new Error('FROM, SUBJECT and BODY are needed to send')
  const res = await api('/emails', { method: 'POST', body: JSON.stringify({ from: FROM, to: [TO], reply_to: REPLY_TO || undefined, bcc: BCC ? [BCC] : undefined, subject: SUBJECT, text: BODY }) })
  console.log(`Send to ${TO}: HTTP ${res.status} ${await res.text()}`)
  if (!res.ok) process.exit(1)
}
