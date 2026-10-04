// Hash routes, so any static host can serve them without rewrite rules.
// URLs carry only ids and episode numbers, never titles: titles can spoil.
import { useCallback, useEffect, useState } from "react";
import type { Position } from "./catalog";

export type Route =
  | { name: "search" }
  | { name: "show"; showId: number; position?: Position };

const positiveInt = (value: string | null | undefined) => {
  const n = Number(value);
  return value && Number.isInteger(n) && n > 0 ? n : undefined;
};

/** Parses `#/show/123?s=2&e=4`; anything unrecognized falls back to search. */
export function parseRoute(hash: string): Route {
  const [path, query = ""] = hash.replace(/^#/, "").split("?");
  const match = /^\/show\/([^/]+)\/?$/.exec(path);
  const showId = positiveInt(match?.[1]);
  if (!showId) return { name: "search" };
  const params = new URLSearchParams(query);
  const season = positiveInt(params.get("s"));
  const episode = positiveInt(params.get("e"));
  return season && episode ? { name: "show", showId, position: { season, episode } } : { name: "show", showId };
}

export function routeHash(route: Route): string {
  if (route.name === "search") return "#/";
  const position = route.position ? `?s=${route.position.season}&e=${route.position.episode}` : "";
  return `#/show/${route.showId}${position}`;
}

/** Current route plus `navigate`. Use `replace` for changes that shouldn't add a Back step. */
export function useRoute() {
  const [route, setRoute] = useState(() => parseRoute(window.location.hash));
  useEffect(() => {
    const onChange = () => setRoute(parseRoute(window.location.hash));
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  const navigate = useCallback((next: Route, { replace = false } = {}) => {
    const hash = routeHash(next);
    if (hash === window.location.hash) return;
    if (replace) {
      // replaceState doesn't fire hashchange, so update state directly.
      window.history.replaceState(window.history.state, "", hash);
      setRoute(parseRoute(hash));
    } else {
      window.location.hash = hash;
    }
  }, []);
  return [route, navigate] as const;
}
