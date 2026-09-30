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
        List<ActivityTransition> t = new ArrayList<>();
        t.add(new ActivityTransition.Builder()
                .setActivityType(DetectedActivity.ON_BICYCLE)
                .setActivityTransition(ActivityTransition.ACTIVITY_TRANSITION_ENTER)
                .build());
        t.add(new ActivityTransition.Builder()
                .setActivityType(DetectedActivity.ON_BICYCLE)
                .setActivityTransition(ActivityTransition.ACTIVITY_TRANSITION_EXIT)
                .build());
        try {
            ActivityRecognition.getClient(c).requestActivityTransitionUpdates(new ActivityTransitionRequest(t), absender(c));
            return true;
        } catch (SecurityException e) {
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

    @Override
    public void onReceive(Context c, Intent intent) {
        if (!ActivityTransitionResult.hasResult(intent) || !Aufnahme.auto(c)) return;
        ActivityTransitionResult r = ActivityTransitionResult.extractResult(intent);
        if (r == null) return;
        for (ActivityTransitionEvent e : r.getTransitionEvents()) {
            if (e.getActivityType() != DetectedActivity.ON_BICYCLE) continue;
            if (e.getTransitionType() == ActivityTransition.ACTIVITY_TRANSITION_ENTER) {
                if (!Aufnahme.laeuft) {
                    ContextCompat.startForegroundService(c, new Intent(c, TrackerService.class).setAction(TrackerService.AKTION_AUTO));
                }
            } else if (Aufnahme.laeuft) {
                ContextCompat.startForegroundService(c, new Intent(c, TrackerService.class).setAction(TrackerService.AKTION_ENDE));
            }
        }
    }
}
