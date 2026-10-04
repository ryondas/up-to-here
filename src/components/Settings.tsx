import { useRef, useState, type ComponentProps } from "react";
import { exportData, importData } from "../lib/storage";
import { ApiKeyTab } from "./ApiKeyTab";

/** Profile data backup plus the API key and session usage. */
export function Settings({ profileName, ...apiKey }: { profileName: string } & ComponentProps<typeof ApiKeyTab>) {
  const [notice, setNotice] = useState("");
  const importRef = useRef<HTMLInputElement | null>(null);
  return (
    <>
      <section className="settings-data" aria-labelledby="data-title">
        <h2 id="data-title">Your data</h2>
        <p className="hint">Progress, chats and recent searches for <b>{profileName}</b> are saved in this browser only. Export and import cover this profile; other profiles are untouched.</p>
        <div className="row">
          <button className="secondary" onClick={() => { void exportData().then((backup) => {
            const href = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" }));
            const download = document.createElement("a");
            download.href = href; download.download = `up-to-here-${profileName.toLowerCase().replace(/\s+/g, "-")}-backup.json`; download.click(); URL.revokeObjectURL(href);
            setNotice("Data exported for this profile.");
          }).catch(() => setNotice("Couldn’t export your local data.")); }}>Export data</button>
          <button className="secondary" onClick={() => importRef.current?.click()}>Import data</button>
          <input ref={importRef} className="visually-hidden" type="file" accept="application/json" onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = "";
            if (!file) return;
            void file.text().then(JSON.parse).then(importData).then(() => window.location.reload()).catch((error: unknown) => {
              setNotice(error instanceof Error ? error.message : "Couldn’t import that file.");
            });
          }} />
        </div>
        <p className="status" role="status">{notice}</p>
      </section>
      <ApiKeyTab {...apiKey} />
    </>
  );
}
