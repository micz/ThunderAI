/*
 *  IndexedDB for the test contexts, on fake-indexeddb (an in-memory implementation of the API, a
 *  pinned dev dependency of the root package.json, like jsdom: never shipped).
 *
 *  Generic, like the rest of the core: it names no database and no area.
 *
 *   installIndexedDB(target)   puts indexedDB and the IDB* classes on target (globalThis, or a
 *                              jsdom window). One factory per process, so one test file is one
 *                              fresh set of databases, shared by every context of the process (a
 *                              page and its background share their origin's databases, as in
 *                              Thunderbird)
 *   pendingIndexedDB()         the open requests and live transactions: what settle() waits for
 *   dumpIndexedDB()            every database, its schema and its records, as structured data
 *   seedIndexedDB(snapshot)    the reverse, in a fresh process: how a database survives a restart
 *                              between two worker contexts
 *   installLocks(navigator)    a navigator.locks stand-in (exclusive request() per name), when the
 *                              navigator has none (Node 22, jsdom)
 */

import {
    IDBFactory,
    IDBKeyRange,
    IDBIndex,
    IDBObjectStore,
    IDBCursor,
    IDBCursorWithValue,
    IDBDatabase,
    IDBTransaction,
    IDBRequest,
    IDBOpenDBRequest,
    IDBVersionChangeEvent
} from 'fake-indexeddb';

const CLASSES = {
    IDBKeyRange,
    IDBIndex,
    IDBObjectStore,
    IDBCursor,
    IDBCursorWithValue,
    IDBDatabase,
    IDBTransaction,
    IDBRequest,
    IDBOpenDBRequest,
    IDBVersionChangeEvent,
};

let factory = null;
let pending = 0;
let patched = false;

/** Count what is in flight: every open() until it succeeds or fails, every transaction until it ends. */
function patchTracking() {
    if (patched) return;
    patched = true;
    const origOpen = IDBFactory.prototype.open;
    IDBFactory.prototype.open = function (...args) {
        const request = origOpen.apply(this, args);
        pending++;
        let done = false;
        const end = () => { if (!done) { done = true; pending--; } };
        request.addEventListener('success', end);
        request.addEventListener('error', end);
        return request;
    };
    const origTransaction = IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction = function (...args) {
        const tx = origTransaction.apply(this, args);
        pending++;
        let done = false;
        const end = () => { if (!done) { done = true; pending--; } };
        tx.addEventListener('complete', end);
        tx.addEventListener('abort', end);
        return tx;
    };
}

/** indexedDB and the IDB* classes on target; the same factory for every target of the process. */
export function installIndexedDB(target = globalThis) {
    patchTracking();
    if (!factory) factory = new IDBFactory();
    const define = (name, value) => Object.defineProperty(target, name, { value, configurable: true, writable: true });
    define('indexedDB', factory);
    for (const [name, value] of Object.entries(CLASSES)) define(name, value);
    return factory;
}

/** The open requests and live transactions of the process. */
export function pendingIndexedDB() {
    return pending;
}

const asPromise = request => new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
});

const txDone = tx => new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error || new Error('transaction aborted'));
});

/**
 * Every database of the process: [{name, version, stores: [{name, keyPath, autoIncrement,
 * indexes: [{name, keyPath, unique, multiEntry}], records: [{key, value}]}]}].
 */
export async function dumpIndexedDB() {
    if (!factory) return [];
    const out = [];
    for (const { name, version } of await factory.databases()) {
        const db = await asPromise(factory.open(name));
        const stores = [];
        const names = [...db.objectStoreNames];
        if (names.length > 0) {
            const tx = db.transaction(names, 'readonly');
            for (const storeName of names) {
                const store = tx.objectStore(storeName);
                const indexes = [...store.indexNames].map(n => {
                    const index = store.index(n);
                    return { name: n, keyPath: index.keyPath, unique: index.unique, multiEntry: index.multiEntry };
                });
                const keys = await asPromise(store.getAllKeys());
                const values = await asPromise(store.getAll());
                stores.push({
                    name: storeName,
                    keyPath: store.keyPath,
                    autoIncrement: store.autoIncrement,
                    indexes,
                    records: keys.map((key, i) => ({ key, value: values[i] })),
                });
            }
            await txDone(tx);
        }
        db.close();
        out.push({ name, version, stores });
    }
    return structuredClone(out);
}

/** Recreate the databases of a dumpIndexedDB() snapshot (in a process that has none of them yet). */
export async function seedIndexedDB(snapshot = []) {
    installIndexedDB(globalThis);
    for (const dbs of snapshot) {
        const request = factory.open(dbs.name, dbs.version);
        request.onupgradeneeded = () => {
            const db = request.result;
            for (const s of dbs.stores) {
                const store = db.createObjectStore(s.name, { keyPath: s.keyPath, autoIncrement: s.autoIncrement });
                for (const i of s.indexes) store.createIndex(i.name, i.keyPath, { unique: i.unique, multiEntry: i.multiEntry });
            }
        };
        const db = await asPromise(request);
        const names = dbs.stores.map(s => s.name);
        if (names.length > 0) {
            const tx = db.transaction(names, 'readwrite');
            for (const s of dbs.stores) {
                const store = tx.objectStore(s.name);
                for (const r of s.records) {
                    if (s.keyPath === null) store.put(r.value, r.key);
                    else store.put(r.value);
                }
            }
            await txDone(tx);
        }
        db.close();
    }
}

/**
 * navigator.locks with exclusive request(name, [options], callback) per name, when the navigator
 * has none: Node 22's has no Web Locks, nor has jsdom's. Node 24's real one is kept.
 */
export function installLocks(nav) {
    if (!nav || (nav.locks && typeof nav.locks.request === 'function')) return;
    const tails = new Map();
    const locks = {
        request(name, a, b) {
            const callback = typeof a === 'function' ? a : b;
            const prev = tails.get(name) || Promise.resolve();
            const run = prev.then(() => callback({ name, mode: 'exclusive' }));
            const tail = run.catch(() => {});
            tails.set(name, tail);
            tail.then(() => { if (tails.get(name) === tail) tails.delete(name); });
            return run;
        },
    };
    Object.defineProperty(nav, 'locks', { value: locks, configurable: true });
}
