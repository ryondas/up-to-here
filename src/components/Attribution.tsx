import { useState } from "react";
import type { ShowCatalog } from "../lib/catalog";

export function Attribution({ catalog, season }: { catalog: ShowCatalog; season: number }) {
  const [, forceUpdate] = useState(0);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState("");
  const [status, setStatus] = useState("");
  const pages = [...catalog.sources.values()];
  const wikiPages = pages.filter((p) => p.origin === "wikipedia");
  const fandomPages = pages.filter((p) => p.origin === "fandom");
  const hasSource = catalog.sources.has(season);

  const save = async () => {
    const t = title.trim();
    if (!t) return;
    setStatus("Looking up that page…");
    const result = await catalog.setOverride(season, t).catch(() => null);
    if (!result) { setStatus("Couldn’t find episode summaries on that page."); return; }
    setStatus(""); setEditing(false); setTitle("");
    forceUpdate((n) => n + 1); // catalog.sources mutated in place; re-render to pick it up
  };

  return (
    <>
      <p className="attrib">
        Episode data from <a href="https://www.tvmaze.com" target="_blank" rel="noreferrer">TVmaze</a>
        {wikiPages.length > 0 && <> and Wikipedia ({wikiPages.map((p, i) => <span key={p.url}>{i > 0 && ", "}<a href={p.url} target="_blank" rel="noreferrer">{p.pageTitle}</a></span>)}), CC BY-SA 4.0</>}
        {fandomPages.length > 0 && <> and Fandom ({fandomPages.map((p, i) => <span key={p.url}>{i > 0 && ", "}<a href={p.url} target="_blank" rel="noreferrer">{p.pageTitle}</a></span>)}), CC BY-SA 4.0</>}.
        {" "}<button className="link" onClick={() => setEditing((e) => !e)}>{hasSource ? "Wrong page?" : "Missing summaries?"}</button>
      </p>
      {editing && (
        <div className="row override">
          <input value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void save()}
            placeholder={`Wikipedia page for season ${season}, e.g. "${catalog.showName} (season ${season})"`} aria-label="Wikipedia page title" />
          <button className="link" onClick={() => { void save(); }}>Use this page</button>
        </div>
      )}
      {status && <p className="status">{status}</p>}
    </>
  );
}
