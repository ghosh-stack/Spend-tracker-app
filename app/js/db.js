// IndexedDB wrapper — the platform's standard structured store (rung 3), no
// SQLite/Dexie/ORM. Thin Promise helpers over the raw API; uniqueness (dedupe)
// is enforced by UNIQUE indexes, so the DB rejects duplicates for us (rung 4)
// instead of a scan-and-compare loop in JS.
const DB_NAME = 'spendlens';
const DB_VERSION = 1;

const SCHEMA = {
  transactions: {
    keyPath: 'id',
    indexes: [
      ['by_ts', 'ts'],
      ['by_account', 'accountId'],
      ['by_category', 'category'],
      ['by_dedupeKey', 'dedupeKey', { unique: true }],
      ['by_account_ts', ['accountId', 'ts']],
    ],
  },
  accounts: { keyPath: 'id', indexes: [['by_bankKey', 'bankKey']] },
  rules: {
    keyPath: 'id',
    indexes: [['by_kind_priority', ['kind', 'priority']], ['by_bankKey', 'bankKey']],
  },
  raw_messages: {
    keyPath: 'id',
    indexes: [
      ['by_contentHash', 'contentHash', { unique: true }],
      ['by_status', 'status'],
      ['by_source_receivedAt', ['source', 'receivedAt']],
    ],
  },
};

let _db = null;

export function openDB() {
  if (_db) return Promise.resolve(_db);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const [name, def] of Object.entries(SCHEMA)) {
        if (db.objectStoreNames.contains(name)) continue;
        const store = db.createObjectStore(name, { keyPath: def.keyPath });
        for (const [idxName, keyPath, opts] of def.indexes || []) {
          store.createIndex(idxName, keyPath, opts || {});
        }
      }
    };
    req.onsuccess = () => { _db = req.result; resolve(_db); };
    req.onerror = () => reject(req.error);
  });
}

const done = (req) =>
  new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

async function withStore(name, mode, fn) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(name, mode);
    const store = tx.objectStore(name);
    let out;
    Promise.resolve(fn(store)).then((v) => { out = v; }).catch(reject);
    tx.oncomplete = () => resolve(out);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('transaction aborted'));
  });
}

export const get = (store, key) => withStore(store, 'readonly', (s) => done(s.get(key)));
export const getAll = (store) => withStore(store, 'readonly', (s) => done(s.getAll()));
export const put = (store, value) => withStore(store, 'readwrite', (s) => done(s.put(value)));
export const del = (store, key) => withStore(store, 'readwrite', (s) => done(s.delete(key)));

export const getAllByIndex = (store, index, query) =>
  withStore(store, 'readonly', (s) => done(s.index(index).getAll(query)));

/**
 * Add a record, returning {ok:true} or {ok:false, duplicate:true} when a UNIQUE
 * index rejects it. This is how intake/transaction dedupe works — the DB is the
 * gate, not a JS comparison.
 */
export function addUnique(store, value) {
  return withStore(store, 'readwrite', (s) =>
    new Promise((resolve, reject) => {
      const req = s.add(value);
      req.onsuccess = () => resolve({ ok: true, key: req.result });
      req.onerror = (e) => {
        if (req.error && req.error.name === 'ConstraintError') {
          e.preventDefault(); // a duplicate — swallow so the whole tx doesn't abort
          resolve({ ok: false, duplicate: true });
        } else {
          reject(req.error); // a real write failure (e.g. QuotaExceeded) — surface it
        }
      };
    })
  );
}

/** GDPR right-to-erasure: wipe the entire local database. */
export function deleteDatabase() {
  _db?.close();
  _db = null;
  return new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    req.onblocked = () => resolve(); // other tabs hold it open; proceeds on close
  });
}

export const STORES = Object.keys(SCHEMA);
