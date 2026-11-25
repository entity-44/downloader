import type { Kind } from "./types";

/**
 * Per-device library stored in IndexedDB. Nothing leaves the browser.
 */
export type Source = "instagram" | "reddit" | "instagram-api" | "export" | "upload";

export type Collection = {
  id: string;
  source: Source;
  title: string;
  sourceUrl?: string;
  author?: string;
  caption?: string;
  takenAt?: string;
  createdAt: string;
  count: number;
  sizeBytes: number;
  coverId?: string;
};

export type Item = {
  id: string;
  collectionId: string;
  kind: Kind;
  mime: string;
  size: number;
  filename: string;
  category?: string;
  caption?: string;
  takenAt?: string;
  position: number;
  durationSec?: number;
  width?: number;
  height?: number;
  hasThumb: boolean;
};

const DB_NAME = "keepsake";
const VERSION = 1;
let dbp: Promise<IDBDatabase> | undefined;

function open(): Promise<IDBDatabase> {
  dbp ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const d = req.result;
      d.createObjectStore("collections", { keyPath: "id" });
      const items = d.createObjectStore("items", { keyPath: "id" });
      items.createIndex("collectionId", "collectionId");
      d.createObjectStore("blobs");
      d.createObjectStore("thumbs");
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

function tx<T>(stores: string[], mode: IDBTransactionMode, fn: (t: IDBTransaction) => T | Promise<T>): Promise<T> {
  return open().then(
    (d) =>
      new Promise<T>((resolve, reject) => {
        const t = d.transaction(stores, mode);
        let result: T;
        Promise.resolve(fn(t)).then((r) => (result = r), reject);
        t.oncomplete = () => resolve(result);
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error ?? new Error("Transaction aborted"));
      }),
  );
}

const req = <T>(r: IDBRequest<T>) => new Promise<T>((res, rej) => ((r.onsuccess = () => res(r.result)), (r.onerror = () => rej(r.error))));

export const newId = () => crypto.randomUUID().replace(/-/g, "");

export async function putCollection(c: Collection) {
  await tx(["collections"], "readwrite", (t) => void t.objectStore("collections").put(c));
}

export async function addItem(item: Item, blob: Blob, thumb?: Blob | null) {
  await tx(["items", "blobs", "thumbs"], "readwrite", (t) => {
    t.objectStore("items").put(item);
    t.objectStore("blobs").put(blob, item.id);
    if (thumb) t.objectStore("thumbs").put(thumb, item.id);
  });
}

export async function setThumb(itemId: string, thumb: Blob) {
  await tx(["items", "thumbs"], "readwrite", async (t) => {
    const it = await req(t.objectStore("items").get(itemId) as IDBRequest<Item | undefined>);
    if (!it) return;
    t.objectStore("thumbs").put(thumb, itemId);
    t.objectStore("items").put({ ...it, hasThumb: true });
  });
}

export async function listCollections(): Promise<Collection[]> {
  const all = await tx(["collections"], "readonly", (t) => req(t.objectStore("collections").getAll() as IDBRequest<Collection[]>));
  return all.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function getCollection(id: string) {
  return tx(["collections"], "readonly", (t) => req(t.objectStore("collections").get(id) as IDBRequest<Collection | undefined>));
}

export async function listItems(collectionId: string): Promise<Item[]> {
  const items = await tx(["items"], "readonly", (t) => req(t.objectStore("items").index("collectionId").getAll(collectionId) as IDBRequest<Item[]>));
  return items.sort((a, b) => a.position - b.position);
}

export async function getBlob(itemId: string) {
  return tx(["blobs"], "readonly", (t) => req(t.objectStore("blobs").get(itemId) as IDBRequest<Blob | undefined>));
}

export async function getThumb(itemId: string) {
  return tx(["thumbs"], "readonly", (t) => req(t.objectStore("thumbs").get(itemId) as IDBRequest<Blob | undefined>));
}

export async function deleteCollection(id: string) {
  const items = await listItems(id);
  await tx(["collections", "items", "blobs", "thumbs"], "readwrite", (t) => {
    for (const it of items) {
      t.objectStore("items").delete(it.id);
      t.objectStore("blobs").delete(it.id);
      t.objectStore("thumbs").delete(it.id);
    }
    t.objectStore("collections").delete(id);
  });
}

export async function deleteItems(collectionId: string, ids: string[]) {
  await tx(["items", "blobs", "thumbs", "collections"], "readwrite", async (t) => {
    for (const id of ids) {
      t.objectStore("items").delete(id);
      t.objectStore("blobs").delete(id);
      t.objectStore("thumbs").delete(id);
    }
    const c = await req(t.objectStore("collections").get(collectionId) as IDBRequest<Collection | undefined>);
    if (c) t.objectStore("collections").put({ ...c, count: Math.max(0, c.count - ids.length) });
  });
}

export async function clearAll() {
  await tx(["collections", "items", "blobs", "thumbs"], "readwrite", (t) => {
    for (const s of ["collections", "items", "blobs", "thumbs"]) t.objectStore(s).clear();
  });
}

export async function storageInfo() {
  const est = await navigator.storage?.estimate?.().catch(() => undefined);
  const persisted = await navigator.storage?.persisted?.().catch(() => false);
  return { usage: est?.usage ?? 0, quota: est?.quota ?? 0, persisted: !!persisted };
}

export async function requestPersistence() {
  return (await navigator.storage?.persist?.().catch(() => false)) ?? false;
}
