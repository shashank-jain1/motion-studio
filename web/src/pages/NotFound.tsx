import { Link } from "react-router-dom";
import { Logo } from "../components/Icons";

export const NotFound = () => (
  <div className="center-screen">
    <Logo size={40} />
    <h1 className="display-sm">Nothing on this frame</h1>
    <p className="muted">That page doesn't exist.</p>
    <Link to="/" className="btn">Back to projects</Link>
  </div>
);
