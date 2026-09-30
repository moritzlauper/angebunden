package ch.angebunden.velonavi;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.location.Location;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;
import androidx.core.app.ServiceCompat;
import androidx.core.content.ContextCompat;
import com.google.android.gms.location.FusedLocationProviderClient;
import com.google.android.gms.location.LocationCallback;
import com.google.android.gms.location.LocationRequest;
import com.google.android.gms.location.LocationResult;
import com.google.android.gms.location.LocationServices;
import com.google.android.gms.location.Priority;
import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Zeichnet eine Fahrt auf, als Dienst im Vordergrund mit sichtbarer
 * Benachrichtigung. Er startet auf Knopfdruck oder, wenn die Erkennung von
 * Android eine Velofahrt meldet (`AktivitaetReceiver`), und endet von selbst,
 * wenn man sich längere Zeit nicht mehr bewegt.
 *
 * Die Punkte entstehen im Sekundentakt. Eine fertige Fahrt landet als Datei im
 * privaten Ordner der App und wartet dort, bis die Seite sie abholt. Nichts
 * verlässt das Gerät.
 */
public class TrackerService extends Service {
    static final String AKTION_START = "ch.angebunden.velonavi.START";
    static final String AKTION_AUTO = "ch.angebunden.velonavi.AUTO";
    static final String AKTION_STOP = "ch.angebunden.velonavi.STOP";
    static final String AKTION_ENDE = "ch.angebunden.velonavi.AKTIVITAET_ENDE";
    static final String EXTRA_VORSCHLAG = "vorschlag";
    static final String EXTRA_HINWEIS = "hinweis";

    private static final String KANAL_LAUFEND = "aufzeichnung";
    private static final String KANAL_FERTIG = "fertig";
    private static final int ID_LAUFEND = 1;
    private static final int ID_FERTIG = 2;

    /** Ungenauere Standorte (Mobilfunkzelle statt GPS) kommen nicht in die Spur. */
    private static final float GENAU_MAX = 60f;
    /** Gezählt wird erst ab so vielen Metern Abstand zum letzten gezählten Punkt. */
    private static final double SCHRITT_M = 25;
    /** Bewegung heisst: so weit vom letzten Ruhepunkt weg. */
    private static final double BEWEGT_M = 15;
    private static final long LEERLAUF_AUTO_MS = 5 * 60_000L;
    private static final long LEERLAUF_MANUELL_MS = 20 * 60_000L;
    private static final long LEERLAUF_NACH_AKTIVITAET_MS = 90_000L;
    /** Eine von selbst erkannte Fahrt muss mindestens so lang sein, sonst war es etwas anderes. */
    private static final double AUTO_MIN_DISTANZ_M = 300;
    private static final long AUTO_MIN_DAUER_MS = 120_000L;
    /** Schneller als das im Mittel gibt es für die jeweilige Art der Bewegung nicht (Velo 43 km/h, zu Fuss 22 km/h). */
    private static double maxMittel(String hinweis) {
        if ("velo".equals(hinweis)) return 12;
        if ("gehen".equals(hinweis) || "laufen".equals(hinweis)) return 6;
        return 50;
    }

    private FusedLocationProviderClient client;
    private LocationCallback callback;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final List<double[]> punkte = new ArrayList<>();

    private String id;
    private String quelle = "aufzeichnung";
    private String vorschlag;
    private String hinweis = "";
    private long beginn;
    private double distanz;
    private double zaehlLon = Double.NaN, zaehlLat = Double.NaN;
    private double ruheLon = Double.NaN, ruheLat = Double.NaN;
    private long letzteBewegung;
    private boolean aktivitaetEnde;
    private long aktivitaetEndeZeit;
    private boolean aktiv = false;

    private final Runnable pruefer = new Runnable() {
        @Override
        public void run() {
            if (!aktiv) return;
            long jetzt = System.currentTimeMillis();
            long grenze = aktivitaetEnde
                    ? LEERLAUF_NACH_AKTIVITAET_MS
                    : "auto".equals(quelle) ? LEERLAUF_AUTO_MS : LEERLAUF_MANUELL_MS;
            long seit = aktivitaetEnde ? Math.max(letzteBewegung, aktivitaetEndeZeit) : letzteBewegung;
            if (jetzt - seit > grenze) {
                beenden();
                return;
            }
            handler.postDelayed(this, 15_000);
        }
    };

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String aktion = intent == null ? null : intent.getAction();
        if (AKTION_STOP.equals(aktion)) {
            if (aktiv) beenden();
            else stopSelf();
            return START_NOT_STICKY;
        }
        if (AKTION_ENDE.equals(aktion)) {
            // Android hält die Velofahrt für beendet. Bewegt man sich gleich weiter, läuft es weiter.
            melden();
            if (aktiv) {
                aktivitaetEnde = true;
                aktivitaetEndeZeit = System.currentTimeMillis();
            } else {
                stopSelf();
            }
            return START_STICKY;
        }
        if (aktiv) {
            String neu = AKTION_AUTO.equals(aktion) ? intent.getStringExtra(EXTRA_HINWEIS) : null;
            if (neu == null || neu.equals(hinweis)) {
                melden();
                return START_STICKY;
            }
            // Eine andere Art der Bewegung beginnt, etwa Velo nach dem Tram: der Abschnitt davor ist zu Ende.
            abschliessen();
        }
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
            melden();
            stopSelf();
            return START_NOT_STICKY;
        }
        if (aktion == null && !wiederaufnehmen()) {
            // Das System hat den Dienst neu gestartet, es gibt aber nichts Frisches fortzusetzen.
            melden();
            stopSelf();
            return START_NOT_STICKY;
        }
        if (aktion != null) {
            id = UUID.randomUUID().toString();
            quelle = AKTION_AUTO.equals(aktion) ? "auto" : "aufzeichnung";
            vorschlag = intent.getStringExtra(EXTRA_VORSCHLAG);
            String h = intent.getStringExtra(EXTRA_HINWEIS);
            hinweis = h == null ? "" : h;
            Aufnahme.hinweis = hinweis;
            beginn = System.currentTimeMillis();
            punkte.clear();
            distanz = 0;
            zaehlLon = zaehlLat = ruheLon = ruheLat = Double.NaN;
        }
        aktivitaetEnde = false;
        letzteBewegung = System.currentTimeMillis();
        melden();
        starten();
        return START_STICKY;
    }

    /** Die Benachrichtigung, die einen Dienst im Vordergrund ausweist. */
    private void melden() {
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= 26) {
            nm.createNotificationChannel(new NotificationChannel(KANAL_LAUFEND, "Aufzeichnung läuft", NotificationManager.IMPORTANCE_LOW));
            nm.createNotificationChannel(new NotificationChannel(KANAL_FERTIG, "Gespeicherte Fahrten", NotificationManager.IMPORTANCE_LOW));
        }
        Intent stop = new Intent(this, TrackerService.class).setAction(AKTION_STOP);
        PendingIntent beenden = PendingIntent.getService(this, 0, stop, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        PendingIntent oeffnen = PendingIntent.getActivity(
                this, 0, new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification n = new NotificationCompat.Builder(this, KANAL_LAUFEND)
                .setSmallIcon(android.R.drawable.ic_menu_directions)
                .setContentTitle("Velonavi zeichnet die Fahrt auf")
                .setContentText("Der Standort bleibt auf diesem Gerät.")
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setContentIntent(oeffnen)
                .addAction(0, "Beenden", beenden)
                .build();
        if (Build.VERSION.SDK_INT >= 29) {
            ServiceCompat.startForeground(this, ID_LAUFEND, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION);
        } else {
            startForeground(ID_LAUFEND, n);
        }
    }

    private void starten() {
        aktiv = true;
        Aufnahme.laeuft = true;
        Aufnahme.beginn = beginn;
        Aufnahme.distanz = distanz;
        client = LocationServices.getFusedLocationProviderClient(this);
        callback = new LocationCallback() {
            @Override
            public void onLocationResult(LocationResult r) {
                for (Location l : r.getLocations()) punkt(l);
            }
        };
        LocationRequest anfrage = new LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, 1000)
                .setMinUpdateIntervalMillis(800)
                .build();
        try {
            client.requestLocationUpdates(anfrage, callback, Looper.getMainLooper());
        } catch (SecurityException e) {
            beenden();
            return;
        }
        handler.removeCallbacks(pruefer);
        handler.postDelayed(pruefer, 15_000);
    }

    private void punkt(Location l) {
        if (!aktiv) return;
        if (l.hasAccuracy() && l.getAccuracy() > GENAU_MAX) return;
        double lon = l.getLongitude();
        double lat = l.getLatitude();
        double t = (l.getTime() - beginn) / 1000.0;
        if (!punkte.isEmpty() && t - punkte.get(punkte.size() - 1)[2] < 0.9) return;
        punkte.add(new double[] {lon, lat, t, l.hasAccuracy() ? l.getAccuracy() : 0});
        if (Double.isNaN(zaehlLon)) {
            zaehlLon = lon;
            zaehlLat = lat;
            ruheLon = lon;
            ruheLat = lat;
        }
        double schritt = meter(zaehlLon, zaehlLat, lon, lat);
        if (schritt >= SCHRITT_M) {
            distanz += schritt;
            zaehlLon = lon;
            zaehlLat = lat;
        }
        if (meter(ruheLon, ruheLat, lon, lat) >= BEWEGT_M) {
            ruheLon = lon;
            ruheLat = lat;
            letzteBewegung = System.currentTimeMillis();
            // Wer sich nach dem Ende der Velofahrt doch weiterbewegt, fährt noch.
            aktivitaetEnde = false;
        }
        Aufnahme.distanz = distanz;
        Aufnahme.lon = lon;
        Aufnahme.lat = lat;
        if (punkte.size() % 30 == 0) sichern();
    }

    /** Luftlinie in Metern, gut genug für die Distanz von Punkt zu Punkt. */
    private static double meter(double lon0, double lat0, double lon1, double lat1) {
        double mx = 111320 * Math.cos(Math.toRadians(lat0));
        return Math.hypot((lon1 - lon0) * mx, (lat1 - lat0) * 111133);
    }

    private JSONObject alsJson() throws Exception {
        JSONArray spur = new JSONArray();
        for (double[] p : punkte) {
            JSONArray a = new JSONArray();
            a.put(Math.round(p[0] * 1e6) / 1e6);
            a.put(Math.round(p[1] * 1e6) / 1e6);
            a.put(Math.round(p[2] * 10) / 10.0);
            a.put(Math.round(p[3]));
            spur.put(a);
        }
        JSONObject o = new JSONObject();
        o.put("id", id);
        o.put("beginn", beginn);
        o.put("quelle", quelle);
        if (vorschlag != null) o.put("vorschlag", vorschlag);
        if (!hinweis.isEmpty()) o.put("hinweis", hinweis);
        o.put("spur", spur);
        return o;
    }

    private static void schreiben(File ziel, String inhalt) throws Exception {
        File tmp = new File(ziel.getPath() + ".tmp");
        try (FileOutputStream out = new FileOutputStream(tmp)) {
            out.write(inhalt.getBytes(StandardCharsets.UTF_8));
            out.getFD().sync();
        }
        if (!tmp.renameTo(ziel)) throw new Exception("Datei liess sich nicht ablegen");
    }

    /** Zwischenstand, falls das System den Dienst beendet. */
    private void sichern() {
        try {
            schreiben(Aufnahme.laufendDatei(this), alsJson().toString());
        } catch (Exception ignoriert) {
            /* Der nächste Versuch kommt in dreissig Sekunden. */
        }
    }

    private boolean wiederaufnehmen() {
        File f = Aufnahme.laufendDatei(this);
        if (!f.exists()) return false;
        try {
            byte[] roh = java.nio.file.Files.readAllBytes(f.toPath());
            JSONObject o = new JSONObject(new String(roh, StandardCharsets.UTF_8));
            JSONArray spur = o.getJSONArray("spur");
            if (spur.length() == 0) return false;
            JSONArray letzter = spur.getJSONArray(spur.length() - 1);
            long beginnAlt = o.getLong("beginn");
            // Nur fortsetzen, was in den letzten zehn Minuten noch lief.
            if (System.currentTimeMillis() - (beginnAlt + (long) (letzter.getDouble(2) * 1000)) > 10 * 60_000L) return false;
            id = o.getString("id");
            quelle = o.optString("quelle", "aufzeichnung");
            vorschlag = o.has("vorschlag") ? o.getString("vorschlag") : null;
            hinweis = o.optString("hinweis", "");
            Aufnahme.hinweis = hinweis;
            beginn = beginnAlt;
            punkte.clear();
            for (int i = 0; i < spur.length(); i++) {
                JSONArray a = spur.getJSONArray(i);
                punkte.add(new double[] {a.getDouble(0), a.getDouble(1), a.getDouble(2), a.getDouble(3)});
            }
            distanz = 0;
            zaehlLon = zaehlLat = Double.NaN;
            for (double[] p : punkte) {
                if (Double.isNaN(zaehlLon)) {
                    zaehlLon = p[0];
                    zaehlLat = p[1];
                } else if (meter(zaehlLon, zaehlLat, p[0], p[1]) >= SCHRITT_M) {
                    distanz += meter(zaehlLon, zaehlLat, p[0], p[1]);
                    zaehlLon = p[0];
                    zaehlLat = p[1];
                }
            }
            ruheLon = letzter.getDouble(0);
            ruheLat = letzter.getDouble(1);
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    /** Schliesst den laufenden Abschnitt ab und legt ihn ab, wenn er etwas taugt. Der Dienst läuft weiter. */
    private void abschliessen() {
        if (!aktiv) return;
        aktiv = false;
        handler.removeCallbacks(pruefer);
        if (client != null && callback != null) client.removeLocationUpdates(callback);
        boolean brauchbar = punkte.size() >= 10 && distanz >= 150;
        long dauerMs = punkte.isEmpty() ? 0 : (long) (punkte.get(punkte.size() - 1)[2] * 1000);
        if ("auto".equals(quelle)) {
            brauchbar = brauchbar
                    && distanz >= AUTO_MIN_DISTANZ_M
                    && dauerMs >= AUTO_MIN_DAUER_MS
                    && distanz / Math.max(dauerMs / 1000.0, 1) <= maxMittel(hinweis);
        }
        if (brauchbar) {
            try {
                schreiben(new File(Aufnahme.fahrtenOrdner(this), id + ".json"), alsJson().toString());
                // Nur Velofahrten melden die Benachrichtigung, sonst käme sie bei jedem Gang zum Bus.
                if ("auto".equals(quelle) && "velo".equals(hinweis)) gespeichertMelden(dauerMs);
            } catch (Exception e) {
                brauchbar = false;
            }
        }
        Aufnahme.laufendDatei(this).delete();
        Aufnahme.laeuft = false;
        Aufnahme.distanz = 0;
        Aufnahme.lon = Double.NaN;
        Aufnahme.lat = Double.NaN;
        Aufnahme.hinweis = "";
        punkte.clear();
    }

    /** Beendet die Aufzeichnung ganz: abschliessen, Benachrichtigung weg, Dienst stoppen. */
    private void beenden() {
        abschliessen();
        stopForeground(STOP_FOREGROUND_REMOVE);
        stopSelf();
    }

    private void gespeichertMelden(long dauerMs) {
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        PendingIntent oeffnen = PendingIntent.getActivity(
                this, 0, new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        String text = String.format(java.util.Locale.US, "%.1f km in %d Min. Zum Auswerten öffnen.", distanz / 1000, Math.max(1, dauerMs / 60000));
        Notification n = new NotificationCompat.Builder(this, KANAL_FERTIG)
                .setSmallIcon(android.R.drawable.ic_menu_directions)
                .setContentTitle("Velofahrt gespeichert")
                .setContentText(text)
                .setAutoCancel(true)
                .setContentIntent(oeffnen)
                .build();
        try {
            nm.notify(ID_FERTIG, n);
        } catch (SecurityException ignoriert) {
            /* Ohne Erlaubnis für Mitteilungen bleibt es still. */
        }
    }

    @Override
    public void onDestroy() {
        handler.removeCallbacks(pruefer);
        if (aktiv) {
            // Das System beendet den Dienst: Zwischenstand sichern, der Neustart setzt fort.
            sichern();
            if (client != null && callback != null) client.removeLocationUpdates(callback);
            Aufnahme.laeuft = false;
        }
        super.onDestroy();
    }
}
