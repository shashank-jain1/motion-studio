/** Curated Google Fonts, loaded on demand (latin subset) so renders only fetch what a spec uses. */
import * as Anton from "@remotion/google-fonts/Anton";
import * as ArchivoBlack from "@remotion/google-fonts/ArchivoBlack";
import * as BebasNeue from "@remotion/google-fonts/BebasNeue";
import * as BricolageGrotesque from "@remotion/google-fonts/BricolageGrotesque";
import * as Bungee from "@remotion/google-fonts/Bungee";
import * as Caveat from "@remotion/google-fonts/Caveat";
import * as DMSans from "@remotion/google-fonts/DMSans";
import * as DMSerifDisplay from "@remotion/google-fonts/DMSerifDisplay";
import * as Fraunces from "@remotion/google-fonts/Fraunces";
import * as Geist from "@remotion/google-fonts/Geist";
import * as InstrumentSans from "@remotion/google-fonts/InstrumentSans";
import * as InstrumentSerif from "@remotion/google-fonts/InstrumentSerif";
import * as Inter from "@remotion/google-fonts/Inter";
import * as JetBrainsMono from "@remotion/google-fonts/JetBrainsMono";
import * as Lora from "@remotion/google-fonts/Lora";
import * as Manrope from "@remotion/google-fonts/Manrope";
import * as Monoton from "@remotion/google-fonts/Monoton";
import * as Montserrat from "@remotion/google-fonts/Montserrat";
import * as Orbitron from "@remotion/google-fonts/Orbitron";
import * as Oswald from "@remotion/google-fonts/Oswald";
import * as Outfit from "@remotion/google-fonts/Outfit";
import * as PermanentMarker from "@remotion/google-fonts/PermanentMarker";
import * as PlayfairDisplay from "@remotion/google-fonts/PlayfairDisplay";
import * as Poppins from "@remotion/google-fonts/Poppins";
import * as PressStart2P from "@remotion/google-fonts/PressStart2P";
import * as Righteous from "@remotion/google-fonts/Righteous";
import * as Sora from "@remotion/google-fonts/Sora";
import * as SpaceGrotesk from "@remotion/google-fonts/SpaceGrotesk";
import * as Syne from "@remotion/google-fonts/Syne";
import * as Unbounded from "@remotion/google-fonts/Unbounded";

type FontModule = {
  loadFont: (style?: any, options?: any) => { fontFamily: string; waitUntilDone: () => Promise<unknown> };
  getInfo: () => { fontFamily: string; fonts: Record<string, Record<string, unknown>> };
};

export const FONTS: Record<string, FontModule> = {
  "Anton": Anton, "Archivo Black": ArchivoBlack, "Bebas Neue": BebasNeue, "Bricolage Grotesque": BricolageGrotesque,
  "Bungee": Bungee, "Caveat": Caveat, "DM Sans": DMSans, "DM Serif Display": DMSerifDisplay, "Fraunces": Fraunces,
  "Geist": Geist, "Instrument Sans": InstrumentSans, "Instrument Serif": InstrumentSerif, "Inter": Inter,
  "JetBrains Mono": JetBrainsMono, "Lora": Lora, "Manrope": Manrope, "Monoton": Monoton, "Montserrat": Montserrat,
  "Orbitron": Orbitron, "Oswald": Oswald, "Outfit": Outfit, "Permanent Marker": PermanentMarker,
  "Playfair Display": PlayfairDisplay, "Poppins": Poppins, "Press Start 2P": PressStart2P, "Righteous": Righteous,
  "Sora": Sora, "Space Grotesk": SpaceGrotesk, "Syne": Syne, "Unbounded": Unbounded,
};

const loaded = new Map<string, string>();
/** Font stack → promise that resolves once its faces are downloaded and added to document.fonts. */
const ready = new Map<string, Promise<unknown>>();

/** Resolves when a stack returned by ensureFont is usable for measurement (Remotion only adds faces after load). */
export const fontReady = (stack: string): Promise<unknown> => ready.get(stack) ?? Promise.resolve();
const WANTED_WEIGHTS = ["300", "400", "500", "600", "700", "800", "900"];

/** Returns a CSS font-family stack; loads the font (once per page) if it's in the curated set. */
export const ensureFont = (name: string): string => {
  const hit = loaded.get(name);
  if (hit) return hit;
  const mod = FONTS[name];
  if (!mod) {
    const fallback = `"${name}", Inter, system-ui, sans-serif`;
    loaded.set(name, fallback);
    return fallback;
  }
  const info = mod.getInfo();
  const styles = Object.keys(info.fonts);
  const loadStyles = styles.filter((s) => s === "normal" || s === "italic");
  const waits: Promise<unknown>[] = [];
  for (const style of loadStyles) {
    const available = Object.keys(info.fonts[style] ?? {});
    const weights = available.filter((w) => WANTED_WEIGHTS.includes(w));
    const r = mod.loadFont(style, { weights: weights.length ? weights : available, subsets: ["latin"], ignoreTooManyRequestsWarning: true });
    waits.push(r.waitUntilDone().catch(() => undefined));
  }
  const family = `"${info.fontFamily}", system-ui, sans-serif`;
  loaded.set(name, family);
  ready.set(family, Promise.all(waits));
  return family;
};
