package ch.angebunden.velonavi;

import android.content.Context;
import android.content.SharedPreferences;
import java.io.File;

/**
 * Was Dienst und Plugin gemeinsam wissen: der Stand der laufenden Aufzeichnung,
 * der Schalter für die automatische Erkennung und der Ordner mit den fertigen
 * Fahrten. Der Dienst schickt nichts ins Netz.
 */
final class Aufnahme {
    private Aufnahme() {}

    // Vom Dienst geschrieben, vom Plugin gelesen.
    static volatile boolean laeuft = false;
    static volatile long beginn = 0;
    static volatile double distanz = 0;
    static volatile double lon = Double.NaN;
    static volatile double lat = Double.NaN;
    /** Womit die laufende Aufzeichnung begann: velo, gehen, laufen, fahrzeug. Leer bei einem Start per Knopf. */
    static volatile String hinweis = "";

    private static final String PREFS = "velotracker";
    private static final String AUTO = "auto";
    private static final String ALLE = "alle";

    static SharedPreferences prefs(Context c) {
        return c.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    static boolean auto(Context c) {
        return prefs(c).getBoolean(AUTO, false);
    }

    static void setAuto(Context c, boolean an) {
        prefs(c).edit().putBoolean(AUTO, an).apply();
    }

    /** Ob die automatische Erkennung auch Gehen, Joggen und Fahrzeuge aufzeichnet, nicht nur Velofahrten. */
    static boolean alle(Context c) {
        return prefs(c).getBoolean(ALLE, false);
    }

    static void setAlle(Context c, boolean an) {
        prefs(c).edit().putBoolean(ALLE, an).apply();
    }

    /** Fertige Fahrten, die die Seite noch nicht abgeholt hat. */
    /** Die Erkennung ist angemeldet: seit wann, oder warum nicht. */
    static void setBereit(Context c, boolean bereit, String fehler) {
        prefs(c).edit()
                .putLong("bereitSeit", bereit ? System.currentTimeMillis() : 0)
                .putString("bereitFehler", fehler == null ? "" : fehler)
                .apply();
    }

    /** Die letzte Meldung der Bewegungserkennung, auch wenn daraus keine Aufzeichnung wurde. */
    static void setLetzteMeldung(Context c, String art, boolean beginn) {
        prefs(c).edit()
                .putString("letzteArt", art)
                .putBoolean("letzteBeginn", beginn)
                .putLong("letzteZeit", System.currentTimeMillis())
                .apply();
    }

    /**
     * Hält fest, was zuletzt schiefging: ein Absturz der App, der Seite oder des Dienstes. Die Seite
     * zeigt es beim nächsten Öffnen an (`VelotrackerPlugin.panne`). Synchron geschrieben, weil der
     * Prozess nach einem Absturz gleich endet.
     */
    static void setPanne(Context c, String was) {
        prefs(c).edit().putString("panne", was).putLong("panneZeit", System.currentTimeMillis()).commit();
    }

    private static volatile boolean wache = false;

    /** Merkt sich unbehandelte Ausnahmen, bevor Android den Prozess beendet. Einmal je Prozess. */
    static synchronized void absturzMerken(Context c) {
        if (wache) return;
        wache = true;
        final Context app = c.getApplicationContext();
        final Thread.UncaughtExceptionHandler vorher = Thread.getDefaultUncaughtExceptionHandler();
        Thread.setDefaultUncaughtExceptionHandler((t, e) -> {
            try {
                // Eine Panne von eben (etwa ein abgelehnter Dienst im Vordergrund) ist meist die Ursache: behalten.
                SharedPreferences p = prefs(app);
                String vorige = System.currentTimeMillis() - p.getLong("panneZeit", 0) < 30_000 ? p.getString("panne", "") : "";
                setPanne(app, (vorige.isEmpty() ? "" : vorige + " Danach ") + "Absturz: " + kurz(e));
            } catch (Throwable ignoriert) {
                /* Nichts darf den eigentlichen Absturz verdecken. */
            }
            if (vorher != null) vorher.uncaughtException(t, e);
        });
    }

    /** Art, Meldung und die erste Stelle im eigenen Code, gut genug, um den Fehler zu finden. */
    static String kurz(Throwable e) {
        Throwable wurzel = e;
        while (wurzel.getCause() != null && wurzel.getCause() != wurzel) wurzel = wurzel.getCause();
        StringBuilder b = new StringBuilder(wurzel.getClass().getSimpleName());
        if (wurzel.getMessage() != null) b.append(": ").append(wurzel.getMessage());
        for (StackTraceElement s : wurzel.getStackTrace()) {
            if (s.getClassName().startsWith("ch.angebunden")) {
                b.append(" (").append(s.getFileName()).append(':').append(s.getLineNumber()).append(')');
                break;
            }
        }
        return b.length() > 400 ? b.substring(0, 400) : b.toString();
    }

    private static final int PROTOKOLL_MAX = 40;

    /**
     * Hält fest, was die automatische Aufzeichnung tut: was Android meldet, wann sie startet und warum
     * eine Fahrt gespeichert oder verworfen wird. Die Seite zeigt die letzten Einträge im Menü, damit
     * sich sehen lässt, wo eine Fahrt verloren ging.
     */
    static synchronized void notiere(Context c, String text) {
        try {
            SharedPreferences p = prefs(c);
            org.json.JSONArray alt;
            try {
                alt = new org.json.JSONArray(p.getString("protokoll", "[]"));
            } catch (Exception e) {
                alt = new org.json.JSONArray();
            }
            org.json.JSONArray neu = new org.json.JSONArray();
            for (int i = Math.max(0, alt.length() - (PROTOKOLL_MAX - 1)); i < alt.length(); i++) neu.put(alt.opt(i));
            org.json.JSONObject o = new org.json.JSONObject();
            o.put("t", System.currentTimeMillis());
            o.put("text", text);
            neu.put(o);
            p.edit().putString("protokoll", neu.toString()).apply();
        } catch (Exception ignoriert) {
            /* Das Protokoll ist eine Hilfe, kein Grund für einen Fehler. */
        }
    }

    static String protokoll(Context c) {
        return prefs(c).getString("protokoll", "[]");
    }

    static File fahrtenOrdner(Context c) {
        File d = new File(c.getFilesDir(), "fahrten");
        if (!d.exists()) d.mkdirs();
        return d;
    }

    /** Die laufende Aufzeichnung, damit sie einen Neustart des Dienstes überlebt. */
    static File laufendDatei(Context c) {
        return new File(c.getFilesDir(), "laufend.json");
    }
}
