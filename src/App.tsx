import { useEffect, useMemo, useRef, useState } from "react";
import { ShowCatalog, type Position } from "./lib/catalog";
import { makeClient, type AgentClient, type TurnUsage } from "./agent/agent";
import { friendlyError } from "./lib/errors";
import { useRoute } from "./lib/route";
import { getShow } from "./lib/tvmaze";
import {
  clearCredentials, clearShowData, exportData, getProgress, importData, loadCredentials, saveCredentials, saveLibraryEntry, saveProgress,
  type Credentials,
} from "./lib/storage";
import { getActiveProfileId, listProfiles, type Profile } from "./lib/profiles";
import { ApiKeyTab } from "./components/ApiKeyTab";
import { Chat } from "./components/Chat";
import { KeyScreen } from "./components/KeyScreen";
import { PositionPicker } from "./components/PositionPicker";
import { ProfilesTab } from "./components/ProfilesTab";
import { ShowSearch } from "./components/ShowSearch";

/** Where to open a show when the URL doesn't say: saved progress, else the first episode. */
async function savedPosition(c: ShowCatalog): Promise<Position> {
  const saved = await getProgress(c.showId).catch(() => undefined);
  const season = saved && c.seasons.includes(saved.season) ? saved.season : c.seasons[0] ?? 1;
  const episode = saved && saved.season === season && saved.episode <= c.episodeCount(season) ? saved.episode : 1;
  return { season, episode };
}

const isValidPosition = (c: ShowCatalog, p: Position) =>
  c.seasons.includes(p.season) && p.episode <= c.episodeCount(p.season);

export default function App() {
  const [credentials, setCredentials] = useState<Credentials | null>(null);
  const [storageReady, setStorageReady] = useState(false);
  const client = useMemo<AgentClient | null>(() => credentials?.apiKey ? makeClient(credentials.provider, credentials.apiKey) : null, [credentials]);

  const [route, navigate] = useRoute();
  const [catalog, setCatalog] = useState<ShowCatalog | null>(null);
  const [loadFailure, setLoadFailure] = useState<{ showId: number; message: string } | null>(null);
  const [storageNotice, setStorageNotice] = useState("");
  const [usage, setUsage] = useState({ agentIn: 0, agentOut: 0, guardIn: 0, guardOut: 0 });
  const [view, setView] = useState<"main" | "apiKey" | "profiles">("main");
  const [pendingQuestion, setPendingQuestion] = useState("");
  const [profiles] = useState<Profile[]>(() => listProfiles());
  const activeProfileId = useMemo(() => getActiveProfileId(), []);
  const activeProfile = profiles.find((p) => p.id === activeProfileId) ?? profiles[0];
  const importRef = useRef<HTMLInputElement | null>(null);
  const addUsage = (u: TurnUsage) => setUsage((prev) => ({
    agentIn: prev.agentIn + u.agent.input, agentOut: prev.agentOut + u.agent.output,
    guardIn: prev.guardIn + u.guard.input, guardOut: prev.guardOut + u.guard.output,
  }));

  useEffect(() => {
    loadCredentials().then(setCredentials).catch(() => undefined).finally(() => setStorageReady(true));
  }, []);
  // The URL owns the show and position; these are only set once the catalog for that show is loaded.
  const routeShowId = route.name === "show" ? route.showId : null;
  const showCatalog = catalog && catalog.showId === routeShowId ? catalog : null;
  const urlPosition = route.name === "show" ? route.position : undefined;
  const position = showCatalog && urlPosition && isValidPosition(showCatalog, urlPosition) ? urlPosition : null;
  const showError = loadFailure && loadFailure.showId === routeShowId ? loadFailure.message : "";

  // Opened from a link or a refresh: load the show named in the URL.
  useEffect(() => {
    if (!client || routeShowId === null || catalog?.showId === routeShowId) return;
    let active = true;
    getShow(routeShowId).then((hit) => new ShowCatalog(hit.id, hit.name, hit.image).load())
      .then((c) => { if (active) setCatalog(c); })
      .catch((e) => { if (active) setLoadFailure({ showId: routeShowId, message: friendlyError(e, "shows") }); });
    return () => { active = false; };
  }, [client, routeShowId, catalog]);
  // No usable position in the URL: fill in saved progress without adding a Back step.
  useEffect(() => {
    if (!showCatalog || position) return;
    let active = true;
    void savedPosition(showCatalog).then((p) => {
      if (active) navigate({ name: "show", showId: showCatalog.showId, position: p }, { replace: true });
    });
    return () => { active = false; };
  }, [showCatalog, position, navigate]);
  useEffect(() => {
    if (showCatalog && position) {
      void saveProgress(showCatalog.showId, position).catch(() => undefined);
      void saveLibraryEntry({ id: showCatalog.showId, name: showCatalog.showName, image: showCatalog.image }, position).catch(() => undefined);
    }
  }, [showCatalog, position]);

  if (!storageReady) return <main className="narrow"><p className="status">Loading saved data…</p></main>;
  if (view === "profiles") return <ProfilesTab profiles={profiles} activeProfileId={activeProfileId} onBack={() => setView("main")} />;
  if (!client) return <KeyScreen initialProvider={credentials?.provider ?? "anthropic"} profileName={activeProfile.name}
    onSwitchProfile={() => setView("profiles")}
    onSave={async (nextProvider, key, remember) => {
      const next = { provider: nextProvider, apiKey: key };
      if (remember) await saveCredentials(next).catch(() => undefined);
      else await clearCredentials().catch(() => undefined);
      setCredentials(next);
    }} />;
  return (
    <main>
      <header className="top">
        <h1>Up to here</h1>
        <div className="header-actions">
          <button className="link" onClick={() => setView("profiles")} title="Switch or manage profiles">{activeProfile.name}</button>
          <button className="link" title="Only this profile's data" onClick={() => { void exportData().then((backup) => {
            const href = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" }));
            const download = document.createElement("a");
            download.href = href; download.download = `up-to-here-${activeProfile.name.toLowerCase().replace(/\s+/g, "-")}-backup.json`; download.click(); URL.revokeObjectURL(href);
            setStorageNotice("Data exported for this profile.");
          }).catch(() => setStorageNotice("Couldn’t export your local data.")); }}>Export data</button>
          <button className="link" title="Only replaces this profile's data — other profiles are untouched" onClick={() => importRef.current?.click()}>Import data</button>
          <input ref={importRef} className="visually-hidden" type="file" accept="application/json" onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = "";
            if (!file) return;
            void file.text().then(JSON.parse).then(importData).then(() => window.location.reload()).catch((error: unknown) => {
              setStorageNotice(error instanceof Error ? error.message : "Couldn’t import that file.");
            });
          }} />
          <button className="link" onClick={() => setView((v) => (v === "apiKey" ? "main" : "apiKey"))}>{view === "apiKey" ? "← Back" : "API Key"}</button>
        </div>
      </header>
      {storageNotice && <p className="status">{storageNotice}</p>}
      {view === "apiKey" ? (
        <ApiKeyTab provider={client.provider} apiKey={credentials?.apiKey ?? ""} usage={usage}
          onChangeKey={() => { void clearCredentials().catch(() => undefined); setCredentials(null); }} />
      ) : route.name === "search" ? (
        <ShowSearch onPick={async (hit, openingQuestion) => {
          const c = await new ShowCatalog(hit.id, hit.name, hit.image).load();
          const p = await savedPosition(c);
          setCatalog(c);
          setPendingQuestion(openingQuestion ?? "");
          navigate({ name: "show", showId: c.showId, position: p });
        }} />
      ) : !showCatalog || !position ? (
        <p className="status">
          {showError || "Loading show…"}{" "}
          {showError && <button className="link" onClick={() => navigate({ name: "search" })}>Pick another show</button>}
        </p>
      ) : (
        <>
          <div className="show-row">
            <h2>{showCatalog.showName}</h2>
            <div className="show-actions">
              <button className="link" onClick={async () => {
                if (!window.confirm(`Clear all saved progress and chat history for "${showCatalog.showName}"? This can't be undone.`)) return;
                await clearShowData(showCatalog.showId).catch(() => undefined);
                setCatalog(null);
                navigate({ name: "search" });
              }}>Clear this show</button>
              <button className="link" onClick={() => navigate({ name: "search" })}>Pick another show</button>
            </div>
          </div>
          {/* Picking an episode replaces the URL, so Back leaves the show instead of stepping through episodes. */}
          <PositionPicker catalog={showCatalog} position={position}
            onChange={(p) => navigate({ name: "show", showId: showCatalog.showId, position: p }, { replace: true })} />
          <Chat key={`${showCatalog.showId}:${position.season}:${position.episode}`} client={client} catalog={showCatalog} position={position} onUsage={addUsage}
            initialQuestion={pendingQuestion} onConsumeInitialQuestion={() => setPendingQuestion("")} />
        </>
      )}
    </main>
  );
}
