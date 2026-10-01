package ch.angebunden.velonavi;

import android.os.Bundle;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.WebViewListener;

public class MainActivity extends BridgeActivity {
    /** Wann die Seite zuletzt neu aufgebaut wurde, damit ein Fehler, der sofort wiederkommt, nicht endlos kreist. */
    private static long letzterNeubau = 0;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        Aufnahme.absturzMerken(this);
        // Das Plugin muss vor dem Start der Brücke angemeldet sein.
        registerPlugin(VelotrackerPlugin.class);
        super.onCreate(savedInstanceState);
        // Ladefehler der Seite abfangen, statt die Fehlerseite von Android stehen zu lassen.
        getBridge().setWebViewClient(new Seitenwaechter(getBridge(), this));
        // Ist der Prozess der Seite weg (abgestürzt oder von Android wegen Speicher beendet), riss das
        // bisher die ganze App mit oder hinterliess eine Fehlerseite. Jetzt baut die App die Seite neu
        // auf. Eine laufende Aufzeichnung läuft im Dienst weiter und ist danach wieder zu sehen.
        getBridge().addWebViewListener(new WebViewListener() {
            @Override
            public boolean onRenderProcessGone(WebView webView, RenderProcessGoneDetail detail) {
                Aufnahme.setPanne(MainActivity.this, detail.didCrash()
                        ? "Die Seite ist abgestürzt und wurde neu geladen."
                        : "Android hat die Seite beendet, um Speicher freizugeben. Sie wurde neu geladen.");
                long jetzt = System.currentTimeMillis();
                boolean gleichWieder = jetzt - letzterNeubau < 10_000;
                letzterNeubau = jetzt;
                if (gleichWieder) finish();
                else recreate();
                return true;
            }
        });
    }
}
