# Android SMS ingestion adapter

Forwards bank **SMS** alerts into SpendLens on Android. SMS is the richest
source for UPI/card spend in India — but reading it automatically is the most
**permission-restricted** path, so read this whole page before choosing.

## The hard truth (read first)

- **A browser PWA cannot read SMS.** There is no web API for it, on any
  platform. The installed PWA on Android still can't.
- **Auto-reading SMS needs `RECEIVE_SMS` / `READ_SMS`.** Google Play restricts
  these to apps whose *core purpose* is being the default SMS handler. An
  expense tracker is not, so a Play-Store build requesting them will likely be
  **rejected**. Realistic distribution is **sideloading** your own signed APK,
  or using an automation app you already trust.
- **Desktops have no SMS at all.** This adapter simply does not exist there —
  use the [email adapter](../email-imap/) or paste manually.

Because of this, SMS auto-capture is an **opt-in upgrade**, never assumed. The
universal baseline is: paste the SMS into the app, or import a CSV.

## The contract (both options POST this)

Every forwarder sends the same JSON to the app's local ingest endpoint, so the
app side is one code path:

```http
POST http://127.0.0.1:8787/ingest
Authorization: Bearer <INGEST_TOKEN>     # optional, if the server sets one
Content-Type: application/json

{ "source": "android-sms", "sender": "VM-HDFCBK", "text": "<the full SMS body>", "receivedAt": "2026-06-29T13:20:00+05:30" }
```

The app parses, categorizes and dedupes it. `receivedAt` may be ISO or epoch ms.

---

## Option A — No-code: an automation app (recommended to start)

Use **MacroDroid**, **Tasker**, or **Automate** to POST each bank SMS. No build,
no Play-policy problem (these apps legitimately hold SMS permission), works today.

**MacroDroid recipe**
- **Trigger:** *SMS Received* → from a bank short-code (e.g. contains `HDFCBK`,
  `SBIINB`, `ICICIB`, `AxisBk`…). Add one trigger per bank, or match all and let
  the app's parser reject non-bank text.
- **Action:** *HTTP Request (POST)*
  - URL: `http://<your-PC-LAN-IP>:8787/ingest` (the PC running `node tools/serve.js`,
    on the same Wi-Fi), or `http://127.0.0.1:8787/ingest` if the app runs on-device.
  - Headers: `Content-Type: application/json` (+ `Authorization: Bearer <token>` if set)
  - Body:
    ```json
    {"source":"android-sms","sender":"[sms_sender]","text":"[sms_message]","receivedAt":""}
    ```
    (Use MacroDroid's magic-text variables `[sms_sender]` / `[sms_message]`.)

> If the bridge runs on your PC, bind it to the LAN only on a trusted network —
> this is bank data. Prefer running the app on-device (Termux + a static server)
> if you don't want SMS leaving the phone.

## Option B — Native: a Capacitor wrapper of this app

Wrap the same web build with [Capacitor](https://capacitorjs.com/) and register
a `BroadcastReceiver` for `SMS_RECEIVED`, feeding the body straight into the
in-WebView pipeline (no network hop). Outline:

```java
// android/app/src/main/java/.../SmsReceiver.java  (sketch)
public class SmsReceiver extends BroadcastReceiver {
  @Override public void onReceive(Context ctx, Intent intent) {
    for (SmsMessage m : Telephony.Sms.Intents.getMessagesFromIntent(intent)) {
      String sender = m.getOriginatingAddress();
      String body   = m.getMessageBody();
      // hand to JS: window.SpendLens.ingest({source:'android-sms', sender, text:body})
      Bridge.triggerWindowJSEvent("spendlens-sms",
        "{\"sender\":\"" + esc(sender) + "\",\"text\":\"" + esc(body) + "\"}");
    }
  }
}
```
```xml
<!-- AndroidManifest.xml -->
<uses-permission android:name="android.permission.RECEIVE_SMS"/>
```
On the web side, listen for `spendlens-sms` and call `ingest.ingestRaw(...)`.

**Build:** Android Studio + SDK + JDK + Gradle. You must **sign the APK with your
own keystore and sideload it** — do not expect Play Store approval for the SMS
permission. <!-- ponytail: Play policy is the ceiling; the upgrade path is self-sign + sideload, documented, not worked around -->

This repo ships the *spec and the contract*, not a prebuilt signed APK — signing
requires your own keys on your own machine and is out of scope for the source drop.
