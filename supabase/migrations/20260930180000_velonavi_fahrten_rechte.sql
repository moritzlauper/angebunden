-- Supabase gibt neuen Tabellen von sich aus alle Rechte mit. Übrig bleiben
-- sollen nur die vier, die die Seite braucht. TRUNCATE ist das heikle: Es
-- leert die Tabelle für alle Konten, und Row Level Security greift dort nicht.
-- Über die REST-Schnittstelle ist es nicht erreichbar, das Recht braucht aber
-- auch sonst niemand.

revoke truncate, references, trigger on public.velonavi_fahrten from authenticated;
