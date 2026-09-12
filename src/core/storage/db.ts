import type { KnownMap, MatchAnalysis } from '../types';

/**
 * Persistance locale des analyses (IndexedDB). La video n'est jamais stockee :
 * seuls le signal extrait, la timeline et le rapport le sont, ce qui tient en
 * quelques centaines de kilo-octets par match.
 */

const DB_NAME = 'synetics';
const DB_VERSION = 2;
const STORE = 'analyses';
const MAPS_STORE = 'maps';

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
      // Version 2 : bibliotheque d'arenes. Les analyses deja enregistrees sont
      // conservees telles quelles ; elles s'affichent sans carte identifiee.
      if (!db.objectStoreNames.contains(MAPS_STORE)) {
        db.createObjectStore(MAPS_STORE, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB indisponible'));
  });
  return dbPromise;
}

function tx<T>(
  storeName: string,
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(storeName, mode);
        const request = run(transaction.objectStore(storeName));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error('Echec de la transaction'));
      }),
  );
}

export async function saveAnalysis(analysis: MatchAnalysis): Promise<void> {
  await tx(STORE, 'readwrite', (store) => store.put(analysis));
}

export async function saveAnalyses(analyses: readonly MatchAnalysis[]): Promise<void> {
  // Une rediffusion decoupee produit plusieurs matchs d'un coup : les ecrire
  // dans une seule transaction evite d'en perdre la moitie en cas d'incident.
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE, 'readwrite');
    const store = transaction.objectStore(STORE);
    for (const analysis of analyses) store.put(analysis);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('Echec de l enregistrement'));
  });
}

export async function getAnalysis(id: string): Promise<MatchAnalysis | undefined> {
  return tx<MatchAnalysis | undefined>(STORE, 'readonly', (store) => store.get(id));
}

export async function deleteAnalysis(id: string): Promise<void> {
  await tx(STORE, 'readwrite', (store) => store.delete(id));
}

export async function listAnalyses(): Promise<MatchAnalysis[]> {
  const all = await tx<MatchAnalysis[]>(STORE, 'readonly', (store) => store.getAll());
  return all.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function listMaps(): Promise<KnownMap[]> {
  const all = await tx<KnownMap[]>(MAPS_STORE, 'readonly', (store) => store.getAll());
  return all.sort((a, b) => a.name.localeCompare(b.name, 'fr'));
}

export async function saveMap(map: KnownMap): Promise<void> {
  await tx(MAPS_STORE, 'readwrite', (store) => store.put(map));
}

export async function deleteMap(id: string): Promise<void> {
  await tx(MAPS_STORE, 'readwrite', (store) => store.delete(id));
}
