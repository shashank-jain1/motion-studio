import type { SVGProps } from "react";

/**
 * Icon set: 16px grid, 1.5px stroke, square caps, miter joins. Transport glyphs are solid.
 * Keep new icons on the same grid (coordinates on .25 steps so strokes land crisp at 1×/2×).
 */
type P = SVGProps<SVGSVGElement> & { size?: number };
const I = ({ size = 16, children, ...rest }: P & { children: React.ReactNode }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5}
    strokeLinecap="square" strokeLinejoin="miter" aria-hidden="true" focusable="false" {...rest}>{children}</svg>
);
const solid = { fill: "currentColor", stroke: "none" } as const;

// transport
export const IconPlay = (p: P) => <I {...p}><path d="M4 2.5v11L13 8 4 2.5Z" {...solid} /></I>;
export const IconPause = (p: P) => <I {...p}><path d="M3.5 2.5h3v11h-3zM9.5 2.5h3v11h-3z" {...solid} /></I>;
export const IconStop = (p: P) => <I {...p}><path d="M3.5 3.5h9v9h-9z" {...solid} /></I>;
export const IconRecord = (p: P) => <I {...p}><circle cx="8" cy="8" r="4.5" {...solid} /></I>;
export const IconStepBack = (p: P) => <I {...p}><path d="M12.5 3v10L5.5 8l7-5Z" {...solid} /><path d="M3.25 3.5v9" /></I>;
export const IconStepFwd = (p: P) => <I {...p}><path d="M3.5 3v10l7-5-7-5Z" {...solid} /><path d="M12.75 3.5v9" /></I>;
export const IconToStart = (p: P) => <I {...p}><path d="M3.25 3v10" /><path d="M8.5 3v10L4.5 8l4-5ZM13.5 3v10l-4-5 4-5Z" {...solid} /></I>;
export const IconToEnd = (p: P) => <I {...p}><path d="M12.75 3v10" /><path d="M7.5 3v10l4-5-4-5ZM2.5 3v10l4-5-4-5Z" {...solid} /></I>;
export const IconLoop = (p: P) => <I {...p}><path d="M2.75 8V4.75h9.5" /><path d="M10 2.5l2.25 2.25L10 7" /><path d="M13.25 8v3.25h-9.5" /><path d="M6 13.5l-2.25-2.25L6 9" /></I>;
export const IconVolume = (p: P) => <I {...p}><path d="M2.75 6v4h2.5l3.5 3V3l-3.5 3h-2.5Z" /><path d="M11 5.5c.9.7 1.25 1.6 1.25 2.5S11.9 9.8 11 10.5" /></I>;
export const IconMute = (p: P) => <I {...p}><path d="M2.75 6v4h2.5l3.5 3V3l-3.5 3h-2.5Z" /><path d="M11 6l3 4M14 6l-3 4" /></I>;
export const IconFullscreen = (p: P) => <I {...p}><path d="M2.75 6V2.75H6M10 2.75h3.25V6M13.25 10v3.25H10M6 13.25H2.75V10" /></I>;
export const IconSafe = (p: P) => <I {...p}><path d="M2.75 2.75h10.5v10.5H2.75z" /><path d="M5.25 5.25h5.5v5.5h-5.5z" strokeDasharray="1.5 1.5" /></I>;
export const IconCrop = (p: P) => <I {...p}><path d="M4.25 1.5v10.25H14.5M1.5 4.25h10.25V14.5" /></I>;

// actions
export const IconPlus = (p: P) => <I {...p}><path d="M8 2.75v10.5M2.75 8h10.5" /></I>;
export const IconMinus = (p: P) => <I {...p}><path d="M2.75 8h10.5" /></I>;
export const IconClose = (p: P) => <I {...p}><path d="M3.5 3.5l9 9M12.5 3.5l-9 9" /></I>;
export const IconCheck = (p: P) => <I {...p}><path d="M2.75 8.5l3.5 3.5 7-7.5" /></I>;
export const IconArrowLeft = (p: P) => <I {...p}><path d="M13.25 8H3M7 4L3 8l4 4" /></I>;
export const IconArrowRight = (p: P) => <I {...p}><path d="M2.75 8H13M9 4l4 4-4 4" /></I>;
export const IconArrowUp = (p: P) => <I {...p}><path d="M8 13.25V3M4 7l4-4 4 4" /></I>;
export const IconReturn = (p: P) => <I {...p}><path d="M13.25 3v6.25H3.5" /><path d="M6.5 6.25l-3 3 3 3" /></I>;
export const IconUpload = (p: P) => <I {...p}><path d="M8 10.5V2.5M4.75 5.75L8 2.5l3.25 3.25M2.75 10v3.25h10.5V10" /></I>;
export const IconDownload = (p: P) => <I {...p}><path d="M8 2.5v8M4.75 7.25L8 10.5l3.25-3.25M2.75 10v3.25h10.5V10" /></I>;
export const IconTrash = (p: P) => <I {...p}><path d="M2.5 4.25h11M6 4.25V2.5h4v1.75M3.75 4.25l.75 9.25h7l.75-9.25" /></I>;
export const IconCopy = (p: P) => <I {...p}><path d="M5.25 5.25h8v8h-8z" /><path d="M10.75 5.25V2.75h-8v8h2.5" /></I>;
export const IconEraser = (p: P) => <I {...p}><path d="M2.75 13.25h10.5" /><path d="M9.5 2.75l4 4-5.5 5.5h-3l-2.5-2.5 7-7Z" /><path d="M6 6.25l4 4" /></I>;
export const IconExternal = (p: P) => <I {...p}><path d="M9.5 2.75h3.75V6.5M13.25 2.75L7.5 8.5M11 9.5v3.75H2.75V5h3.75" /></I>;
export const IconPaperclip = (p: P) => <I {...p}><path d="M10.5 5.5l-4.25 4.25a1.25 1.25 0 0 0 1.75 1.75l4.75-4.75a2.5 2.5 0 0 0-3.5-3.5L4.5 8a3.75 3.75 0 0 0 5.25 5.25L13.5 9.5" strokeLinecap="butt" strokeLinejoin="round" /></I>;
export const IconMore = (p: P) => <I {...p}><path d="M3 7.25h1.5v1.5H3zM7.25 7.25h1.5v1.5h-1.5zM11.5 7.25H13v1.5h-1.5z" {...solid} /></I>;
export const IconLogout = (p: P) => <I {...p}><path d="M6.5 2.75H2.75v10.5H6.5M10.5 5l3 3-3 3M13.25 8H6" /></I>;

// objects
export const IconGear = (p: P) => <I {...p}><path d="M8 1.75v2M8 12.25v2M1.75 8h2M12.25 8h2M3.6 3.6l1.4 1.4M11 11l1.4 1.4M3.6 12.4L5 11M11 5l1.4-1.4" /><path d="M5.5 5.5h5v5h-5z" /></I>;
export const IconKey = (p: P) => <I {...p}><path d="M2.75 8.5h4.5v4.5h-4.5z" /><path d="M7.25 8.5l5.5-5.5M10.5 5.25l1.75 1.75M12.75 3l1 1" /></I>;
export const IconImage = (p: P) => <I {...p}><path d="M2.75 2.75h10.5v10.5H2.75z" /><path d="M2.75 11l3.5-3.5 3 3 1.5-1.5 2.5 2.5" /><path d="M9.75 5.25h1v1h-1z" {...solid} /></I>;
export const IconFilm = (p: P) => <I {...p}><path d="M2.75 2.75h10.5v10.5H2.75zM5.5 2.75v10.5M10.5 2.75v10.5M2.75 6h2.75M2.75 10h2.75M10.5 6h2.75M10.5 10h2.75" /></I>;
export const IconMusic = (p: P) => <I {...p}><path d="M6 11.5V3.25l7.25-1.5v8.25" /><path d="M2.75 10.25h3.25v3H2.75zM10 8.75h3.25v3H10z" /></I>;
export const IconFile = (p: P) => <I {...p}><path d="M9.25 2.75h-6.5v10.5h10.5V6.75l-4-4Z" /><path d="M9.25 2.75v4h4" /></I>;
export const IconCode = (p: P) => <I {...p}><path d="M5.5 4.5L2 8l3.5 3.5M10.5 4.5L14 8l-3.5 3.5" /></I>;
export const IconBraces = (p: P) => <I {...p}><path d="M6 2.75H4.75v4L3.25 8l1.5 1.25v4H6M10 2.75h1.25v4L12.75 8l-1.5 1.25v4H10" /></I>;
export const IconLayers = (p: P) => <I {...p}><path d="M2.75 5L8 2.5 13.25 5 8 7.5 2.75 5Z" /><path d="M2.75 8L8 10.5 13.25 8M2.75 11L8 13.5l5.25-2.5" /></I>;
export const IconChevron = (p: P) => <I {...p}><path d="M6 3.5L10.5 8 6 12.5" /></I>;
export const IconChevronDown = (p: P) => <I {...p}><path d="M3.5 6L8 10.5 12.5 6" /></I>;
export const IconAt = (p: P) => <I {...p}><path d="M10.5 8a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0Zm0 0v1.25a1.75 1.75 0 0 0 3.5 0V8A6 6 0 1 0 11 13.2" strokeLinecap="butt" /></I>;
export const IconPanelLeft = (p: P) => <I {...p}><path d="M2.75 2.75h10.5v10.5H2.75zM6.25 2.75v10.5" /></I>;
export const IconPanelRight = (p: P) => <I {...p}><path d="M2.75 2.75h10.5v10.5H2.75zM9.75 2.75v10.5" /></I>;
export const IconPanelBottom = (p: P) => <I {...p}><path d="M2.75 2.75h10.5v10.5H2.75zM2.75 9.75h10.5" /></I>;
export const IconGrid = (p: P) => <I {...p}><path d="M2.75 2.75h4v4h-4zM9.25 2.75h4v4h-4zM2.75 9.25h4v4h-4zM9.25 9.25h4v4h-4z" /></I>;
export const IconFit = (p: P) => <I {...p}><path d="M2.75 3v10M13.25 3v10M5.5 8h5M7.25 6.25L5.5 8l1.75 1.75M8.75 6.25L10.5 8l-1.75 1.75" /></I>;
export const IconMagnet = (p: P) => <I {...p}><path d="M3.25 2.75v5.5a4.75 4.75 0 0 0 9.5 0v-5.5h-3v5.5a1.75 1.75 0 0 1-3.5 0v-5.5h-3Z" /><path d="M3.25 5.5h3M9.75 5.5h3" /></I>;
export const IconUser = (p: P) => <I {...p}><path d="M5.5 2.75h5v5h-5zM2.75 13.25c0-2.5 2-3.75 5.25-3.75s5.25 1.25 5.25 3.75" /></I>;
export const IconPlug = (p: P) => <I {...p}><path d="M5.75 1.75v3M10.25 1.75v3M3.75 4.75h8.5V8a4.25 4.25 0 0 1-8.5 0V4.75ZM8 12.25v2" /></I>;
export const IconQueue = (p: P) => <I {...p}><path d="M2.75 3.25h10.5M2.75 6.5h10.5M2.75 9.75h6.5M2.75 13h6.5" /><path d="M11 9.5v4l2.75-2-2.75-2Z" {...solid} /></I>;
export const IconTerminal = (p: P) => <I {...p}><path d="M2.75 2.75h10.5v10.5H2.75z" /><path d="M5 6l2 2-2 2M8.5 10.5h2.5" /></I>;
export const IconShield = (p: P) => <I {...p}><path d="M8 1.75l5.25 2v4.5c0 3-2.5 5-5.25 6-2.75-1-5.25-3-5.25-6v-4.5l5.25-2Z" /></I>;
export const IconLink = (p: P) => <I {...p}><path d="M6.75 9.25l2.5-2.5M7.25 4.75l1.5-1.5a2.47 2.47 0 0 1 3.5 3.5l-1.5 1.5M8.75 11.25l-1.5 1.5a2.47 2.47 0 0 1-3.5-3.5l1.5-1.5" strokeLinecap="butt" /></I>;
export const IconAlert = (p: P) => <I {...p}><path d="M8 2.25l6 11H2l6-11Z" /><path d="M8 6.5v3" /><path d="M7.25 10.75h1.5v1.5h-1.5z" {...solid} /></I>;
export const IconInfo = (p: P) => <I {...p}><path d="M2.75 2.75h10.5v10.5H2.75z" /><path d="M8 7.25v4" /><path d="M7.25 4.5h1.5V6h-1.5z" {...solid} /></I>;
export const IconBulb = (p: P) => <I {...p}><path d="M6 13.25h4M6.25 11h3.5V9.5c1.25-.75 2.25-2 2.25-3.5a4 4 0 0 0-8 0c0 1.5 1 2.75 2.25 3.5V11Z" /></I>;
export const IconScript = (p: P) => <I {...p}><path d="M3.25 1.75h9.5v12.5h-9.5z" /><path d="M5.5 5h5M5.5 8h5M5.5 11h3" /></I>;
export const IconSlate = (p: P) => <I {...p}><path d="M2.75 6.25h10.5v7H2.75z" /><path d="M2.75 6.25L2.25 3l10.25-1.5.5 3.25" /><path d="M5.75 2.5l1.25 3.25M9.25 2l1.25 3.25" /></I>;

/** Brand mark: a Bone "M" in a square monitor bezel, with a Tally record square. */
export const Logo = ({ size = 22 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-label="Motion Studio" role="img">
    <rect x=".75" y=".75" width="22.5" height="22.5" fill="#0D0D0B" stroke="#3A3833" strokeWidth="1.5" />
    <path d="M6 17.5V7l6 6 6-6v10.5" fill="none" stroke="#ECE8DF" strokeWidth="2" strokeLinecap="square" />
    <rect x="16.5" y="3" width="4" height="4" fill="#FF3D1F" />
  </svg>
);

/** Loading indicator: three LED segments stepping in sequence (no spinning ring). */
export const Spinner = ({ size = 14 }: { size?: number }) => (
  <svg className="spinner" width={size} height={size} viewBox="0 0 16 16" aria-label="Loading" role="img">
    <rect className="seg s1" x="1.5" y="6" width="3.5" height="4" />
    <rect className="seg s2" x="6.25" y="6" width="3.5" height="4" />
    <rect className="seg s3" x="11" y="6" width="3.5" height="4" />
  </svg>
);
