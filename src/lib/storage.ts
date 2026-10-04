export type StoredProvider = "anthropic" | "openai" | "gemini";
export interface Credentials { provider: StoredProvider; apiKey: string; }
export interface StoredPosition { season: number; episode: number; }
export interface StoredChatMessage {
  role: "user" | "assistant";
  content: string;
  safe?: boolean;
  revealed?: boolean;
  sources?: string[];
}

const DB_NAME = "up-to-here";
const DB_VERSION = 1;
const LEGACY_KEY = "uth-api-key";
const LEGACY_PROVIDER = "uth-api-provider";

function request<T>(value: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    value.onsuccess = () => resolve(value.result);
    value.onerror = () => reject(value.error);
  });
}

const db = new Promise<IDBDatabase>((resolve, reject) => {
  const open = indexedDB.open(DB_NAME, DB_VERSION);
  open.onupgradeneeded = () => {
    const database = open.result;
    if (!database.objectStoreNames.contains("settings")) database.createObjectStore("settings");
    if (!database.objectStoreNames.contains("progress")) database.createObjectStore("progress");
    if (!database.objectStoreNames.contains("chats")) database.createObjectStore("chats");
    if (!database.objectStoreNames.contains("recentSearches")) database.createObjectStore("recentSearches");
  };
  open.onsuccess = () => resolve(open.result);
  open.onerror = () => reject(open.error);
});

async function get<T>(store: string, key: IDBValidKey): Promise<T | undefined> {
  const database = await db;
  const tx = database.transaction(store, "readonly");
  return request(tx.objectStore(store).get(key));
}

async function put(store: string, value: unknown, key: IDBValidKey) {
  const database = await db;
  const tx = database.transaction(store, "readwrite");
  await request(tx.objectStore(store).put(value, key));
}

async function remove(store: string, key: IDBValidKey) {
  const database = await db;
  const tx = database.transaction(store, "readwrite");
  await request(tx.objectStore(store).delete(key));
}

const STORES = ["settings", "progress", "chats", "recentSearches"] as const;
type StoreName = typeof STORES[number];
type BackupEntry = [IDBValidKey, unknown];
export interface DataBackup {
  version: 1;
  exportedAt: string;
  stores: Record<StoreName, BackupEntry[]>;
}

async function entries(store: StoreName): Promise<BackupEntry[]> {
  const database = await db;
  const tx = database.transaction(store, "readonly");
  const objectStore = tx.objectStore(store);
  const [keys, values] = await Promise.all([request(objectStore.getAllKeys()), request(objectStore.getAll())]);
  return keys.map((key, index) => [key, values[index]]);
}

export async function exportData(): Promise<DataBackup> {
  const all = await Promise.all(STORES.map(entries));
  return { version: 1, exportedAt: new Date().toISOString(), stores: Object.fromEntries(STORES.map((store, index) => [store, all[index]])) as DataBackup["stores"] };
}

function isBackup(data: unknown): data is DataBackup {
  if (!data || typeof data !== "object" || (data as { version?: unknown }).version !== 1) return false;
  const stores = (data as { stores?: unknown }).stores;
  return Boolean(stores && typeof stores === "object" && STORES.every((store) => Array.isArray((stores as Record<string, unknown>)[store])));
}

async function replaceEntries(store: StoreName, values: BackupEntry[]) {
  const database = await db;
  const tx = database.transaction(store, "readwrite");
  const objectStore = tx.objectStore(store);
  objectStore.clear();
  values.forEach(([key, value]) => objectStore.put(value, key));
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function importData(data: unknown) {
  if (!isBackup(data)) throw new Error("That file is not an Up to here backup.");
  await Promise.all(STORES.map((store) => replaceEntries(store, data.stores[store])));
}

export async function loadCredentials(): Promise<Credentials | null> {
  const saved = await get<Credentials>("settings", "credentials");
  if (saved?.apiKey) return saved;

  // Migrate the app's original localStorage credentials once, then remove them.
  const apiKey = localStorage.getItem(LEGACY_KEY);
  const legacyProvider = localStorage.getItem(LEGACY_PROVIDER);
  if (!apiKey) return null;
  const provider: StoredProvider = legacyProvider === "openai" || legacyProvider === "gemini" ? legacyProvider : "anthropic";
  const credentials = { provider, apiKey };
  await put("settings", credentials, "credentials");
  localStorage.removeItem(LEGACY_KEY);
  localStorage.removeItem(LEGACY_PROVIDER);
  return credentials;
}

export const saveCredentials = (credentials: Credentials) => put("settings", credentials, "credentials");
export async function clearCredentials() {
  await remove("settings", "credentials");
  localStorage.removeItem(LEGACY_KEY);
  localStorage.removeItem(LEGACY_PROVIDER);
}

export const getProgress = (showId: number) => get<StoredPosition>("progress", showId);
export const saveProgress = (showId: number, position: StoredPosition) => put("progress", position, showId);

const chatKey = (showId: number, position: StoredPosition) => `${showId}:S${position.season}E${position.episode}`;
export const getChat = (showId: number, position: StoredPosition) => get<StoredChatMessage[]>("chats", chatKey(showId, position));
export const saveChat = (showId: number, position: StoredPosition, messages: StoredChatMessage[]) =>
  put("chats", messages, chatKey(showId, position));

export async function clearShowData(showId: number) {
  await remove("progress", showId);
  const database = await db;
  const read = database.transaction("chats", "readonly");
  const keys = await request(read.objectStore("chats").getAllKeys());
  const tx = database.transaction("chats", "readwrite");
  const chats = tx.objectStore("chats");
  keys.filter((key): key is string => typeof key === "string" && key.startsWith(`${showId}:`)).forEach((key) => chats.delete(key));
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export const getRecentShows = () => get<ShowHit[]>("recentSearches", "shows").then((shows) => Array.isArray(shows) ? shows : []);
export async function saveRecentShow(show: ShowHit) {
  const shows = await getRecentShows();
  const next = [show, ...shows.filter((saved) => saved.id !== show.id)].slice(0, 6);
  await put("recentSearches", next, "shows");
  return next;
}
import type { ShowHit } from "./tvmaze";
