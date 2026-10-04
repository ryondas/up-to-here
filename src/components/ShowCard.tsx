import type { ReactNode } from "react";
import type { ShowHit } from "../lib/tvmaze";

/** Artwork card used by every browse rail; `variant` is also the CSS class. */
export function ShowCard({ variant, show, image = show.image, title, subtitle, onPick }: {
  variant: "suggestion" | "mood" | "character";
  show: ShowHit;
  /** Overrides the show's artwork, e.g. with a cast photo. */
  image?: string;
  title: string;
  subtitle?: string;
  onPick: () => void;
}) {
  return (
    <button className={variant} onClick={onPick}>
      {image ? <img src={image} alt="" /> : <span className="noart" />}
      <span><b>{title}</b>{subtitle && <small>{subtitle}</small>}</span>
    </button>
  );
}

/** A titled browse section. Shows `status` in place of the rail while it has one. */
export function Rail({ id, title, railClass, status, children }: {
  id: string;
  title: string;
  railClass: string;
  status?: string;
  children?: ReactNode;
}) {
  return (
    <section className="suggested" aria-labelledby={id}>
      <h2 id={id}>{title}</h2>
      {status ? <p className="status">{status}</p> : <div className={railClass}>{children}</div>}
    </section>
  );
}
