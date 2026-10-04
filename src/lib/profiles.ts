// Netflix/Prime-style profile switching. Each profile gets its own IndexedDB
// database (see dbNameForProfile), so progress/chats/credentials/caches are
// fully isolated — importing a backup, or anything else, can never touch
// another profile's data. The registry itself (names + which is active) is
// tiny and needs to be readable synchronously before any IndexedDB is open,
// so it lives in localStorage rather than inside a profile's own database.
export interface Profile { id: string; name: string; }

const PROFILES_KEY = "uth-profiles";
const ACTIVE_KEY = "uth-active-profile";
const DEFAULT_PROFILE: Profile = { id: "default", name: "Me" };

function readProfiles(): Profile[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(PROFILES_KEY) ?? "null");
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : [DEFAULT_PROFILE];
  } catch {
    return [DEFAULT_PROFILE];
  }
}

const writeProfiles = (profiles: Profile[]) => localStorage.setItem(PROFILES_KEY, JSON.stringify(profiles));

export const listProfiles = (): Profile[] => readProfiles();

export function getActiveProfileId(): string {
  const profiles = readProfiles();
  let id: string | null = null;
  try { id = localStorage.getItem(ACTIVE_KEY); } catch { /* no-op — falls through to the first profile */ }
  return id && profiles.some((p) => p.id === id) ? id : profiles[0].id;
}

export const setActiveProfile = (id: string) => localStorage.setItem(ACTIVE_KEY, id);

/** "default" keeps the app's original, unsuffixed database name — existing single-profile users need no migration. */
export const dbNameForProfile = (id: string) => (id === "default" ? "up-to-here" : `up-to-here:${id}`);

export function createProfile(name: string): Profile {
  const id = crypto.randomUUID?.() ?? `p${Date.now()}`;
  const profile = { id, name };
  writeProfiles([...readProfiles(), profile]);
  return profile;
}

export async function deleteProfile(id: string): Promise<void> {
  const profiles = readProfiles();
  if (profiles.length <= 1) throw new Error("You can't delete your only profile.");
  writeProfiles(profiles.filter((p) => p.id !== id));
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(dbNameForProfile(id));
    req.onsuccess = () => resolve();
    req.onerror = () => resolve(); // best effort — the registry entry is already gone either way
    req.onblocked = () => resolve();
  });
}
