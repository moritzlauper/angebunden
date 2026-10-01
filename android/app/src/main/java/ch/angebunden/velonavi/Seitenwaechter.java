package ch.angebunden.velonavi;

import android.content.Context;
import android.net.Uri;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeWebViewClient;

/**
 * Passt auf, dass die Seite geladen bleibt. Scheitert das Laden der Seite selbst (nicht eines
 * Bildes), zeigte die App bisher die Fehlerseite von Android, «This page couldn't load», und
 * man kam nur durch Neustarten weiter. Jetzt:
 *
 * - Die App merkt sich Adresse, Fehler und Code. Die Seite zeigt es beim nächsten Laden einmal an
 *   (`Aufnahme.setPanne`), damit sich die Ursache finden lässt.
 * - Sie lädt die Seite nach einer Sekunde neu, höchstens zweimal in einer Minute. Erst danach
 *   kommt die eigene Seite «Keine Verbindung» (`android-web/offline.html`).
 * - Scheitert auch diese, versucht Capacitor sie nicht endlos wieder.
 */
class Seitenwaechter extends BridgeWebViewClient {
    private static final int VERSUCHE = 2;
    private static final long FENSTER_MS = 60_000;

    private final Bridge bridge;
    private final Context context;
    private int versuche = 0;
    private long seit = 0;

    Seitenwaechter(Bridge bridge, Context context) {
        super(bridge);
        this.bridge = bridge;
        this.context = context.getApplicationContext();
    }

    private static String kurz(Uri u) {
        String s = u.toString();
        return s.length() > 160 ? s.substring(0, 160) + "…" : s;
    }

    /** Ob noch ein Versuch frei ist. */
    private boolean nochEinmal() {
        long jetzt = System.currentTimeMillis();
        if (jetzt - seit > FENSTER_MS) {
            seit = jetzt;
            versuche = 0;
        }
        return versuche++ < VERSUCHE;
    }

    /** Lädt dieselbe Adresse neu, wenn sie zur Seite gehört, sonst den Anfang der App. */
    private void neuLaden(WebView view, Uri url) {
        Uri app = Uri.parse(bridge.getAppUrl());
        String ziel = app.getHost() != null && app.getHost().equals(url.getHost()) ? url.toString() : bridge.getAppUrl();
        view.postDelayed(() -> view.loadUrl(ziel), 1000);
    }

    @Override
    public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
        if (!request.isForMainFrame()) {
            super.onReceivedError(view, request, error);
            return;
        }
        Uri url = request.getUrl();
        Aufnahme.setPanne(context, "Die Seite liess sich nicht laden: " + error.getDescription() + " (" + error.getErrorCode() + ") bei " + kurz(url));
        if (url.toString().equals(bridge.getErrorUrl())) return; // Auch die Ausweichseite fehlt: nicht im Kreis laden.
        if (nochEinmal()) {
            neuLaden(view, url);
            return;
        }
        super.onReceivedError(view, request, error);
    }

    @Override
    public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse response) {
        if (!request.isForMainFrame()) {
            super.onReceivedHttpError(view, request, response);
            return;
        }
        Uri url = request.getUrl();
        Aufnahme.setPanne(context, "Die Seite antwortete mit " + response.getStatusCode() + " bei " + kurz(url));
        if (nochEinmal()) {
            neuLaden(view, url);
            return;
        }
        super.onReceivedHttpError(view, request, response);
    }
}
