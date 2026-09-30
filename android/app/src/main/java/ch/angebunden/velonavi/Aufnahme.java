package ch.angebunden.velonavi;

import android.content.Context;
import android.content.SharedPreferences;
import java.io.File;

/**
 * Was Dienst und Plugin gemeinsam wissen: der Stand der laufenden Aufzeichnung,
 * der Schalter für die automatische Erkennung und der Ordner mit den fertigen
 * Fahrten. Alles bleibt auf dem Gerät.
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
