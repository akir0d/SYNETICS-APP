import type { MatchAnalysis } from '../types';

/**
 * Persistance locale des analyses (IndexedDB). La video n'est jamais stockee :
 * seuls le signal extrait, la timeline et le rapport le sont, ce qui tient en
 * quelques centaines de kilo-octets par match.
 */

const DB_NAME = 'synetics';
const DB_VERSION = 1;
const STORE = 'analyses';

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id' });
        store.createIndex('createdAt', 'createdAt');
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB indisponible'));
  });
  return dbPromise;
}

function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(STORE, mode);
        const request = run(transaction.objectStore(STORE));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error('Echec de la transaction'));
      }),
  );
}

export async function saveAnalysis(analysis: MatchAnalysis): Promise<void> {
  await tx('readwrite', (store) => store.put(analysis));
}

export async function getAnalysis(id: string): Promise<MatchAnalysis | undefined> {
  return tx<MatchAnalysis | undefined>('readonly', (store) => store.get(id));
}

export async function deleteAnalysis(id: string): Promise<void> {
  await tx('readwrite', (store) => store.delete(id));
}

export async function listAnalyses(): Promise<MatchAnalysis[]> {
  const all = await tx<MatchAnalysis[]>('readonly', (store) => store.getAll());
  return all.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
