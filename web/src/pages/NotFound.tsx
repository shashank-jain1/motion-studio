import { Link } from "react-router-dom";
import { Wordmark } from "../components/AppBar";
import { SlateStripe } from "../components/ui";

export const NotFound = () => (
  <div className="center-screen">
    <div className="nf-card">
      <SlateStripe />
      <div className="nf-body">
        <Wordmark />
        <div className="nf-code mono">404 <span className="dim">· NO SIGNAL</span></div>
        <p className="serif-line">Nothing on this frame.</p>
        <Link to="/" className="btn">Back to projects</Link>
      </div>
    </div>
  </div>
);
