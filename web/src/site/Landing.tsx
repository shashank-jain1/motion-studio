/**
 * The product site (`/` for visitors, `/about` for everyone). The page is itself a film: a title over a live timeline
 * strip, a scroll-scrubbed engine with its NLE, kinetic type, a live format morph, a spec that types itself into a
 * film, a 3D wall of the site's films, the engine reel, Claude, the waitlist. Everything is the studio's own work:
 * the live sections run the engine in the browser, the video loops were rendered by it (web/public/site/media).
 */
import { useEffect } from "react";
import { Hero } from "./sections/Hero";
import { Playhead } from "./sections/Playhead";
import { Kinetic } from "./sections/Kinetic";
import { Formats } from "./sections/Formats";
import { Build } from "./sections/Build";
import { Features, Wall } from "./sections/Showcase";
import { Claude, Join, SiteFooter } from "./sections/Closing";
import { Cursor, SiteNav } from "./sections/Chrome";
import "./site.css";

export const Landing = () => {
  useEffect(() => {
    document.title = "Motion Studio — motion graphics, directed by AI";
    // the page mounts after the session check, so the browser's own jump to #section has already missed
    const id = location.hash.slice(1);
    if (id) requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView());
  }, []);
  return (
    <div className="site">
      <Cursor />
      <SiteNav />
      <main id="top">
        <Hero />
        <Playhead />
        <Kinetic />
        <Formats />
        <Build />
        <Wall />
        <Features />
        <Claude />
        <Join />
      </main>
      <SiteFooter />
    </div>
  );
};

export default Landing;
