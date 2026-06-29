package app.spendlens.capture;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONArray;

// Durable FIFO of captured messages (SharedPreferences-backed, capped) for when
// the WebView isn't running. drain() replays them once the plugin is live.
public class CaptureQueue {
  private static final String PREF = "spendlens_capture";
  private static final String KEY = "queue";
  private static final int CAP = 500;

  static synchronized void enqueue(Context ctx, String json) {
    SharedPreferences p = ctx.getSharedPreferences(PREF, Context.MODE_PRIVATE);
    try {
      JSONArray a = new JSONArray(p.getString(KEY, "[]"));
      a.put(json);
      while (a.length() > CAP) a.remove(0);
      p.edit().putString(KEY, a.toString()).apply();
    } catch (Exception ignored) {}
  }

  public static synchronized void drain(Context ctx) {
    SpendLensCapturePlugin plugin = CaptureBridge.plugin();
    if (plugin == null) return;
    SharedPreferences p = ctx.getSharedPreferences(PREF, Context.MODE_PRIVATE);
    try {
      JSONArray a = new JSONArray(p.getString(KEY, "[]"));
      for (int i = 0; i < a.length(); i++) plugin.deliver(a.getString(i));
      p.edit().putString(KEY, "[]").apply();
    } catch (Exception ignored) {}
  }
}
