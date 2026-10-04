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

export const getRecentSearches = () => get<string[]>("recentSearches", "queries").then((queries) => queries ?? []);
export async function saveRecentSearch(query: string) {
  const normalized = query.trim();
  if (!normalized) return getRecentSearches();
  const queries = await getRecentSearches();
  const next = [normalized, ...queries.filter((q) => q.toLocaleLowerCase() !== normalized.toLocaleLowerCase())].slice(0, 6);
  await put("recentSearches", next, "queries");
  return next;
}
