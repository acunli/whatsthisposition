/** Names the dashboard (/stats) gives the counter's events, sources, channels, pages and classes. */

export const EVENT_NAMES: Record<string, string> = {
  visit: "Visits",
  page: "Pages opened within the site",
  lookup: "Game lists fetched",
  import_error: "Games that couldn't be brought in",
  review: "Reviews started",
  review_done: "Reviews finished",
  analysis: "Positions analysed",
  photo: "Photos read",
  side_line: "Side lines tried",
  share: "Reviews shared",
  get_extension: "Add to Chrome clicks",
  act: "Settings changed",
  error: "Errors",
};

export const SOURCE_NAMES: Record<string, Record<string, string>> = {
  visit: { direct: "Opened the site", extension: "From the extension", link: "A shared review" },
  review: { chesscom: "Chess.com username", lichess: "Lichess", pgn: "Pasted PGN", file: "PGN file", extension: "From the extension", link: "Shared review link" },
  review_done: { fast: "Fast (12)", standard: "Standard (14)", thorough: "Thorough (18)" },
  analysis: { fen: "Pasted FEN", sample: "Sample position", setup: "Set up by hand", photo: "From a photo", review: "From a review", link: "Position link" },
  photo: { device: "Read on the device", cloud: "Cloud reader" },
  lookup: { chesscom: "Chess.com username", lichess: "Lichess username", link: "Game link" },
  get_extension: { header: "Top bar", hero: "Home hero", section: "Extension section", closing: "Closing section", footer: "Footer" },
  act: { depth: "Review depth changed", theme: "Theme switched" },
  error: { page: "Error screen", script: "Script error", engine: "Engine stopped" },
};

const IMPORT_SITE_NAMES: Record<string, string> = { chesscom: "Chess.com", lichess: "Lichess", link: "Game link", pgn: "Pasted PGN", file: "PGN file" };
const IMPORT_ERROR_NAMES: Record<string, string> = {
  notfound: "not found",
  empty: "no recent games",
  limited: "rate-limited",
  failed: "site didn't answer",
  offline: "no connection",
  unreadable: "PGN unreadable",
};

/** "chesscom.notfound" → "Chess.com: not found". */
export const importErrorName = (s: string) => {
  const [site, why] = s.split(".");
  return `${IMPORT_SITE_NAMES[site] ?? site}: ${IMPORT_ERROR_NAMES[why] ?? why}`;
};

export const sourceName = (event: string, s: string) => (event === "import_error" ? importErrorName(s) : (SOURCE_NAMES[event]?.[s] ?? s));

export const CHANNEL_NAMES: Record<string, string> = {
  none: "No referrer (typed, bookmark, app)",
  google: "Google",
  bing: "Bing",
  duckduckgo: "DuckDuckGo",
  yahoo: "Yahoo",
  yandex: "Yandex",
  ecosia: "Ecosia",
  brave: "Brave Search",
  chatgpt: "ChatGPT",
  perplexity: "Perplexity",
  claude: "Claude",
  gemini: "Gemini",
  copilot: "Copilot",
  reddit: "Reddit",
  hackernews: "Hacker News",
  youtube: "YouTube",
  x: "X",
  bluesky: "Bluesky",
  mastodon: "Mastodon",
  facebook: "Facebook",
  instagram: "Instagram",
  discord: "Discord",
  chesscom: "Chess.com",
  lichess: "Lichess",
  github: "GitHub",
  chromestore: "Chrome Web Store",
  firefoxstore: "Firefox Add-ons",
  edgestore: "Edge Add-ons",
  producthunt: "Product Hunt",
  email: "Email",
  extension: "The extension",
  share: "A shared review",
  other: "Other sites",
};

const PAGE_NAMES: Record<string, string> = {
  "/": "Home",
  "/games": "Reviewed games",
  "/credits": "How it works & credits",
  "/chess-com-game-review": "Chess.com game review",
  "/lichess-game-review": "Lichess game review",
  "/pgn-analyzer": "PGN analyzer",
  "/chess-position-analyzer": "Position analyzer",
  "/chess-com-extension": "Chess.com extension",
  "/chess-move-classifications": "Move classifications",
  "/r/*": "Shared reviews",
  other: "Other addresses (404s)",
};

/** A page's name, or for a reviewed game its slug. */
export function pageName(path: string): string {
  if (PAGE_NAMES[path]) return PAGE_NAMES[path];
  const g = /^\/games\/([^/]+)(\/review)?$/.exec(path);
  if (g) return `${g[1].replace(/-/g, " ")}${g[2] ? " (review)" : ""}`;
  return path;
}

export const TECH_TITLES: Record<string, string> = {
  device: "Device type",
  os: "Operating system",
  browser: "Browser",
  vw: "Window width",
  input: "Pointer",
  theme: "Theme",
  cores: "Processor threads",
  mem: "Memory (Chromium)",
  net: "Connection (Chromium)",
  app: "Opened as",
  dpr: "Pixel density",
};

export const TECH_VALUES: Record<string, Record<string, string>> = {
  device: { mobile: "Phone", tablet: "Tablet", desktop: "Computer" },
  vw: { xs: "Under 480 px", sm: "480–767 px", md: "768–1023 px", lg: "1024–1439 px", xl: "1440 px and wider" },
  input: { touch: "Touch", mouse: "Mouse or trackpad" },
  theme: { dark: "Dark (system)", light: "Light (system)", "dark-picked": "Dark (picked)", "light-picked": "Light (picked)" },
  cores: { "1-2": "1–2", "3-4": "3–4", "5-8": "5–8", "9-16": "9–16", "17+": "17 or more" },
  mem: { "1": "1 GB or less", "2": "2 GB", "4": "4 GB", "8": "8 GB or more" },
  net: { "4g": "4G or better", "3g": "3G", "2g": "2G", "slow-2g": "Slow 2G", save: "Data Saver on" },
  app: { app: "Installed app", browser: "Browser tab" },
  dpr: { "1": "1×", "1.5": "1.5×", "2": "2×", "3": "3× or more" },
};

export const techValue = (dim: string, v: string) => TECH_VALUES[dim]?.[v] ?? v;

const regions = new Intl.DisplayNames(["en"], { type: "region" });
const languages = new Intl.DisplayNames(["en"], { type: "language" });

export const countryName = (code: string) => {
  try {
    return regions.of(code) ?? code;
  } catch {
    return code;
  }
};

export const languageName = (code: string) => {
  try {
    return languages.of(code) ?? code;
  } catch {
    return code;
  }
};

/** A country's flag, from its two letters (regional indicator symbols). */
export const flag = (code: string) => (/^[A-Z]{2}$/.test(code) ? String.fromCodePoint(...[...code].map((c) => 0x1f1a5 + c.charCodeAt(0))) : "");
