package app.spendlens;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

import app.spendlens.capture.SpendLensCapturePlugin;

public class MainActivity extends BridgeActivity {
  @Override
  public void onCreate(Bundle savedInstanceState) {
    registerPlugin(SpendLensCapturePlugin.class);
    super.onCreate(savedInstanceState);
  }
}
