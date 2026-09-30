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

    private static final String PREFS = "velotracker";
    private static final String AUTO = "auto";

    static SharedPreferences prefs(Context c) {
        return c.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    static boolean auto(Context c) {
        return prefs(c).getBoolean(AUTO, false);
    }

    static void setAuto(Context c, boolean an) {
        prefs(c).edit().putBoolean(AUTO, an).apply();
    }

    /** Fertige Fahrten, die die Seite noch nicht abgeholt hat. */
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
