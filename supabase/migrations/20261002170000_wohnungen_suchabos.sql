-- Suchabos der Wohnungssuche: gespeicherte Filter, zu denen der Versand (pipeline/21-suchabos.ts,
-- im Workflow wohnungen.yml) neue passende Inserate per E-Mail schickt. Jede Person sieht und ändert
-- nur die eigenen Abos. Der Versand liest alle mit dem geheimen Schlüssel (service_role).

create table if not exists public.wohnungen_suchabos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  -- Wohin die Mails gehen. Beim Anlegen die Adresse des Kontos.
  email text not null check (position('@' in email) > 1),
  name text not null default 'Suchabo' check (length(name) <= 120),
  filter jsonb not null check (jsonb_typeof(filter) = 'object'),
  aktiv boolean not null default true,
  erstellt timestamptz not null default now(),
  -- Bis hier hat der Versand Inserate geprüft; nur, was danach zum ersten Mal auftaucht, ist neu.
  geprueft_bis timestamptz,
  -- Die Bestätigung nach dem Anlegen ist verschickt.
  bestaetigt boolean not null default false,
  -- Für den Abmeldelink in jeder Mail, ohne Anmeldung.
  abmelde_token uuid not null default gen_random_uuid()
);

create index if not exists wohnungen_suchabos_user on public.wohnungen_suchabos (user_id);

alter table public.wohnungen_suchabos enable row level security;

revoke all on public.wohnungen_suchabos from anon;
revoke all on public.wohnungen_suchabos from authenticated;
grant select, insert, update, delete on public.wohnungen_suchabos to authenticated;

drop policy if exists "Eigene Suchabos lesen" on public.wohnungen_suchabos;
create policy "Eigene Suchabos lesen" on public.wohnungen_suchabos
  for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "Eigene Suchabos anlegen" on public.wohnungen_suchabos;
create policy "Eigene Suchabos anlegen" on public.wohnungen_suchabos
  for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists "Eigene Suchabos ändern" on public.wohnungen_suchabos;
create policy "Eigene Suchabos ändern" on public.wohnungen_suchabos
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists "Eigene Suchabos löschen" on public.wohnungen_suchabos;
create policy "Eigene Suchabos löschen" on public.wohnungen_suchabos
  for delete to authenticated using ((select auth.uid()) = user_id);

-- Abmelden aus der Mail heraus: wer den Token kennt, schaltet genau dieses Abo ab.
create or replace function public.wohnungen_suchabo_abmelden(token uuid)
returns text
language sql
security definer
set search_path = public
as $$
  update public.wohnungen_suchabos set aktiv = false where abmelde_token = token returning name;
$$;

revoke all on function public.wohnungen_suchabo_abmelden(uuid) from public;
grant execute on function public.wohnungen_suchabo_abmelden(uuid) to anon, authenticated;
