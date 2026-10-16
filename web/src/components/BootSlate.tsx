import { Logo, Spinner } from "./Icons";
import { SlateStripe } from "./ui";

/** Full-screen loading / fault slate (used while the session resolves). */
export const BootSlate = ({ title, detail, action }: { title?: string; detail?: string; action?: { label: string; onClick: () => void } }) => (
  <div className="boot" role={title ? "alert" : "status"} aria-label={title ?? "Loading"}>
    <div className="boot-card">
      <SlateStripe />
      <div className="boot-body">
        <Logo size={28} />
        {title ? (
          <>
            <div className="boot-title">{title}</div>
            {detail && <div className="boot-detail mono">{detail}</div>}
            {action && <button className="btn" onClick={action.onClick}>{action.label}</button>}
          </>
        ) : (
          <div className="boot-load"><Spinner size={16} /><span className="label">Loading studio</span></div>
        )}
      </div>
    </div>
  </div>
);
