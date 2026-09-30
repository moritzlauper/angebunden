-- Einstellungen des Velonavi im Konto: die Gewichte für «Komfort», ob Schieben erlaubt ist und die
-- Darstellung (hell, dunkel, automatisch). Sie gelten dann auf jedem Gerät für künftige Routen.
-- Eine Zeile je Konto, jede Person sieht nur die eigene.

create table if not exists public.velonavi_einstellungen (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  daten jsonb not null check (jsonb_typeof(daten) = 'object'),
  -- Zeitpunkt der Änderung auf dem Gerät. Die jüngere Fassung gewinnt.
  geaendert timestamptz not null default now()
);

alter table public.velonavi_einstellungen enable row level security;

revoke all on public.velonavi_einstellungen from anon;
revoke all on public.velonavi_einstellungen from authenticated;
grant select, insert, update, delete on public.velonavi_einstellungen to authenticated;

drop policy if exists "Eigene Einstellungen lesen" on public.velonavi_einstellungen;
create policy "Eigene Einstellungen lesen" on public.velonavi_einstellungen
  for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "Eigene Einstellungen anlegen" on public.velonavi_einstellungen;
create policy "Eigene Einstellungen anlegen" on public.velonavi_einstellungen
  for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists "Eigene Einstellungen ändern" on public.velonavi_einstellungen;
create policy "Eigene Einstellungen ändern" on public.velonavi_einstellungen
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists "Eigene Einstellungen löschen" on public.velonavi_einstellungen;
create policy "Eigene Einstellungen löschen" on public.velonavi_einstellungen
  for delete to authenticated using ((select auth.uid()) = user_id);
