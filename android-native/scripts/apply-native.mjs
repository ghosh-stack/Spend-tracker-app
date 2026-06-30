// Inject SpendLens's native capture code into the Capacitor-generated Android
// project and patch the manifest. Idempotent — safe to run after every `cap sync`.
// Run from android-native/:  node scripts/apply-native.mjs   (npm run sync does this)
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const nativeDir = join(root, 'native');
const appMain = join(root, 'android', 'app', 'src', 'main');

if (!existsSync(appMain)) {
  console.error('android/ project not found. Run `npx cap add android` first (or `npm run init:android`).');
  process.exit(1);
}

// 1. MainActivity (registers the plugin)
copyFileSync(join(nativeDir, 'MainActivity.java'), join(appMain, 'java', 'app', 'spendlens', 'MainActivity.java'));

// 2. capture/*.java
const captureDst = join(appMain, 'java', 'app', 'spendlens', 'capture');
mkdirSync(captureDst, { recursive: true });
for (const f of readdirSync(join(nativeDir, 'capture'))) {
  copyFileSync(join(nativeDir, 'capture', f), join(captureDst, f));
}

// 3. Patch AndroidManifest.xml — add permissions + the receiver/service.
const manifestPath = join(appMain, 'AndroidManifest.xml');
let m = readFileSync(manifestPath, 'utf8');

// Each permission is checked independently so a manifest already patched with an
// older permission set (e.g. RECEIVE_SMS but not READ_SMS) still gains the new ones
// on re-run. Patching the whole block only when RECEIVE_SMS was absent used to skip
// later additions on an existing android/ project.
const PERM_NAMES = [
  'RECEIVE_SMS',
  'READ_SMS',
  'POST_NOTIFICATIONS',
  'REQUEST_IGNORE_BATTERY_OPTIMIZATIONS',
];
const COMPONENTS = `        <receiver
            android:name="app.spendlens.capture.SmsReceiver"
            android:exported="true"
            android:permission="android.permission.BROADCAST_SMS">
            <intent-filter android:priority="999">
                <action android:name="android.provider.Telephony.SMS_RECEIVED" />
            </intent-filter>
        </receiver>
        <service
            android:name="app.spendlens.capture.SpendLensNotificationListener"
            android:exported="false"
            android:permission="android.permission.BIND_NOTIFICATION_LISTENER_SERVICE">
            <intent-filter>
                <action android:name="android.service.notification.NotificationListenerService" />
            </intent-filter>
        </service>
`;

const missingPerms = PERM_NAMES.filter((p) => !m.includes('android.permission.' + p));
if (missingPerms.length) {
  const block = missingPerms.map((p) => `    <uses-permission android:name="android.permission.${p}" />`).join('\n') + '\n';
  m = m.replace(/(<manifest[^>]*>\s*)/, `$1\n${block}`);
}
if (!m.includes('SpendLensNotificationListener')) {
  m = m.replace('</application>', `${COMPONENTS}    </application>`);
}
writeFileSync(manifestPath, m);

console.log(`apply-native: MainActivity + capture/*.java copied, manifest patched (added perms: ${missingPerms.join(', ') || 'none'}).`);
