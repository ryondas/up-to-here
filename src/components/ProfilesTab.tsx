import { useState } from "react";
import { createProfile, deleteProfile, setActiveProfile, type Profile } from "../lib/profiles";

export function ProfilesTab({ profiles, activeProfileId, onBack }: { profiles: Profile[]; activeProfileId: string; onBack: () => void }) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [err, setErr] = useState("");

  const switchTo = (id: string) => {
    if (id === activeProfileId) return;
    setActiveProfile(id);
    window.location.reload();
  };
  const add = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setActiveProfile(createProfile(trimmed).id);
    window.location.reload();
  };
  const remove = async (id: string, label: string) => {
    if (!window.confirm(`Delete the profile "${label}" and everything saved under it? This can't be undone.`)) return;
    try { await deleteProfile(id); window.location.reload(); }
    catch (e) { setErr((e as Error).message); }
  };

  return (
    <main className="narrow">
      <h1>Who's this?</h1>
      <p className="lede">Each profile keeps its own progress, chat history, and API key. Switching — or importing a backup — never touches another profile's data.</p>
      <div className="profile-grid">
        {profiles.map((p) => (
          <div key={p.id} className={`profile-card ${p.id === activeProfileId ? "active" : ""}`}>
            <button className="profile-avatar" onClick={() => switchTo(p.id)} aria-label={`Switch to ${p.name}`}>{p.name.slice(0, 1).toUpperCase()}</button>
            <b>{p.name}</b>
            {p.id === activeProfileId && <small className="hint">Current</small>}
            {profiles.length > 1 && <div className="profile-actions">
              <button className="link" onClick={() => { void remove(p.id, p.name); }}>Delete</button>
            </div>}
          </div>
        ))}
      </div>
      {adding ? (
        <div className="row">
          <input value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} placeholder="Profile name" autoFocus />
          <button className="primary" onClick={add}>Add</button>
        </div>
      ) : <button className="link" onClick={() => setAdding(true)}>+ Add profile</button>}
      {err && <p className="status">{err}</p>}
      <button className="link profiles-back" onClick={onBack}>← Back</button>
    </main>
  );
}
