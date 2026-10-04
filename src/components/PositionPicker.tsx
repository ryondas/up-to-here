import type { Position, ShowCatalog } from "../lib/catalog";

export function PositionPicker({ catalog, position, onChange }: { catalog: ShowCatalog; position: Position; onChange: (p: Position) => void }) {
  const count = catalog.episodeCount(position.season);
  const seenEpisodes = catalog.seenSkeleton(position);
  const seenTitle = seenEpisodes.find((e) => e.season === position.season && e.number === position.episode)?.title;
  const thumbnails = catalog.episodeThumbnails(position.season);
  return (
    <section className="picker">
      <div className="track-head">
        <label>Season{" "}
          <select value={position.season} onChange={(e) => onChange({ season: Number(e.target.value), episode: 1 })}>
            {catalog.seasons.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <span>Tap the last episode you finished</span>
      </div>
      <div className="track" role="group" aria-label="Episodes">
        {Array.from({ length: count }, (_, i) => i + 1).map((n) => {
          const seen = n <= position.episode;
          const thumbnail = thumbnails.get(n);
          return (
            <button key={n} className={`ep ${seen ? "seen" : "future"} ${n === position.episode ? "current" : ""}`}
              aria-pressed={n === position.episode} aria-label={seen ? `Episode ${n}` : `Episode ${n}, not watched yet`}
              onClick={() => onChange({ season: position.season, episode: n })}>
              {thumbnail && <img src={thumbnail} alt="" />}
              <span>{n}</span>
            </button>
          );
        })}
      </div>
      <p className="ep-title">Watched through S{position.season}E{position.episode}{seenTitle ? `: ${seenTitle}` : ""}</p>
    </section>
  );
}
