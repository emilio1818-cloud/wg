/** Minimal promise-based key/value store on top of IndexedDB, with a localStorage fallback. */

const DB_NAME = 'nestly';
const STORE = 'kv';

let dbPromise: Promise<IDBDatabase | null> | null = null;

function open(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

function tx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T | undefined> {
  return open().then(
    (db) =>
      new Promise<T | undefined>((resolve, reject) => {
        if (!db) return resolve(undefined);
        const t = db.transaction(STORE, mode);
        const req = fn(t.objectStore(STORE));
        t.oncomplete = () => resolve(req.result);
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error);
      }),
  );
}

export async function kvGet<T>(key: string): Promise<T | undefined> {
  try {
    const db = await open();
    if (!db) {
      const raw = localStorage.getItem(`${DB_NAME}:${key}`);
      return raw ? (JSON.parse(raw) as T) : undefined;
    }
    return (await tx<T>('readonly', (s) => s.get(key) as IDBRequest<T>)) ?? undefined;
  } catch {
    return undefined;
  }
}

export async function kvSet(key: string, value: unknown): Promise<void> {
  const db = await open();
  if (!db) {
    localStorage.setItem(`${DB_NAME}:${key}`, JSON.stringify(value));
    return;
  }
  await tx('readwrite', (s) => s.put(value, key));
}

export async function kvDelete(key: string): Promise<void> {
  const db = await open();
  if (!db) {
    localStorage.removeItem(`${DB_NAME}:${key}`);
    return;
  }
  await tx('readwrite', (s) => s.delete(key));
}
