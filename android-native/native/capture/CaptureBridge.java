package app.spendlens.capture;

import android.content.Context;

import java.lang.ref.WeakReference;

// Central forwarder used by the SMS receiver and the notification listener.
// If the WebView/plugin is alive, deliver straight to JS; otherwise buffer in
// the durable native queue and flush on next resume. Replay is idempotent — the
// app's content-hash + dedupeKey indexes drop any over-delivery.
public class CaptureBridge {
  private static WeakReference<SpendLensCapturePlugin> ref;

  static void register(SpendLensCapturePlugin plugin) {
    ref = new WeakReference<>(plugin);
  }

  static SpendLensCapturePlugin plugin() {
    return ref == null ? null : ref.get();
  }

  public static void deliver(Context ctx, String json) {
    SpendLensCapturePlugin p = plugin();
    if (p != null) {
      try { p.deliver(json); return; } catch (Exception ignored) {}
    }
    CaptureQueue.enqueue(ctx, json);
  }
}
