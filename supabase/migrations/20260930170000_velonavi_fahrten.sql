-- Aufgezeichnete Fahrten im Velonavi.
--
-- Gespeichert wird die rohe Spur, nicht ihre Zuordnung zum Velonetz: Die
-- Nummern der Kanten ändern sich mit jedem Lauf der Pipeline. Zuordnung und
-- alles Gelernte rechnet der Browser bei jedem Laden neu aus den Spuren
-- (`app/velonavi/fahrten.ts`).
--
-- Der Browser spricht direkt mit der Datenbank, mit dem öffentlichen
-- Schlüssel. Wer was sieht, regelt deshalb allein Row Level Security: jede
-- Person nur ihre eigenen Zeilen.

create table if not exists public.velonavi_fahrten (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  -- Zeitpunkt des ersten Punkts der Spur.
  begonnen timestamptz not null,
  dauer_s real not null check (dauer_s >= 0),
  distanz_m real not null check (distanz_m >= 0),
  -- {lon, lat, titel}
  start jsonb not null,
  ziel jsonb not null,
  -- [[lon, lat, Sekunden seit dem Start, Genauigkeit in Metern], …]
  spur jsonb not null check (jsonb_typeof(spur) = 'array'),
  -- Was der Velonavi beim Losfahren vorschlug: {wahl, schnell: {zeit, distanz}, komfort: {…}}
  vorschlag jsonb,
  quelle text not null default 'aufzeichnung' check (quelle in ('aufzeichnung', 'gpx')),
  erstellt timestamptz not null default now()
);

create index if not exists velonavi_fahrten_nutzer on public.velonavi_fahrten (user_id, begonnen desc);

alter table public.velonavi_fahrten enable row level security;

revoke all on public.velonavi_fahrten from anon;
grant select, insert, update, delete on public.velonavi_fahrten to authenticated;

drop policy if exists "Eigene Fahrten lesen" on public.velonavi_fahrten;
create policy "Eigene Fahrten lesen" on public.velonavi_fahrten
  for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "Eigene Fahrten anlegen" on public.velonavi_fahrten;
create policy "Eigene Fahrten anlegen" on public.velonavi_fahrten
  for insert to authenticated with check ((select auth.uid()) = user_id);

drop policy if exists "Eigene Fahrten ändern" on public.velonavi_fahrten;
create policy "Eigene Fahrten ändern" on public.velonavi_fahrten
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

drop policy if exists "Eigene Fahrten löschen" on public.velonavi_fahrten;
create policy "Eigene Fahrten löschen" on public.velonavi_fahrten
  for delete to authenticated using ((select auth.uid()) = user_id);
