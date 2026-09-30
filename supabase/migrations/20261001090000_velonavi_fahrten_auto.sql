-- Fahrten, die die Android-App von selbst erkannt und aufgezeichnet hat.

alter table public.velonavi_fahrten drop constraint velonavi_fahrten_quelle_check;
alter table public.velonavi_fahrten
  add constraint velonavi_fahrten_quelle_check check (quelle in ('aufzeichnung', 'gpx', 'auto'));
