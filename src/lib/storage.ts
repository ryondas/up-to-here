export type StoredProvider = "anthropic" | "openai" | "gemini";
export interface Credentials { provider: StoredProvider; apiKey: string; }
export interface StoredPosition { season: number; episode: number; }
export interface StoredChatMessage {
  role: "user" | "assistant";
  content: string;
  safe?: boolean;
  revealed?: boolean;
  sources?: string[];
  tokens?: number;
}
export interface LibraryEntry { show: ShowHit; position: StoredPosition; updatedAt: string; }

const DB_VERSION = 4;
const LEGACY_KEY = "uth-api-key";
const LEGACY_PROVIDER = "uth-api-provider";

function request<T>(value: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    value.onsuccess = () => resolve(value.result);
    value.onerror = () => reject(value.error);
  });
}

// Opened lazily (not at module load) so importing this module is safe in non-browser
// contexts, e.g. the Node test suite, where `indexedDB` doesn't exist. Keyed to the
// active profile at the time of first use — switching profiles reloads the page
// (see src/lib/profiles.ts), so this never needs to swap databases mid-session.
let dbPromise: Promise<IDBDatabase> | null = null;
function openDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      const open = indexedDB.open(dbNameForProfile(getActiveProfileId()), DB_VERSION);
      open.onupgradeneeded = () => {
        const database = open.result;
        if (!database.objectStoreNames.contains("settings")) database.createObjectStore("settings");
        if (!database.objectStoreNames.contains("progress")) database.createObjectStore("progress");
        if (!database.objectStoreNames.contains("chats")) database.createObjectStore("chats");
        if (!database.objectStoreNames.contains("recentSearches")) database.createObjectStore("recentSearches");
        if (!database.objectStoreNames.contains("wikiCache")) database.createObjectStore("wikiCache");
        if (!database.objectStoreNames.contains("library")) database.createObjectStore("library");
        if (!database.objectStoreNames.contains("episodeCache")) database.createObjectStore("episodeCache");
        if (!database.objectStoreNames.contains("suggestedCache")) database.createObjectStore("suggestedCache");
        if (!database.objectStoreNames.contains("castCache")) database.createObjectStore("castCache");
      };
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
  }
  return dbPromise;
}

async function get<T>(store: string, key: IDBValidKey): Promise<T | undefined> {
  const database = await openDb();
  const tx = database.transaction(store, "readonly");
  return request(tx.objectStore(store).get(key));
}

async function put(store: string, value: unknown, key: IDBValidKey) {
  const database = await openDb();
  const tx = database.transaction(store, "readwrite");
  await request(tx.objectStore(store).put(value, key));
}

async function remove(store: string, key: IDBValidKey) {
  const database = await openDb();
  const tx = database.transaction(store, "readwrite");
  await request(tx.objectStore(store).delete(key));
}

const STORES = ["settings", "progress", "chats", "recentSearches", "wikiCache", "library", "episodeCache", "suggestedCache", "castCache"] as const;
type StoreName = typeof STORES[number];
type BackupEntry = [IDBValidKey, unknown];
export interface DataBackup {
  version: 1;
  exportedAt: string;
  stores: Record<StoreName, BackupEntry[]>;
}

async function entries(store: StoreName): Promise<BackupEntry[]> {
  const database = await openDb();
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
  const database = await openDb();
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

async function clearPrefixed(database: IDBDatabase, store: StoreName, prefix: string) {
  const read = database.transaction(store, "readonly");
  const keys = await request(read.objectStore(store).getAllKeys());
  const tx = database.transaction(store, "readwrite");
  const objectStore = tx.objectStore(store);
  keys.filter((key): key is string => typeof key === "string" && key.startsWith(prefix)).forEach((key) => objectStore.delete(key));
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function clearShowData(showId: number) {
  await remove("progress", showId);
  await remove("library", showId);
  await remove("episodeCache", showId);
  await remove("castCache", showId);
  const database = await openDb();
  await clearPrefixed(database, "chats", `${showId}:`);
  await clearPrefixed(database, "wikiCache", `${showId}:`);
}

export const getRecentShows = () => get<ShowHit[]>("recentSearches", "shows").then((shows) => Array.isArray(shows) ? shows : []);
export async function saveRecentShow(show: ShowHit) {
  const shows = await getRecentShows();
  const next = [show, ...shows.filter((saved) => saved.id !== show.id)].slice(0, 6);
  await put("recentSearches", next, "shows");
  return next;
}

const wikiCacheKey = (showId: number, season: number) => `${showId}:${season}`;
export const getWikiCache = (showId: number, season: number) => get<SeasonSource>("wikiCache", wikiCacheKey(showId, season));
export const saveWikiCache = (showId: number, season: number, source: SeasonSource) => put("wikiCache", source, wikiCacheKey(showId, season));
export const clearWikiCache = (showId: number, season: number) => remove("wikiCache", wikiCacheKey(showId, season));

export const getLibrary = () => entries("library").then((rows) => (rows.map(([, value]) => value) as LibraryEntry[]).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
export const saveLibraryEntry = (show: ShowHit, position: StoredPosition) => put("library", { show, position, updatedAt: new Date().toISOString() } satisfies LibraryEntry, show.id);
export const removeLibraryEntry = (showId: number) => remove("library", showId);

interface EpisodeCacheEntry { episodes: TvEpisode[]; cachedAt: string; }
const EPISODE_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // a day — long enough to skip repeat fetches, short enough that airing shows pick up new episodes promptly
export async function getEpisodeCache(showId: number): Promise<TvEpisode[] | undefined> {
  const entry = await get<EpisodeCacheEntry>("episodeCache", showId);
  if (!entry || Date.now() - new Date(entry.cachedAt).getTime() > EPISODE_CACHE_TTL_MS) return undefined;
  return entry.episodes;
}
export const saveEpisodeCache = (showId: number, episodes: TvEpisode[]) =>
  put("episodeCache", { episodes, cachedAt: new Date().toISOString() } satisfies EpisodeCacheEntry, showId);

interface TrendingCacheEntry { shows: TrendingShow[]; cachedAt: string; }
const TRENDING_CACHE_TTL_MS = 6 * 60 * 60 * 1000; // shorter than the episode cache — this is meant to actually rotate
export async function getTrendingCache(): Promise<TrendingShow[] | undefined> {
  const entry = await get<TrendingCacheEntry>("suggestedCache", "shows");
  if (!entry || Date.now() - new Date(entry.cachedAt).getTime() > TRENDING_CACHE_TTL_MS) return undefined;
  return entry.shows;
}
export const saveTrendingCache = (shows: TrendingShow[]) =>
  put("suggestedCache", { shows, cachedAt: new Date().toISOString() } satisfies TrendingCacheEntry, "shows");

const CAST_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
interface CastCacheEntry { cast: CastMember[]; cachedAt: string; }
export async function getCastCache(showId: number): Promise<CastMember[] | undefined> {
  const entry = await get<CastCacheEntry>("castCache", showId);
  if (!entry || Date.now() - new Date(entry.cachedAt).getTime() > CAST_CACHE_TTL_MS) return undefined;
  return entry.cast;
}
export const saveCastCache = (showId: number, cast: CastMember[]) =>
  put("castCache", { cast, cachedAt: new Date().toISOString() } satisfies CastCacheEntry, showId);

import type { CastMember, ShowHit, TrendingShow, TvEpisode } from "./tvmaze";
import type { SeasonSource } from "./wikipedia";
import { dbNameForProfile, getActiveProfileId } from "./profiles";
