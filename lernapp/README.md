# Lernapp: Klickerfragen aus dem Vault

Eine Next.js-App, die Klickerfragen im OLAT-Format abfragt (je fünf Aussagen A–E, 0 bis 5 richtig) und pro Aussage einen Wiederholungsplan nach FSRS führt, dem Algorithmus von Anki. Die Aussagen stammen aus den eigenen Unterlagen und bleiben an ihre Fundstelle gebunden. Pro Fach stellt man ein, bis zu welcher UE abgefragt wird.

**Claude steuert die App.** Sie ist ein MCP-Server: Claude kann Fragen stellen und auswerten, Notes und Folien einspielen, neue Aussagen vorschlagen und blind gegenprüfen, die UE-Grenze setzen und exportieren. Gebraucht wird dafür kein API-Key, nur der eigene Claude-Zugang (claude.ai, Claude Code oder Cowork). Im Browser übt man dieselben Fragen mit demselben Lernstand.

Das erste Fach ist **Klinische Biopsychologie** (26HS 200-401a). Beim ersten Start legt die App es mit UE 1–4 an, übernimmt die 25 Aussagen aus `Klickerfragen_KliBio.md` und speichert die drei OLAT-Klickerfragen zu VL4 als Stilvorlagen (`data/seed/klinische-biopsychologie.ts`).

> Die App liegt vorerst im Repository `angebunden` und soll in ein eigenes Repository umziehen. Sie ist eigenständig, mit eigener `package.json`, eigenem Lockfile und eigener `pnpm-workspace.yaml`. Ausserhalb des Ordners liegt nur `.github/workflows/lernapp-pruefen.yml`: Beim Umzug mitnehmen und die `working-directory`-Zeilen streichen.
>
> ```bash
> git subtree split --prefix=lernapp -b lernapp-export
> ```

## Starten

```bash
cd lernapp
pnpm install
pnpm dev
```

Ohne `DATABASE_URL` läuft die Datenbank als PGlite (Postgres in WebAssembly) in `./.data`. Ohne `APP_PASSWORD` gibt es keinen Login. Ohne `MCP_TOKEN` ist der MCP-Server unter `http://localhost:3000/api/mcp/dev` erreichbar, in Produktion ist er dann abgeschaltet.

```bash
pnpm test        # Lernlogik, Parser, MCP-Abläufe gegen eine In-Memory-Datenbank
pnpm typecheck
pnpm build
```

## Betreiben (Vercel + Neon oder Supabase)

1. Ein Postgres anlegen, z. B. bei Neon oder Supabase, und die Verbindungs-URL kopieren.
2. In Vercel ein neues Projekt aus diesem Repository anlegen, mit **Root Directory `lernapp`**.
3. Umgebungsvariablen setzen (siehe `.env.example`):

| Variable | Wozu |
| --- | --- |
| `DATABASE_URL` | `postgres://…`, die Migrationen laufen beim ersten Aufruf von selbst |
| `APP_PASSWORD` | Passwort für die Weboberfläche |
| `SESSION_SECRET` | signiert das Login-Cookie, beliebige lange Zeichenkette |
| `MCP_TOKEN` | Geheimnis für Claude, lange zufällige Zeichenkette |
| `SEED_ON_EMPTY` | `1` (Standard): bei leerer DB Klinische Biopsychologie anlegen |

Danach liegt die App z. B. unter `https://klicker.vercel.app`.

## Claude verbinden

**claude.ai / Cowork:** Einstellungen → Connectors → «Eigenen Connector hinzufügen», URL:

```
https://<deine-domain>/api/mcp/<MCP_TOKEN>
```

Das Token steht im Pfad, weil eigene Connectors in claude.ai keine festen Header kennen. Wer die URL kennt, hat Zugriff, sie gehört also nicht in Chats, die man teilt.

**Claude Code:**

```bash
claude mcp add --transport http klicker https://<deine-domain>/api/mcp --header "Authorization: Bearer <MCP_TOKEN>"
```

Beim Verbinden bekommt Claude Anweisungen mit, wie die App gedacht ist (`lib/mcp/server.ts`, `INSTRUCTIONS`): nichts erfinden, Fragen einzeln stellen, Aussagen nur mit wörtlichem Zitat, blinde Gegenprüfung, Freigabe nur auf Wunsch. Man kann also einfach schreiben:

- «Heute 5 Fragen KliBio»
- «Lies Notes.md von Klinische Biopsychologie aus dem Drive, spiel sie ein und schlag Aussagen für die geänderten UEs vor»
- «Mach die blinde Gegenprüfung für die Inbox»
- «Stell KliBio auf bis UE 5, Prüfung am 20. Januar»
- «Exportier die heutigen Fragen und häng sie an Klickerfragen_KliBio.md an»

Die Morgen-Routine ruft dann `get_due` auf statt einer statischen Bank im Prompt.

### Werkzeuge

| Werkzeug | Was es tut |
| --- | --- |
| `list_subjects`, `get_subject` | Fächer, Fortschritt pro UE, Abdeckung, schwache Aussagen, Quellen |
| `create_subject`, `update_subject`, `upsert_unit` | Fach anlegen, UE-Grenze, Prüfungsdatum, Prüfungsmodus, Vault-Pfade |
| `sync_source` | Notes (zerlegt nach `# UE n`, nur geänderte UEs) oder Seitentexte von Folien einspielen |
| `get_unit_material` | Textstücke einer UE mit ID, vorhandene Aussagen, Verfälschungstypen, Stilvorlagen |
| `add_statements` | neue Aussagen in die Inbox; ohne wörtliches Zitat werden sie verworfen |
| `get_check_queue`, `submit_checks` | blinde Gegenprüfung: nur Aussage und Zitat, ohne Label |
| `list_inbox`, `review_statement`, `list_statements` | freigeben, bearbeiten, verwerfen, suchen |
| `get_due`, `report_answer`, `get_session_summary` | üben: Session starten, Antwort auswerten, Abschluss |
| `report_error` | Fehler melden, die Aussage geht sofort aus der Rotation |
| `export_markdown` | Fragen im Format der Exercises-Datei |
| `import_bank`, `add_style_examples` | bestehende Bank übernehmen, OLAT-Fragen und Altprüfungen als Vorlage |

Der Server ist zustandslos (Streamable HTTP, Antworten als JSON) und braucht kein SDK, siehe `lib/mcp/`.

## Wie es funktioniert

**Die Aussage ist die Lerneinheit, nicht die Frage.** Eine Frage ist nur eine Zusammenstellung von fünf Aussagen für den Moment. Der Lernstand hängt an der Aussage, auch wenn sie nächste Woche in einer anderen Frage auftaucht.

**Bewertung:** richtig angekreuzt oder richtig weggelassen gilt als «gut», falsch als «nochmals», und die Aussage kommt in der nächsten Session wieder. Mit «war geraten» zählt sie als «schwer». FSRS läuft ohne Kurzzeitschritte, weil man höchstens ein paar Mal am Tag übt (`lib/core/schedule.ts`).

**Session** (`lib/core/compose.ts`): zuerst fällige Aussagen, dann neue, dann die am wenigsten stabilen. Gemischt wird so, dass nur UEs bis zur Grenze vorkommen, mindestens drei UEs dabei sind und die neueste doppelt, die Anzahl richtiger Aussagen über die Session variiert und nie zwei Varianten derselben Ur-Aussage zusammen erscheinen. Im **Prüfungsmodus** zählt nicht der Plan, sondern Schwäche und «lange nicht gesehen».

**Fortschritt:** Eine Aussage gilt als «sicher», wenn ihre Stabilität über 21 Tagen liegt. Pro UE zeigt die App den Anteil sicherer Aussagen, die Trefferquote und eine Abdeckungskarte (Fundstelle × Anzahl Aussagen, Textstücke ohne Aussage). Die am häufigsten falsch beantworteten Aussagen ersetzen die «zwei Punkte zum Wiederholen».

**Qualität** (`lib/core/quality.ts`):

- Belegpflicht: Ohne wörtliches Zitat wird eine Aussage nicht gespeichert. Mit `chunk_id` prüft die App, ob das Zitat im Textstück steht.
- Automatische Hinweise: Absolutwörter («immer», «nur» …), die im Zitat fehlen, Zahlen, die nicht im Zitat stehen, Fachbegriffe, die nicht in der Quelle vorkommen, F-Aussagen ohne Verfälschungstyp.
- Blinde Gegenprüfung: Ein zweiter Durchgang sieht nur Aussage und Zitat. Weicht das Urteil ab, ist die Aussage «zu prüfen».
- Freigabe: Neue Aussagen kommen erst nach deinem OK in die Übungen. Mit `auto_approve` werden Aussagen ohne Freigabe aktiv, wenn der Prüfer zustimmt und nichts geflaggt ist (Standard: aus).
- Feste Items: In der Session wird nichts neu formuliert. Ändert man den Inhalt einer Aussage, steigt die Version und der Lernstand beginnt neu.
- Parallelformen: Wird eine Variante deutlich anders beantwortet als ihre Ur-Aussage, kommt sie zurück in die Inbox.
- Quellenänderung: Ändert sich eine `# UE`-Notiz, sucht die App das Zitat jeder betroffenen Aussage im neuen Text. Gefunden heisst neu verknüpfen, sonst «neu prüfen».

**Fundstellen:** «VL3 p.15» und «ZM S.69» werden zu `obsidian://`-Links, die mit PDF++ auf der Seite öffnen. Dafür in den Fach-Einstellungen den Vault-Namen, den Ordner, das Folienmuster (`Slides/VL{n}.pdf`) und den Pfad der Zusammenfassung eintragen.

## Datenmodell

Fach → UE → Quelle/Chunk → Aussage → Antwort; Fragen sind gespeicherte Zusammenstellungen (`lib/db/schema.ts`). Tabellen: `subject`, `unit`, `source`, `chunk`, `statement`, `check`, `practice_session`, `question`, `answer`, `card_state`, `report`, `style_example`. Migrationen in `drizzle/`, neu erzeugen mit `pnpm db:generate`.

## Stand der Roadmap

| Schritt | Stand |
| --- | --- |
| 1. MVP: ein Fach, Import, 5 Fragen, FSRS, UE-Grenze, Login | fertig |
| 2. Vault-Anbindung | über Claude: Claude liest den Vault (z. B. Google Drive) und spielt ihn mit `sync_source` ein, Änderungen werden pro UE erkannt. Fundstellen sind klickbar. Noch offen: Sync ohne Claude (Git-Webhook oder Drive-API) und PDF-Zerlegung mit pdfjs-dist in der App |
| 3. Generierung mit Qualitätssicherung | fertig, Generator und Prüfer ist Claude über MCP; Inbox, Abdeckungskarte |
| 4. Uploads und Kalibrierung | Stilvorlagen und Prüfungsmodus fertig; Datei-Upload in der Oberfläche fehlt noch |
| 5. MCP-Server | fertig |
| 6. Mehrere Nutzende, Trennschärfe | offen (`user_id` ist im Schema schon vorgesehen) |

Entscheide zu den offenen Fragen des Konzepts, solange nichts anderes gesagt ist: Claude-Zugang nur über MCP, kein API-Key; nur für eine Person; nur OLAT-Multiple-Choice; keine Aussage ohne Freigabe (umstellbar mit `auto_approve`); Hosting Vercel mit Neon oder Supabase, lokal geht es ohne Server.
