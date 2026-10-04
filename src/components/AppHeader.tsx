import type { Position } from "../lib/catalog";
import type { Route } from "../lib/route";

/** Title (links home), profile and Settings links, and a breadcrumb off the search page. Never shows episode titles. */
export function AppHeader({ route, profileName, showName, position }: {
  route: Route; profileName: string; showName?: string; position?: Position | null;
}) {
  const crumbs = route.name === "settings" ? ["Settings"]
    : route.name === "show" && showName ? [showName, ...(position ? [`S${position.season}E${position.episode}`] : [])]
    : [];
  return (
    <>
      <header className="top">
        <h1><a className="home" href="#/">Up to here</a></h1>
        <div className="header-actions">
          <a className="link" href="#/profiles" title="Switch or manage profiles">{profileName}</a>
          <a className="link" href="#/settings" aria-current={route.name === "settings" ? "page" : undefined}>Settings</a>
        </div>
      </header>
      {crumbs.length > 0 && (
        <nav className="crumbs" aria-label="Breadcrumb">
          <ol>
            <li><a href="#/">All shows</a></li>
            {crumbs.map((crumb, i) => <li key={crumb} aria-current={i === crumbs.length - 1 ? "page" : undefined}>{crumb}</li>)}
          </ol>
        </nav>
      )}
    </>
  );
}
