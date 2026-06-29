package app.spendlens.capture;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.Bundle;
import android.telephony.SmsMessage;

import org.json.JSONObject;

import java.util.HashMap;
import java.util.Map;

// Catches incoming SMS (manifest-registered, so it fires even when the app is
// closed). Reassembles multipart messages per sender and forwards the full body.
public class SmsReceiver extends BroadcastReceiver {
  @Override
  public void onReceive(Context ctx, Intent intent) {
    try {
      Bundle b = intent.getExtras();
      if (b == null) return;
      Object[] pdus = (Object[]) b.get("pdus");
      if (pdus == null) return;
      String format = b.getString("format");

      Map<String, StringBuilder> bySender = new HashMap<>();
      for (Object pdu : pdus) {
        SmsMessage m = (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M)
          ? SmsMessage.createFromPdu((byte[]) pdu, format)
          : SmsMessage.createFromPdu((byte[]) pdu);
        if (m == null) continue;
        String sender = m.getOriginatingAddress();
        if (sender == null) sender = "";
        bySender.computeIfAbsent(sender, k -> new StringBuilder()).append(m.getMessageBody());
      }
      for (Map.Entry<String, StringBuilder> e : bySender.entrySet()) {
        JSONObject o = new JSONObject();
        o.put("source", "android-sms");
        o.put("sender", e.getKey());
        o.put("text", e.getValue().toString());
        o.put("receivedAt", System.currentTimeMillis());
        CaptureBridge.deliver(ctx, o.toString());
      }
    } catch (Exception ignored) {
      // a malformed PDU must never crash the receiver
    }
  }
}
