/**
 * The product site (`/` for visitors, `/about` for everyone). The page is itself a film: a title sequence through the
 * letters, a scroll-scrubbed engine with its NLE, kinetic type, a live format morph, a spec that types itself into a
 * film, a 3D wall of the starter films, the engine reel, Claude, the waitlist. Everything is the studio's own work:
 * the live sections run the engine in the browser, the video loops were rendered by it (web/public/site/media).
 */
import { useCallback, useEffect, useState } from "react";
import { Hero } from "./sections/Hero";
import { Playhead } from "./sections/Playhead";
import { Kinetic } from "./sections/Kinetic";
import { Formats } from "./sections/Formats";
import { Build } from "./sections/Build";
import { Features, Wall } from "./sections/Showcase";
import { Claude, Join, SiteFooter } from "./sections/Closing";
import { Cursor, Leader, SiteNav } from "./sections/Chrome";
import "./site.css";

export const Landing = () => {
  const [ready, setReady] = useState(false);
  const done = useCallback(() => setReady(true), []);
  useEffect(() => {
    document.title = "Motion Studio — motion graphics, directed by AI";
    // the page mounts after the session check, so the browser's own jump to #section has already missed
    const id = location.hash.slice(1);
    if (id) requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView());
  }, []);
  return (
    <div className={`site ${ready ? "is-ready" : ""}`}>
      {!ready && <Leader onDone={done} />}
      <Cursor />
      <SiteNav />
      <main id="top">
        <Hero reel="/site/media/showreel.mp4" poster="/site/media/showreel.jpg" ready={ready} />
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
