-- Merkliste der Wohnungssuche (/wohnungen) im Konto: gemerkte und ausgeblendete Inserate und die
-- Filter. So gelten sie auf jedem Gerät. Eine Zeile je Konto, jede Person sieht nur die eigene.

create table if not exists public.wohnungen_merkliste (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  daten jsonb not null check (jsonb_typeof(daten) = 'object'),
  -- Zeitpunkt der Änderung auf dem Gerät.
  geaendert timestamptz not null default now()
);

alter table public.wohnungen_merkliste enable row level security;

revoke all on public.wohnungen_merkliste from anon;
revoke all on public.wohnungen_merkliste from authenticated;
grant select, insert, update, delete on public.wohnungen_merkliste to authenticated;

drop policy if exists "Eigene Merkliste lesen" on public.wohnungen_merkliste;
create policy "Eigene Merkliste lesen" on public.wohnungen_merkliste
  for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "Eigene Merkliste anlegen" on public.wohnungen_merkliste;
create policy "Eigene Merkliste anlegen" on public.wohnungen_merkliste
  for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists "Eigene Merkliste ändern" on public.wohnungen_merkliste;
create policy "Eigene Merkliste ändern" on public.wohnungen_merkliste
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists "Eigene Merkliste löschen" on public.wohnungen_merkliste;
create policy "Eigene Merkliste löschen" on public.wohnungen_merkliste
  for delete to authenticated using ((select auth.uid()) = user_id);
