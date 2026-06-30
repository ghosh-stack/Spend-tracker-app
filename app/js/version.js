// Single source of truth for the running app version. The release CI rewrites
// APP_VERSION from the pushed git tag (e.g. v0.2.0 → '0.2.0') before the APK is
// bundled, so the installed app always knows which build it is. It stays
// '0.0.0-dev' for local / untagged (manual) builds — which makes any published
// release correctly show up as "update available".
export const APP_VERSION = '0.0.0-dev';

// owner/name of the GitHub repo whose Releases hold the sideloadable APKs.
export const REPO = 'ghosh-stack/Spend-tracker-app';
