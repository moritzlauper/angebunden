package ch.angebunden.velonavi;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** Nach einem Neustart oder einer Aktualisierung die Erkennung wieder anmelden, wenn sie eingeschaltet war. */
public class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context c, Intent intent) {
        if (Aufnahme.auto(c)) AktivitaetReceiver.anmelden(c);
    }
}
