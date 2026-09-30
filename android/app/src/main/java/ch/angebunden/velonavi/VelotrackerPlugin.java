package ch.angebunden.velonavi;

import android.Manifest;
import android.app.AlertDialog;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import androidx.activity.result.ActivityResult;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Die Brücke zwischen der Seite und dem Dienst, der im Hintergrund aufzeichnet.
 * Die Seite ruft sie als `Capacitor.Plugins.Velotracker` auf (`native.ts`).
 */
@CapacitorPlugin(
        name = "Velotracker",
        permissions = {
                @Permission(alias = "standort", strings = {Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION}),
                @Permission(alias = "hintergrund", strings = {Manifest.permission.ACCESS_BACKGROUND_LOCATION}),
                @Permission(alias = "bewegung", strings = {Manifest.permission.ACTIVITY_RECOGNITION}),
                @Permission(alias = "mitteilung", strings = {Manifest.permission.POST_NOTIFICATIONS}),
        })
public class VelotrackerPlugin extends Plugin {

    private boolean hat(String erlaubnis) {
        return ContextCompat.checkSelfPermission(getContext(), erlaubnis) == PackageManager.PERMISSION_GRANTED;
    }

    /** Was noch freizugeben ist. Erlaubnisse, die es auf dieser Android-Version nicht gibt, fehlen nie. */
    private List<String> fehlt(boolean auto) {
        List<String> f = new ArrayList<>();
        if (!hat(Manifest.permission.ACCESS_FINE_LOCATION)) f.add("standort");
        if (Build.VERSION.SDK_INT >= 33 && !hat(Manifest.permission.POST_NOTIFICATIONS)) f.add("mitteilung");
        if (auto) {
            if (Build.VERSION.SDK_INT >= 29 && !hat(Manifest.permission.ACCESS_BACKGROUND_LOCATION)) f.add("hintergrund");
            if (Build.VERSION.SDK_INT >= 29 && !hat(Manifest.permission.ACTIVITY_RECOGNITION)) f.add("bewegung");
        }
        return f;
    }

    private JSObject stand() {
        JSObject o = new JSObject();
        o.put("laeuft", Aufnahme.laeuft);
        o.put("auto", Aufnahme.auto(getContext()));
        o.put("alle", Aufnahme.alle(getContext()));
        android.content.SharedPreferences p = Aufnahme.prefs(getContext());
        o.put("bereitSeit", p.getLong("bereitSeit", 0));
        o.put("bereitFehler", p.getString("bereitFehler", ""));
        o.put("letzteArt", p.getString("letzteArt", ""));
        o.put("letzteBeginn", p.getBoolean("letzteBeginn", false));
        o.put("letzteZeit", p.getLong("letzteZeit", 0));
        o.put("hinweis", Aufnahme.hinweis);
        o.put("beginn", Aufnahme.beginn);
        o.put("distanz", Aufnahme.distanz);
        o.put("lon", Double.isNaN(Aufnahme.lon) ? null : Aufnahme.lon);
        o.put("lat", Double.isNaN(Aufnahme.lat) ? null : Aufnahme.lat);
        o.put("fehlt", new JSArray(fehlt(Aufnahme.auto(getContext()))));
        return o;
    }

    @PluginMethod
    public void status(PluginCall call) {
        call.resolve(stand());
    }

    @PluginMethod
    public void berechtigen(PluginCall call) {
        boolean auto = Boolean.TRUE.equals(call.getBoolean("auto", false));
        call.getData().put("_auto", auto);
        List<String> frage = new ArrayList<>();
        if (!hat(Manifest.permission.ACCESS_FINE_LOCATION)) frage.add("standort");
        if (Build.VERSION.SDK_INT >= 33 && !hat(Manifest.permission.POST_NOTIFICATIONS)) frage.add("mitteilung");
        if (auto && Build.VERSION.SDK_INT >= 29 && !hat(Manifest.permission.ACTIVITY_RECOGNITION)) frage.add("bewegung");
        if (frage.isEmpty()) {
            hintergrund(call);
        } else {
            requestPermissionForAliases(frage.toArray(new String[0]), call, "nachAnfrage");
        }
    }

    @PermissionCallback
    private void nachAnfrage(PluginCall call) {
        hintergrund(call);
    }

    /**
     * Standort im Hintergrund lässt sich erst fragen, wenn der Standort im
     * Vordergrund da ist, und ab Android 11 nur über die Einstellungen.
     */
    private void hintergrund(PluginCall call) {
        boolean auto = call.getData().optBoolean("_auto", false);
        if (auto && Build.VERSION.SDK_INT >= 29
                && hat(Manifest.permission.ACCESS_FINE_LOCATION)
                && !hat(Manifest.permission.ACCESS_BACKGROUND_LOCATION)) {
            if (Build.VERSION.SDK_INT >= 30) {
                getActivity().runOnUiThread(() -> new AlertDialog.Builder(getActivity())
                        .setTitle("Standort im Hintergrund")
                        .setMessage("Damit Fahrten von selbst aufgezeichnet werden, wähle unter Berechtigungen > Standort «Immer zulassen».")
                    .setCancelable(false)
                        .setPositiveButton("Einstellungen öffnen", (dialog, which) -> startActivityForResult(call,
                                new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                                        Uri.parse("package:" + getContext().getPackageName())), "nachEinstellungen"))
                        .setNegativeButton("Später", (dialog, which) -> antworten(call, auto))
                        .show());
            } else {
                requestPermissionForAlias("hintergrund", call, "nachHintergrund");
            }
        } else {
            antworten(call, auto);
        }
    }

    @ActivityCallback
    private void nachEinstellungen(PluginCall call, ActivityResult result) {
        antworten(call, call.getData().optBoolean("_auto", false));
    }

    @PermissionCallback
    private void nachHintergrund(PluginCall call) {
        antworten(call, call.getData().optBoolean("_auto", false));
    }

    private void antworten(PluginCall call, boolean auto) {
        JSObject o = new JSObject();
        o.put("fehlt", new JSArray(fehlt(auto)));
        call.resolve(o);
    }

    @PluginMethod
    public void start(PluginCall call) {
        if (!hat(Manifest.permission.ACCESS_FINE_LOCATION)) {
            call.reject("Standort nicht freigegeben");
            return;
        }
        Intent i = new Intent(getContext(), TrackerService.class).setAction(TrackerService.AKTION_START);
        String vorschlag = call.getString("vorschlag");
        if (vorschlag != null) i.putExtra(TrackerService.EXTRA_VORSCHLAG, vorschlag);
        ContextCompat.startForegroundService(getContext(), i);
        call.resolve();
    }

    @PluginMethod
    public void stop(PluginCall call) {
        if (Aufnahme.laeuft) {
            getContext().startService(new Intent(getContext(), TrackerService.class).setAction(TrackerService.AKTION_STOP));
        }
        call.resolve();
    }

    @PluginMethod
    public void auto(PluginCall call) {
        Context c = getContext();
        boolean aktiv = Boolean.TRUE.equals(call.getBoolean("aktiv", false));
        if (call.getData().has("alle")) Aufnahme.setAlle(c, Boolean.TRUE.equals(call.getBoolean("alle", false)));
        if (aktiv) {
            if (!AktivitaetReceiver.anmelden(c)) {
                call.reject("Bewegungserkennung nicht freigegeben");
                return;
            }
            Aufnahme.setAuto(c, true);
        } else {
            Aufnahme.setAuto(c, false);
            AktivitaetReceiver.abmelden(c);
        }
        call.resolve(stand());
    }

    @PluginMethod
    public void abholen(PluginCall call) {
        JSArray liste = new JSArray();
        File[] dateien = Aufnahme.fahrtenOrdner(getContext()).listFiles((d, name) -> name.endsWith(".json"));
        if (dateien != null) {
            Arrays.sort(dateien);
            // Zehn je Aufruf: Die Antwort geht als ein Stück über die Brücke.
            for (int i = 0; i < dateien.length && i < 10; i++) {
                try {
                    String roh = new String(Files.readAllBytes(dateien[i].toPath()), StandardCharsets.UTF_8);
                    liste.put(new JSONObject(roh));
                } catch (Exception e) {
                    /* Eine beschädigte Datei bleibt liegen und blockiert die anderen nicht. */
                }
            }
        }
        JSObject o = new JSObject();
        o.put("fahrten", liste);
        call.resolve(o);
    }

    /**
     * Legt eine GPX-Datei im Zwischenspeicher ab und öffnet das Teilen-Menü. Ein Herunterladen, wie
     * der Browser es kennt, gibt es im WebView der App nicht.
     */
    @PluginMethod
    public void gpxTeilen(PluginCall call) {
        try {
            String inhalt = call.getString("inhalt");
            String name = call.getString("name", "velonavi.gpx").replaceAll("[^A-Za-z0-9._-]", "_");
            if (inhalt == null || inhalt.isEmpty()) {
                call.reject("Keine Daten");
                return;
            }
            File ordner = new File(getContext().getCacheDir(), "gpx");
            ordner.mkdirs();
            File datei = new File(ordner, name);
            Files.write(datei.toPath(), inhalt.getBytes(StandardCharsets.UTF_8));
            android.net.Uri uri = androidx.core.content.FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", datei);
            Intent i = new Intent(Intent.ACTION_SEND)
                    .setType("application/gpx+xml")
                    .putExtra(Intent.EXTRA_STREAM, uri)
                    .putExtra(Intent.EXTRA_SUBJECT, name)
                    .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            Intent wahl = Intent.createChooser(i, "GPX-Datei teilen").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(wahl);
            call.resolve();
        } catch (Exception e) {
            call.reject("GPX konnte nicht geteilt werden");
        }
    }

    @PluginMethod
    public void quittieren(PluginCall call) {
        try {
            JSONArray ids = call.getData().getJSONArray("ids");
            File ordner = Aufnahme.fahrtenOrdner(getContext());
            for (int i = 0; i < ids.length(); i++) {
                String id = ids.getString(i);
                // Nur was wie eine UUID aussieht, damit keine fremden Pfade getroffen werden.
                if (id.matches("[0-9a-fA-F-]{36}")) new File(ordner, id + ".json").delete();
            }
            call.resolve();
        } catch (Exception e) {
            call.reject("Ungültige Angabe");
        }
    }
}
