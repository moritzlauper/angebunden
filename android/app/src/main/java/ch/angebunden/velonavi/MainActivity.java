package ch.angebunden.velonavi;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Das Plugin muss vor dem Start der Brücke angemeldet sein.
        registerPlugin(VelotrackerPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
