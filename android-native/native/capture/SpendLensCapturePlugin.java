package app.spendlens.capture;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintManager;
import android.provider.Settings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import androidx.core.app.NotificationManagerCompat;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import org.json.JSONObject;

// Owns native capture: registers itself as the bridge target, exposes permission
// + status methods to JS, and forwards captured SMS/notification text into the
// WebView via the existing window 'spendlens-sms' event (see app/js/app.js).
@CapacitorPlugin(
  name = "SpendLensCapture",
  permissions = { @Permission(alias = "sms", strings = { Manifest.permission.RECEIVE_SMS }) }
)
public class SpendLensCapturePlugin extends Plugin {

  private WebView printWebView; // retained so it isn't GC'd before the print job starts

  @Override
  public void load() {
    CaptureBridge.register(this);
    CaptureQueue.drain(getContext()); // flush anything captured while we were dead
  }

  @PluginMethod
  public void requestSmsPermission(PluginCall call) {
    if (getPermissionState("sms") == PermissionState.GRANTED) resolveGranted(call, true);
    else requestPermissionForAlias("sms", call, "smsCallback");
  }

  @PermissionCallback
  private void smsCallback(PluginCall call) {
    resolveGranted(call, getPermissionState("sms") == PermissionState.GRANTED);
  }

  @PluginMethod
  public void openNotificationAccessSettings(PluginCall call) {
    getActivity().startActivity(new Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS));
    call.resolve();
  }

  @PluginMethod
  public void isNotificationAccessGranted(PluginCall call) {
    boolean granted = NotificationManagerCompat.getEnabledListenerPackages(getContext())
      .contains(getContext().getPackageName());
    JSObject r = new JSObject();
    r.put("granted", granted);
    call.resolve(r);
  }

  @PluginMethod
  public void requestIgnoreBatteryOptimizations(PluginCall call) {
    try {
      Intent i = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
      i.setData(Uri.parse("package:" + getContext().getPackageName()));
      getActivity().startActivity(i);
    } catch (Exception ignored) {}
    call.resolve();
  }

  @PluginMethod
  public void getStatus(PluginCall call) {
    JSObject r = new JSObject();
    // Tri-state so the UI can tell a normal "denied" (re-askable inline) from the
    // restricted-settings "blocked" (must go via App info → Allow restricted settings).
    String smsState;
    if (getPermissionState("sms") == PermissionState.GRANTED) smsState = "granted";
    else if (getActivity() != null && getActivity().shouldShowRequestPermissionRationale(Manifest.permission.RECEIVE_SMS)) smsState = "denied";
    else smsState = "blocked";
    r.put("sms", smsState);
    r.put("notificationAccess", NotificationManagerCompat.getEnabledListenerPackages(getContext())
      .contains(getContext().getPackageName()));
    r.put("sdk", Build.VERSION.SDK_INT);
    r.put("manufacturer", Build.MANUFACTURER == null ? "" : Build.MANUFACTURER.toLowerCase());
    call.resolve(r);
  }

  // Deep-link to THIS app's "App info" screen, where the user enables
  // "Allow restricted settings" to unblock SMS + notification access on a
  // sideloaded build (Android 13+). No manifest change needed (a Settings intent).
  @PluginMethod
  public void openAppInfo(PluginCall call) {
    try {
      Intent i = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
      i.setData(Uri.parse("package:" + getContext().getPackageName()));
      i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
      getContext().startActivity(i);
      call.resolve();
    } catch (Exception e) {
      call.reject("cannot open app info", e);
    }
  }

  @PluginMethod
  public void drainQueue(PluginCall call) {
    CaptureQueue.drain(getContext());
    call.resolve();
  }

  // Open a URL (the new APK asset or the release page) in the system handler.
  // ACTION_VIEW lets the browser's download manager fetch the .apk, which the
  // user then taps to install over the existing app (data preserved).
  @PluginMethod
  public void openExternal(PluginCall call) {
    String url = call.getString("url");
    if (url == null || url.isEmpty()) { call.reject("missing url"); return; }
    try {
      Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
      i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
      getContext().startActivity(i);
      call.resolve();
    } catch (Exception e) {
      call.reject("cannot open url", e);
    }
  }

  // Render an HTML document in an offscreen WebView and hand it to Android's
  // PrintManager (user picks "Save as PDF" / a printer). Used by the PDF report
  // export (app/js/report.js). Runs on the UI thread (WebView requirement).
  @PluginMethod
  public void printContent(PluginCall call) {
    final String html = call.getString("html", "");
    final String jobName = call.getString("jobName", "SpendLens Report");
    getActivity().runOnUiThread(() -> {
      try {
        final WebView wv = new WebView(getContext());
        wv.setWebViewClient(new WebViewClient() {
          @Override
          public void onPageFinished(WebView view, String url) {
            try {
              PrintManager pm = (PrintManager) getContext().getSystemService(Context.PRINT_SERVICE);
              PrintDocumentAdapter adapter = view.createPrintDocumentAdapter(jobName);
              pm.print(jobName, adapter, new PrintAttributes.Builder().build());
            } catch (Exception e) {
              call.reject("print failed", e);
            }
          }
        });
        wv.loadDataWithBaseURL(null, html, "text/html", "UTF-8", null);
        printWebView = wv; // retain
        call.resolve();
      } catch (Exception e) {
        call.reject("print init failed", e);
      }
    });
  }

  // Fetch the latest GitHub release JSON on a background thread (network on the
  // main thread is forbidden). Done natively so the WebView keeps connect-src
  // 'self' — the only third-party egress is this user-initiated lookup. Returns
  // { code, body } to JS, which parses + compares versions (see app/js/update.js).
  @PluginMethod
  public void checkUpdate(PluginCall call) {
    final String repo = call.getString("repo", "");
    if (repo.isEmpty()) { call.reject("missing repo"); return; } // surface misconfig, not a fake "no update"
    new Thread(() -> {
      HttpURLConnection conn = null;
      try {
        URL url = new URL("https://api.github.com/repos/" + repo + "/releases/latest");
        conn = (HttpURLConnection) url.openConnection();
        conn.setRequestProperty("Accept", "application/vnd.github+json");
        conn.setRequestProperty("User-Agent", "SpendLens"); // GitHub rejects requests with no UA
        conn.setConnectTimeout(8000);
        conn.setReadTimeout(8000);
        int code = conn.getResponseCode();
        JSObject r = new JSObject();
        r.put("code", code);
        if (code == 200) {
          InputStream is = conn.getInputStream();
          BufferedReader br = new BufferedReader(new InputStreamReader(is, StandardCharsets.UTF_8));
          StringBuilder sb = new StringBuilder();
          String line;
          while ((line = br.readLine()) != null) sb.append(line);
          br.close();
          r.put("body", sb.toString());
        }
        call.resolve(r);
      } catch (Exception e) {
        call.reject("network error", e);
      } finally {
        if (conn != null) conn.disconnect();
      }
    }).start();
  }

  private void resolveGranted(PluginCall call, boolean granted) {
    JSObject r = new JSObject();
    r.put("granted", granted);
    call.resolve(r);
    CaptureQueue.drain(getContext());
  }

  // Inject one captured message (a JSON string) into the WebView. The payload is
  // passed as a JS string literal (JSONObject.quote escapes it) — never code —
  // so arbitrary SMS/email text cannot break out into script.
  void deliver(String json) {
    final String js = "window.dispatchEvent(new CustomEvent('spendlens-sms',{detail:" + JSONObject.quote(json) + "}))";
    bridge.getActivity().runOnUiThread(() -> bridge.getWebView().evaluateJavascript(js, null));
  }
}
