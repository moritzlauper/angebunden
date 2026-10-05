-- Welche Inserate ein Suchabo schon kennt: kurze Prüfsummen ihrer Links (siehe pipeline/21-suchabos.ts).
-- So geht keine Wohnung zweimal hinaus, auch wenn sie bei einem Lauf kurz fehlt und wieder auftaucht.
alter table public.wohnungen_suchabos add column if not exists gesendet text[] not null default '{}';
