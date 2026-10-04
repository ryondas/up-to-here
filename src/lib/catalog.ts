// Builds the episode catalog for a show and caches Wikipedia lookups per season.
import { getEpisodes, type TvEpisode } from "./tvmaze";
import { getSeasonSummaries, type SeasonSource } from "./wikipedia";

export interface Episode {
  season: number;
  number: number;
  title: string;
  airdate?: string;
  /** Best available summary: Wikipedia plot summary if found, else TVmaze blurb. */
  summary: string;
  source: "wikipedia" | "tvmaze" | "none";
}

export interface Position { season: number; episode: number; }

export const isSeen = (e: { season: number; number: number }, p: Position) =>
  e.season < p.season || (e.season === p.season && e.number <= p.episode);

export class ShowCatalog {
  private skeleton: TvEpisode[] = [];
  private wiki = new Map<number, Promise<SeasonSource | null>>();
  readonly sources = new Map<number, SeasonSource>();
  readonly showId: number;
  readonly showName: string;
  constructor(showId: number, showName: string) { this.showId = showId; this.showName = showName; }

  async load() {
    this.skeleton = await getEpisodes(this.showId);
    return this;
  }

  get seasons(): number[] { return [...new Set(this.skeleton.map((e) => e.season))].sort((a, b) => a - b); }
  episodeCount(season: number) { return this.skeleton.filter((e) => e.season === season).length; }
  /** Episode artwork is shown in the picker without exposing future episode titles or summaries. */
  episodeThumbnails(season: number) {
    return new Map(this.skeleton.filter((e) => e.season === season).map((e) => [e.number, e.image]));
  }

  /** Titles are only exposed for episodes the viewer has seen — future titles can spoil. */
  seenSkeleton(p: Position) { return this.skeleton.filter((e) => isSeen(e, p)); }

  /** Fetch Wikipedia summaries ONLY for seasons at or before the viewer's position. */
  private seasonWiki(season: number, overrideTitle?: string) {
    const key = season;
    if (overrideTitle) this.wiki.delete(key);
    if (!this.wiki.has(key)) {
      this.wiki.set(key, getSeasonSummaries(this.showName, season, this.seasons.length, overrideTitle)
        .then((s) => { if (s) this.sources.set(season, s); return s; })
        .catch(() => null));
    }
    return this.wiki.get(key)!;
  }

  setOverride(season: number, title: string) { return this.seasonWiki(season, title); }

  /** The single choke point every agent tool goes through. Throws for anything past the position. */
  async getEpisode(season: number, number: number, p: Position): Promise<Episode> {
    if (!isSeen({ season, number }, p)) throw new SpoilerGateError(season, number);
    const base = this.skeleton.find((e) => e.season === season && e.number === number);
    if (!base) throw new Error(`No episode S${season}E${number}`);
    const wiki = await this.seasonWiki(season);
    const w = wiki?.episodes.find((x) => x.numberInSeason === number)
      ?? wiki?.episodes[number - 1]; // fall back to order on the page
    const summary = w?.summary || base.summary;
    return { ...base, summary, source: w?.summary ? "wikipedia" : base.summary ? "tvmaze" : "none" };
  }

  async getSeenEpisodes(p: Position): Promise<Episode[]> {
    return Promise.all(this.seenSkeleton(p).map((e) => this.getEpisode(e.season, e.number, p)));
  }
}

export class SpoilerGateError extends Error {
  constructor(season: number, number: number) {
    super(`S${season}E${number} is after the viewer's current position and is not available.`);
  }
}
