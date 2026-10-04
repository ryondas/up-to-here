import { useEffect, useMemo, useState } from "react";
import { ShowCatalog, type Position } from "./lib/catalog";
import { makeClient, makeFreeClient, type AgentClient, type TurnUsage } from "./agent/agent";
import { friendlyError } from "./lib/errors";
import { useRoute } from "./lib/route";
import { getShow } from "./lib/tvmaze";
import {
  clearCredentials, clearShowData, getProgress, loadCredentials, saveCredentials, saveLibraryEntry, saveProgress,
  type Credentials,
} from "./lib/storage";
import { getActiveProfileId, listProfiles, type Profile } from "./lib/profiles";
import { AppHeader } from "./components/AppHeader";
import { ClearShowButton } from "./components/ClearShowButton";
import { Chat } from "./components/Chat";
import { KeyScreen } from "./components/KeyScreen";
import { PositionPicker } from "./components/PositionPicker";
import { ProfilesTab } from "./components/ProfilesTab";
import { Settings } from "./components/Settings";
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
  // No saved key means the free tier, so new visitors can start asking straight away.
  const client = useMemo<AgentClient>(() => credentials?.apiKey ? makeClient(credentials.provider, credentials.apiKey) : makeFreeClient(), [credentials]);
  const [freeRemaining, setFreeRemaining] = useState<number | null>(null);
  const [keyReturnsBack, setKeyReturnsBack] = useState(false);

  const [route, navigate] = useRoute();
  const [catalog, setCatalog] = useState<ShowCatalog | null>(null);
  const [loadFailure, setLoadFailure] = useState<{ showId: number; message: string } | null>(null);
  const [usage, setUsage] = useState({ agentIn: 0, agentOut: 0, guardIn: 0, guardOut: 0 });
  const [pendingQuestion, setPendingQuestion] = useState("");
  const [profiles] = useState<Profile[]>(() => listProfiles());
  const activeProfileId = useMemo(() => getActiveProfileId(), []);
  const activeProfile = profiles.find((p) => p.id === activeProfileId) ?? profiles[0];
  const openKeyScreen = () => { setKeyReturnsBack(true); navigate({ name: "key" }); };
  // Back to wherever the key screen was opened from; a direct visit to #/key goes home instead.
  const leaveKeyScreen = () => {
    if (keyReturnsBack) { setKeyReturnsBack(false); window.history.back(); }
    else navigate({ name: "search" }, { replace: true });
  };
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
    if (routeShowId === null || catalog?.showId === routeShowId) return;
    let active = true;
    getShow(routeShowId).then((hit) => new ShowCatalog(hit.id, hit.name, hit.image).load())
      .then((c) => { if (active) setCatalog(c); })
      .catch((e) => { if (active) setLoadFailure({ showId: routeShowId, message: friendlyError(e, "shows") }); });
    return () => { active = false; };
  }, [routeShowId, catalog]);
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
  if (route.name === "profiles") return <ProfilesTab profiles={profiles} activeProfileId={activeProfileId} onBack={() => navigate({ name: "search" })} />;
  if (route.name === "key") return <KeyScreen initialProvider={credentials?.provider ?? "gemini"} profileName={activeProfile.name}
    onSwitchProfile={() => navigate({ name: "profiles" })}
    onCancel={leaveKeyScreen}
    onSave={async (nextProvider, key, remember) => {
      const next = { provider: nextProvider, apiKey: key };
      if (remember) await saveCredentials(next).catch(() => undefined);
      else await clearCredentials().catch(() => undefined);
      setCredentials(next);
      leaveKeyScreen();
    }} />;
  return (
    <main>
      <AppHeader route={route} profileName={activeProfile.name} showName={showCatalog?.showName} position={position} />
      {route.name === "settings" ? (
        <Settings profileName={activeProfile.name} provider={client.provider} apiKey={credentials?.apiKey ?? ""} usage={usage}
          freeRemaining={freeRemaining} onChangeKey={openKeyScreen}
          onRemoveKey={() => { void clearCredentials().catch(() => undefined); setCredentials(null); }} />
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
              <ClearShowButton onConfirm={async () => {
                await clearShowData(showCatalog.showId).catch(() => undefined);
                setCatalog(null);
                navigate({ name: "search" });
              }} />
            </div>
          </div>
          {/* Picking an episode replaces the URL, so Back leaves the show instead of stepping through episodes. */}
          <PositionPicker catalog={showCatalog} position={position}
            onChange={(p) => navigate({ name: "show", showId: showCatalog.showId, position: p }, { replace: true })} />
          <Chat key={`${showCatalog.showId}:${position.season}:${position.episode}`} client={client} catalog={showCatalog} position={position} onUsage={addUsage}
            initialQuestion={pendingQuestion} onConsumeInitialQuestion={() => setPendingQuestion("")}
            freeRemaining={freeRemaining} onFreeRemaining={setFreeRemaining} onAddKey={openKeyScreen} />
        </>
      )}
    </main>
  );
}
