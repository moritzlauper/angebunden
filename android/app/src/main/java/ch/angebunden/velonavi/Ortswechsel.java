package ch.angebunden.velonavi;

import android.Manifest;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.location.Location;
import android.os.Build;
import androidx.annotation.Nullable;
import androidx.core.content.ContextCompat;
import com.google.android.gms.location.Geofence;
import com.google.android.gms.location.GeofencingEvent;
import com.google.android.gms.location.GeofencingRequest;
import com.google.android.gms.location.LocationServices;
import com.google.android.gms.location.Priority;

/**
 * Der zweite Auslöser für das automatische Aufzeichnen, neben der Bewegungserkennung.
 *
 * Die Bewegungserkennung von Android meldet Velofahrten oft spät oder gar nicht, besonders mit dem
 * Handy in der Tasche. Zuverlässig und sparsam meldet Android dagegen, wenn man einen Ort verlässt.
 * Die App legt deshalb einen Kreis von 120 Metern um den Ort, an dem man zuletzt war. Verlässt man
 * ihn, startet die Aufzeichnung zur Probe: Kommt man in vier Minuten nie auf Velotempo, endet sie
 * wieder (`TrackerService`), und der Kreis liegt neu um den Ort, an dem man dann ist.
 */
public class Ortswechsel extends BroadcastReceiver {
    static final float RADIUS_M = 120;
    /** Nach einer Probe, die nur Gehen fand: Sonst begänne auf einem langen Spaziergang alle paar Minuten eine neue. */
    static final float RADIUS_ZU_FUSS_M = 300;
    private static final String KENNUNG = "zuletzt";

    private static PendingIntent absender(Context c) {
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        // Android trägt das Ereignis in die Absicht ein: veränderlich.
        if (Build.VERSION.SDK_INT >= 31) flags |= PendingIntent.FLAG_MUTABLE;
        return PendingIntent.getBroadcast(c, 1, new Intent(c, Ortswechsel.class), flags);
    }

    private static boolean darf(Context c) {
        if (ContextCompat.checkSelfPermission(c, Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) return false;
        return Build.VERSION.SDK_INT < 29
                || ContextCompat.checkSelfPermission(c, Manifest.permission.ACCESS_BACKGROUND_LOCATION) == PackageManager.PERMISSION_GRANTED;
    }

    /** Legt den Kreis um `wo`, ohne Ort um den letzten bekannten Standort. Nur bei eingeschaltetem automatischem Aufzeichnen. */
    static void scharf(Context c, @Nullable Location wo) {
        scharf(c, wo, RADIUS_M);
    }

    static void scharf(Context c, @Nullable Location wo, float radius) {
        final Context app = c.getApplicationContext();
        if (!Aufnahme.auto(app)) return;
        if (!darf(app)) {
            Aufnahme.notiere(app, "Ortswechsel aus: Standort «Immer zulassen» fehlt");
            return;
        }
        if (wo != null) {
            setzen(app, wo, radius);
            return;
        }
        try {
            com.google.android.gms.location.FusedLocationProviderClient f = LocationServices.getFusedLocationProviderClient(app);
            f.getLastLocation().addOnSuccessListener(l -> {
                if (l != null) {
                    setzen(app, l, radius);
                    return;
                }
                try {
                    f.getCurrentLocation(Priority.PRIORITY_BALANCED_POWER_ACCURACY, null).addOnSuccessListener(l2 -> {
                        if (l2 != null) setzen(app, l2, radius);
                    });
                } catch (SecurityException ignoriert) {
                    /* Freigabe inzwischen weg. */
                }
            });
        } catch (SecurityException ignoriert) {
            /* Freigabe inzwischen weg. */
        }
    }

    private static void setzen(Context c, Location l, float radius) {
        Geofence kreis = new Geofence.Builder()
                .setRequestId(KENNUNG)
                .setCircularRegion(l.getLatitude(), l.getLongitude(), radius)
                .setExpirationDuration(Geofence.NEVER_EXPIRE)
                .setTransitionTypes(Geofence.GEOFENCE_TRANSITION_EXIT)
                .build();
        // Kein Auslösen beim Anlegen: Man steht ja gerade darin.
        GeofencingRequest anfrage = new GeofencingRequest.Builder().setInitialTrigger(0).addGeofence(kreis).build();
        try {
            LocationServices.getGeofencingClient(c).addGeofences(anfrage, absender(c))
                    .addOnFailureListener(e -> Aufnahme.notiere(c, "Ort liess sich nicht merken: " + e.getMessage()));
        } catch (SecurityException e) {
            Aufnahme.notiere(c, "Ort liess sich nicht merken: keine Freigabe");
        }
    }

    static void aus(Context c) {
        try {
            LocationServices.getGeofencingClient(c).removeGeofences(absender(c));
        } catch (SecurityException ignoriert) {
            /* Nichts gemerkt, nichts zu entfernen. */
        }
    }

    @Override
    public void onReceive(Context c, Intent intent) {
        GeofencingEvent ereignis = GeofencingEvent.fromIntent(intent);
        if (ereignis == null || ereignis.hasError() || ereignis.getGeofenceTransition() != Geofence.GEOFENCE_TRANSITION_EXIT) return;
        if (!Aufnahme.auto(c) || Aufnahme.laeuft) return;
        Aufnahme.notiere(c, "Ort verlassen, Aufzeichnung startet zur Probe");
        try {
            ContextCompat.startForegroundService(c, new Intent(c, TrackerService.class).setAction(TrackerService.AKTION_AUTO));
        } catch (RuntimeException e) {
            Aufnahme.notiere(c, "Aufzeichnung liess sich nicht starten: " + Aufnahme.kurz(e));
        }
    }
}
