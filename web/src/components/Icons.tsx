import type { SVGProps } from "react";

type P = SVGProps<SVGSVGElement> & { size?: number };
const I = ({ size = 16, children, ...rest }: P & { children: React.ReactNode }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75}
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" {...rest}>{children}</svg>
);

export const IconPlay = (p: P) => <I {...p}><path d="M7 4.5v15a1 1 0 0 0 1.5.86l12.5-7.5a1 1 0 0 0 0-1.72L8.5 3.64A1 1 0 0 0 7 4.5Z" fill="currentColor" stroke="none" /></I>;
export const IconPause = (p: P) => <I {...p}><rect x="6" y="4.5" width="4" height="15" rx="1.2" fill="currentColor" stroke="none" /><rect x="14" y="4.5" width="4" height="15" rx="1.2" fill="currentColor" stroke="none" /></I>;
export const IconStop = (p: P) => <I {...p}><rect x="6" y="6" width="12" height="12" rx="2.5" fill="currentColor" stroke="none" /></I>;
export const IconLoop = (p: P) => <I {...p}><path d="M17 2l3 3-3 3" /><path d="M4 11V9a4 4 0 0 1 4-4h12" /><path d="M7 22l-3-3 3-3" /><path d="M20 13v2a4 4 0 0 1-4 4H4" /></I>;
export const IconVolume = (p: P) => <I {...p}><path d="M11 5 6 9H3v6h3l5 4V5Z" /><path d="M15.5 8.5a5 5 0 0 1 0 7" /><path d="M18.5 5.5a9 9 0 0 1 0 13" /></I>;
export const IconMute = (p: P) => <I {...p}><path d="M11 5 6 9H3v6h3l5 4V5Z" /><path d="m22 9-6 6" /><path d="m16 9 6 6" /></I>;
export const IconFullscreen = (p: P) => <I {...p}><path d="M4 9V5a1 1 0 0 1 1-1h4" /><path d="M20 9V5a1 1 0 0 0-1-1h-4" /><path d="M4 15v4a1 1 0 0 0 1 1h4" /><path d="M20 15v4a1 1 0 0 1-1 1h-4" /></I>;
export const IconStepBack = (p: P) => <I {...p}><path d="M18 6 10 12l8 6V6Z" fill="currentColor" stroke="none" /><path d="M6 6v12" /></I>;
export const IconStepFwd = (p: P) => <I {...p}><path d="m6 6 8 6-8 6V6Z" fill="currentColor" stroke="none" /><path d="M18 6v12" /></I>;
export const IconPlus = (p: P) => <I {...p}><path d="M12 5v14M5 12h14" /></I>;
export const IconGear = (p: P) => <I {...p}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" /></I>;
export const IconClose = (p: P) => <I {...p}><path d="M18 6 6 18M6 6l12 12" /></I>;
export const IconArrowLeft = (p: P) => <I {...p}><path d="M19 12H5M12 19l-7-7 7-7" /></I>;
export const IconArrowUp = (p: P) => <I {...p}><path d="M12 19V5M5 12l7-7 7 7" /></I>;
export const IconPaperclip = (p: P) => <I {...p}><path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" /></I>;
export const IconSparkle = (p: P) => <I {...p}><path d="M12 3l1.9 5.6L19.5 10.5l-5.6 1.9L12 18l-1.9-5.6L4.5 10.5l5.6-1.9L12 3Z" /><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15Z" /></I>;
export const IconCheck = (p: P) => <I {...p}><path d="M20 6 9 17l-5-5" /></I>;
export const IconAlert = (p: P) => <I {...p}><path d="M10.3 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" /><path d="M12 9v4M12 17h.01" /></I>;
export const IconInfo = (p: P) => <I {...p}><circle cx="12" cy="12" r="9" /><path d="M12 16v-4M12 8h.01" /></I>;
export const IconBulb = (p: P) => <I {...p}><path d="M9 18h6M10 22h4" /><path d="M12 2a7 7 0 0 0-4 12.74V17h8v-2.26A7 7 0 0 0 12 2Z" /></I>;
export const IconUpload = (p: P) => <I {...p}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="M17 8l-5-5-5 5M12 3v12" /></I>;
export const IconDownload = (p: P) => <I {...p}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="M7 10l5 5 5-5M12 15V3" /></I>;
export const IconTrash = (p: P) => <I {...p}><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /></I>;
export const IconImage = (p: P) => <I {...p}><rect x="3" y="3" width="18" height="18" rx="3" /><circle cx="9" cy="9" r="2" /><path d="m21 15-3.09-3.09a2 2 0 0 0-2.82 0L6 21" /></I>;
export const IconFilm = (p: P) => <I {...p}><rect x="2" y="3" width="20" height="18" rx="3" /><path d="M7 3v18M17 3v18M2 8h5M2 16h5M17 8h5M17 16h5" /></I>;
export const IconMusic = (p: P) => <I {...p}><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></I>;
export const IconFile = (p: P) => <I {...p}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6Z" /><path d="M14 2v6h6" /></I>;
export const IconCode = (p: P) => <I {...p}><path d="m16 18 6-6-6-6M8 6l-6 6 6 6" /></I>;
export const IconLayers = (p: P) => <I {...p}><path d="m12 2 10 5-10 5L2 7l10-5Z" /><path d="m2 17 10 5 10-5M2 12l10 5 10-5" /></I>;
export const IconChevron = (p: P) => <I {...p}><path d="m9 18 6-6-6-6" /></I>;
export const IconChevronDown = (p: P) => <I {...p}><path d="m6 9 6 6 6-6" /></I>;
export const IconBrain = (p: P) => <I {...p}><path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z" /><path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z" /><path d="M12 5v13" /></I>;
export const IconWand = (p: P) => <I {...p}><path d="m15 4-1 1M19 8l-1 1M18 3l-.5 1.5M20.5 6 19 6.5" /><path d="M14 7 3 18l3 3L17 10l-3-3Z" /></I>;
export const IconAt = (p: P) => <I {...p}><circle cx="12" cy="12" r="4" /><path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-3.92 7.94" /></I>;
export const IconPanelLeft = (p: P) => <I {...p}><rect x="3" y="3" width="18" height="18" rx="3" /><path d="M9 3v18" /></I>;
export const IconPanelRight = (p: P) => <I {...p}><rect x="3" y="3" width="18" height="18" rx="3" /><path d="M15 3v18" /></I>;
export const IconGrid = (p: P) => <I {...p}><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></I>;
export const IconFit = (p: P) => <I {...p}><path d="M3 12h18M7 8l-4 4 4 4M17 8l4 4-4 4" /></I>;
export const IconKey = (p: P) => <I {...p}><circle cx="7.5" cy="15.5" r="5.5" /><path d="m21 2-9.6 9.6M15.5 7.5l3 3L22 7l-3-3" /></I>;
export const IconEraser = (p: P) => <I {...p}><path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21" /><path d="M22 21H7M5 11l9 9" /></I>;
export const IconMore = (p: P) => <I {...p}><circle cx="5" cy="12" r="1" fill="currentColor" /><circle cx="12" cy="12" r="1" fill="currentColor" /><circle cx="19" cy="12" r="1" fill="currentColor" /></I>;
export const IconExternal = (p: P) => <I {...p}><path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /></I>;

/** Brand mark: an "M" drawn as a single stroke with the accent gradient. */
export const Logo = ({ size = 22 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 32 32" aria-label="Motion Studio">
    <defs>
      <linearGradient id="ms-logo-g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor="#7c5cff" /><stop offset="1" stopColor="#ff5fa2" />
      </linearGradient>
    </defs>
    <rect width="32" height="32" rx="9" fill="#17171d" />
    <rect x=".5" y=".5" width="31" height="31" rx="8.5" fill="none" stroke="rgba(255,255,255,.1)" />
    <path d="M9 22V10l7 7 7-7v12" fill="none" stroke="url(#ms-logo-g)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export const Spinner = ({ size = 14 }: { size?: number }) => (
  <svg className="spinner" width={size} height={size} viewBox="0 0 24 24" aria-label="Loading">
    <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeOpacity=".18" strokeWidth="2.5" />
    <path d="M21 12a9 9 0 0 0-9-9" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
  </svg>
);
