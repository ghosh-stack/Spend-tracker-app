package app.spendlens.capture;

import android.app.Notification;
import android.os.Bundle;
import android.service.notification.NotificationListenerService;
import android.service.notification.StatusBarNotification;

import org.json.JSONObject;

import java.util.Arrays;
import java.util.HashSet;
import java.util.Set;

// Captures EMAIL and bank-app PUSH by reading notifications from an allow-list of
// mail + bank packages (read-only, on-device). The parser's gating rejects
// anything that isn't a real bank alert, so noise is harmless.
public class SpendLensNotificationListener extends NotificationListenerService {

  // Default allow-list. The user can narrow/extend this later; only these
  // packages are ever inspected — never chats or other apps.
  private static final Set<String> ALLOW = new HashSet<>(Arrays.asList(
    // mail
    "com.google.android.gm", "com.microsoft.office.outlook",
    "com.yahoo.mobile.client.android.mail", "com.samsung.android.email.provider",
    // banks / UPI apps (India)
    "com.snapwork.hdfc", "com.csam.icici.bank.imobile", "com.sbi.lotusintouch",
    "com.sbi.SBIFreedomPlus", "com.axis.mobile", "com.msf.kbank.mobile",
    "com.phonepe.app", "com.google.android.apps.nbu.paisa.user",
    "net.one97.paytm", "com.dreamplug.androidapp"
  ));

  @Override
  public void onNotificationPosted(StatusBarNotification sbn) {
    try {
      String pkg = sbn.getPackageName();
      if (pkg == null || !ALLOW.contains(pkg)) return;
      Bundle x = sbn.getNotification().extras;
      CharSequence titleCs = x.getCharSequence(Notification.EXTRA_TITLE);
      String title = titleCs == null ? "" : titleCs.toString();
      String body = richest(x);
      if (body.trim().isEmpty()) return;

      JSONObject o = new JSONObject();
      o.put("source", "android-notification");
      o.put("sender", pkg + (title.isEmpty() ? "" : " | " + title));
      o.put("text", (title.isEmpty() ? "" : title + " ") + body);
      o.put("receivedAt", sbn.getPostTime());
      CaptureBridge.deliver(getApplicationContext(), o.toString());
    } catch (Exception ignored) {}
  }

  // Pick the longest available text — bank alert amounts usually survive in the
  // big-text/expanded payload even when the collapsed line is truncated.
  private String richest(Bundle x) {
    String best = "";
    CharSequence big = x.getCharSequence(Notification.EXTRA_BIG_TEXT);
    CharSequence txt = x.getCharSequence(Notification.EXTRA_TEXT);
    CharSequence sub = x.getCharSequence(Notification.EXTRA_SUB_TEXT);
    CharSequence[] lines = x.getCharSequenceArray(Notification.EXTRA_TEXT_LINES);
    StringBuilder joined = new StringBuilder();
    if (lines != null) for (CharSequence l : lines) joined.append(l).append(" ");
    for (CharSequence c : new CharSequence[]{ big, joined.length() > 0 ? joined.toString() : null, txt, sub }) {
      if (c != null && c.toString().length() > best.length()) best = c.toString();
    }
    return best;
  }
}
