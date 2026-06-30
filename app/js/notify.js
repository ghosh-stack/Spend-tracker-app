// Local notifications — one facade that works as a web PWA (Notifications API /
// service worker) and natively (Capacitor LocalNotifications), feature-detected
// so the rest of the code never branches on platform. Fully local, no server.
import * as db from './db.js';
import { formatMoney } from './money.js';
import { categoryById } from './rules.js';
import { rangeStart, summarize } from './queries.js';

const cap = window.Capacitor;
const native = !!(cap?.isNativePlatform?.() && cap.Plugins?.LocalNotifications);

const DEFAULTS = { enabled: false, largeTxn: 500000, budgetAlerts: true, hideAmounts: false };
export const getPrefs = async () => ({ ...DEFAULTS, ...(await db.getSetting('notifs', {})) });
export const setPrefs = (p) => db.setSetting('notifs', p);

export async function requestPermission() {
  if (native) {
    const L = cap.Plugins.LocalNotifications;
    if ((await L.checkPermissions()).display === 'granted') return true;
    return (await L.requestPermissions()).display === 'granted';
  }
  if (!('Notification' in window)) return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;
  return (await Notification.requestPermission()) === 'granted';
}

let nid = 1;
async function fire(title, body) {
  if (!(await requestPermission())) return;
  if (native) {
    try { await cap.Plugins.LocalNotifications.schedule({ notifications: [{ id: nid++, title, body }] }); } catch {}
    return;
  }
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg?.showNotification) await reg.showNotification(title, { body, icon: 'icons/icon-192.png', badge: 'icons/icon.svg' });
    else new Notification(title, { body });
  } catch {}
}

// Evaluated on each new transaction (wired via ingest.onChange in app.js).
export async function onTransaction(txn) {
  const p = await getPrefs();
  if (!p.enabled || txn.direction !== 'debit' || categoryById(txn.category).kind !== 'expense' || txn.excluded) return;
  if (txn.amount >= (p.largeTxn || DEFAULTS.largeTxn)) {
    if (p.hideAmounts) fire('SpendLens', 'New large transaction — open to view');
    else fire(`Large spend: ${formatMoney(txn.amount)}`, txn.merchant || categoryById(txn.category).label);
  }
  if (p.budgetAlerts) await checkBudget(txn.category, p);
}

// Fire once per category per month on crossing 80% / 100% of its budget.
async function checkBudget(catId, p) {
  const b = (await db.getAll('budgets')).find((x) => x.categoryId === catId);
  if (!b || !b.monthly) return;
  const monthStart = rangeStart('month');
  const all = await db.getAll('transactions');
  const spent = summarize(all.filter((t) => t.ts >= monthStart)).categories.find((c) => c.categoryId === catId)?.amount || 0;
  const d = new Date(); // LOCAL month key, matching rangeStart('month')'s local-time window
  const monthKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  const state = await db.getSetting('budgetAlertState', {});
  const seen = (state[monthKey] && state[monthKey][catId]) || {};
  const cat = categoryById(catId);
  const redact = p && p.hideAmounts;
  if (spent >= b.monthly && !seen.exceeded) {
    fire(`Over budget: ${cat.label}`, redact ? 'Open to view' : `Spent ${formatMoney(spent)} of ${formatMoney(b.monthly)} this month`);
    seen.exceeded = true;
  } else if (spent >= b.monthly * 0.8 && !seen.warned) {
    fire(`${cat.label} budget at ${Math.round((spent / b.monthly) * 100)}%`, redact ? 'Open to view' : `${formatMoney(Math.max(0, b.monthly - spent))} left this month`);
    seen.warned = true;
  } else return;
  state[monthKey] = { ...(state[monthKey] || {}), [catId]: seen };
  await db.setSetting('budgetAlertState', state);
}
