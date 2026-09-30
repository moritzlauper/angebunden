-- Lernen aus den Fahrten anderer.
--
-- Die Tabellen nehmen einzelne Messwerte auf, ohne Konto, ohne Zeitpunkt,
-- ohne Kennung und ohne Bezug zu einer Fahrt (`app/velonavi/gemeinschaft.ts`).
-- Einfügen darf jeder mit dem öffentlichen Schlüssel, lesen darf niemand.
-- Was die Seite zurückbekommt, liefert allein die Funktion unten, und die
-- gibt einen Wert erst her, wenn mindestens fünf Messungen dazu vorliegen.

create table if not exists public.velonavi_messungen_kanten (
  -- Koordinaten beider Knoten, auf einen Meter gerundet: «859234_4737612>859301_4737655»
  k text not null check (length(k) between 8 and 60 and k ~ '^-?[0-9]+_-?[0-9]+>-?[0-9]+_-?[0-9]+$'),
  -- Fahrzeit im Verhältnis zur erwarteten
  v real not null check (v between 0.3 and 4)
);

create table if not exists public.velonavi_messungen_ampeln (
  -- Koordinaten der Ampel, Achtel der Anfahrtsrichtung, Manöver: «853921_4737410_3_0»
  k text not null check (length(k) between 8 and 60 and k ~ '^-?[0-9]+_-?[0-9]+_[0-7]_[0-3]$'),
  -- gewartete Sekunden, null bei Grün
  w real not null check (w between 0 and 240)
);

create index if not exists velonavi_messungen_kanten_k_idx on public.velonavi_messungen_kanten (k);
create index if not exists velonavi_messungen_ampeln_k_idx on public.velonavi_messungen_ampeln (k);

alter table public.velonavi_messungen_kanten enable row level security;
alter table public.velonavi_messungen_ampeln enable row level security;

revoke all on public.velonavi_messungen_kanten from anon, authenticated;
revoke all on public.velonavi_messungen_ampeln from anon, authenticated;
grant insert on public.velonavi_messungen_kanten to anon, authenticated;
grant insert on public.velonavi_messungen_ampeln to anon, authenticated;

drop policy if exists "Messwerte beitragen" on public.velonavi_messungen_kanten;
create policy "Messwerte beitragen" on public.velonavi_messungen_kanten
  for insert to anon, authenticated with check (true);
drop policy if exists "Messwerte beitragen" on public.velonavi_messungen_ampeln;
create policy "Messwerte beitragen" on public.velonavi_messungen_ampeln
  for insert to anon, authenticated with check (true);

-- Der Durchschnitt aller Messungen: je Abschnitt der Median des Verhältnisses,
-- je Ampel die mittlere Wartezeit, jeweils mit der Zahl der Messungen.
create or replace function public.velonavi_gemeinschaft(mindestens int default 5)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'kanten', coalesce((
      select jsonb_object_agg(k, jsonb_build_array(round(m::numeric, 3), n))
      from (
        select k, percentile_cont(0.5) within group (order by v) as m, count(*) as n
        from public.velonavi_messungen_kanten
        group by k
        having count(*) >= greatest(mindestens, 5)
      ) x
    ), '{}'::jsonb),
    'ampeln', coalesce((
      select jsonb_object_agg(k, jsonb_build_array(round(m::numeric, 1), n))
      from (
        select k, avg(w) as m, count(*) as n
        from public.velonavi_messungen_ampeln
        group by k
        having count(*) >= greatest(mindestens, 5)
      ) x
    ), '{}'::jsonb)
  );
$$;

revoke all on function public.velonavi_gemeinschaft(int) from public;
grant execute on function public.velonavi_gemeinschaft(int) to anon, authenticated;
