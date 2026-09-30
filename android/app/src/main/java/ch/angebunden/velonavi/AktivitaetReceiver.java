package ch.angebunden.velonavi;

import android.Manifest;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import androidx.core.content.ContextCompat;
import com.google.android.gms.location.ActivityRecognition;
import com.google.android.gms.location.ActivityTransition;
import com.google.android.gms.location.ActivityTransitionEvent;
import com.google.android.gms.location.ActivityTransitionRequest;
import com.google.android.gms.location.ActivityTransitionResult;
import com.google.android.gms.location.DetectedActivity;
import java.util.ArrayList;
import java.util.List;

/**
 * Hört auf die Bewegungserkennung von Android. Sie meldet, wenn man aufs Velo
 * steigt und wieder absteigt, ohne dass die App läuft und ohne den Standort
 * einzuschalten, das kostet kaum Akku. Erst dann startet der Dienst.
 *
 * Dass ein Dienst im Hintergrund starten darf, ist bei einer solchen Meldung
 * ausdrücklich erlaubt. Den Standort «immer» braucht er trotzdem.
 */
public class AktivitaetReceiver extends BroadcastReceiver {

    private static PendingIntent absender(Context c) {
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        // Die Bewegungserkennung trägt ihr Ergebnis in die Absicht ein: veränderlich.
        if (Build.VERSION.SDK_INT >= 31) flags |= PendingIntent.FLAG_MUTABLE;
        return PendingIntent.getBroadcast(c, 0, new Intent(c, AktivitaetReceiver.class), flags);
    }

    /** Meldet Velofahrten an. Wirft nichts, wenn die Freigabe fehlt: Dann bleibt die Erkennung aus. */
    static boolean anmelden(Context c) {
        if (Build.VERSION.SDK_INT >= 29
                && ContextCompat.checkSelfPermission(c, Manifest.permission.ACTIVITY_RECOGNITION) != PackageManager.PERMISSION_GRANTED) {
            return false;
        }
        // Alle vier Arten melden sich, damit die Seite zeigen kann, dass die Erkennung lebt. Aufgezeichnet
        // werden Velofahrten immer und Gehen, Joggen und Fahrzeuge nur auf Wunsch (siehe onReceive).
        List<Integer> arten = new ArrayList<>();
        arten.add(DetectedActivity.ON_BICYCLE);
        arten.add(DetectedActivity.WALKING);
        arten.add(DetectedActivity.RUNNING);
        arten.add(DetectedActivity.IN_VEHICLE);
        List<ActivityTransition> t = new ArrayList<>();
        for (int art : arten) {
            t.add(new ActivityTransition.Builder().setActivityType(art)
                    .setActivityTransition(ActivityTransition.ACTIVITY_TRANSITION_ENTER).build());
            t.add(new ActivityTransition.Builder().setActivityType(art)
                    .setActivityTransition(ActivityTransition.ACTIVITY_TRANSITION_EXIT).build());
        }
        try {
            final Context app = c.getApplicationContext();
            ActivityRecognition.getClient(c).requestActivityTransitionUpdates(new ActivityTransitionRequest(t), absender(c))
                    .addOnSuccessListener(x -> Aufnahme.setBereit(app, true, null))
                    .addOnFailureListener(e -> Aufnahme.setBereit(app, false, String.valueOf(e.getMessage())));
            return true;
        } catch (SecurityException e) {
            Aufnahme.setBereit(c, false, "Keine Freigabe für die Bewegungserkennung");
            return false;
        }
    }

    static void abmelden(Context c) {
        try {
            ActivityRecognition.getClient(c).removeActivityTransitionUpdates(absender(c));
        } catch (SecurityException ignoriert) {
            /* Nichts angemeldet, nichts abzumelden. */
        }
    }

    /** Der Hinweis, den der Dienst in die Fahrt schreibt. */
    static String hinweisVon(int art) {
        switch (art) {
            case DetectedActivity.ON_BICYCLE: return "velo";
            case DetectedActivity.WALKING: return "gehen";
            case DetectedActivity.RUNNING: return "laufen";
            case DetectedActivity.IN_VEHICLE: return "fahrzeug";
            default: return null;
        }
    }

    @Override
    public void onReceive(Context c, Intent intent) {
        if (!ActivityTransitionResult.hasResult(intent) || !Aufnahme.auto(c)) return;
        ActivityTransitionResult r = ActivityTransitionResult.extractResult(intent);
        if (r == null) return;
        for (ActivityTransitionEvent e : r.getTransitionEvents()) {
            String hinweis = hinweisVon(e.getActivityType());
            if (hinweis == null) continue;
            boolean beginn = e.getTransitionType() == ActivityTransition.ACTIVITY_TRANSITION_ENTER;
            Aufnahme.setLetzteMeldung(c, hinweis, beginn);
            // Velofahrten werden immer aufgezeichnet, alles andere nur mit der Option «Auch Gehen, Joggen, Tram und Auto».
            if (!"velo".equals(hinweis) && !Aufnahme.alle(c)) continue;
            if (beginn) {
                // Eine andere Art der Bewegung beginnt: Der Dienst schliesst den Abschnitt davor ab und startet einen neuen.
                if (!Aufnahme.laeuft || !hinweis.equals(Aufnahme.hinweis)) {
                    ContextCompat.startForegroundService(c, new Intent(c, TrackerService.class)
                            .setAction(TrackerService.AKTION_AUTO)
                            .putExtra(TrackerService.EXTRA_HINWEIS, hinweis));
                }
            } else if (Aufnahme.laeuft && hinweis.equals(Aufnahme.hinweis)) {
                ContextCompat.startForegroundService(c, new Intent(c, TrackerService.class).setAction(TrackerService.AKTION_ENDE));
            }
        }
    }
}
