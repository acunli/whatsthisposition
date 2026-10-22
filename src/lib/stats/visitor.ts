/**
 * What the server can tell about a visitor from the request itself, reduced to coarse classes
 * the counter keeps: device type, operating system and browser family from the user agent (and
 * Chromium's client hints), the place Vercel derives from the IP address (country, region,
 * city: the address itself isn't kept), the browser's language, and the visitor's local time.
 */

export interface Software {
  device: "mobile" | "tablet" | "desktop";
  os: string;
  browser: string;
}

/**
 * Device, system and browser from a user agent. `mobileHint` is Chromium's Sec-CH-UA-Mobile
 * ("?1" on phones); `input` is what the page reported ("touch" makes a "Mac" an iPad: iPadOS
 * Safari presents itself as a Mac).
 */
export function software(ua: string, mobileHint?: string | null, input?: string): Software {
  const os = /Windows/.test(ua)
    ? "Windows"
    : /CrOS/.test(ua)
      ? "ChromeOS"
      : /iPhone|iPod/.test(ua)
        ? "iOS"
        : /iPad/.test(ua)
          ? "iPadOS"
          : /Android/.test(ua)
            ? "Android"
            : /Macintosh|Mac OS X/.test(ua)
              ? input === "touch"
                ? "iPadOS"
                : "macOS"
              : /Linux|X11/.test(ua)
                ? "Linux"
                : "Other";
  const device: Software["device"] =
    os === "iOS" || mobileHint === "?1" || (os === "Android" && /Mobile/.test(ua))
      ? "mobile"
      : os === "iPadOS" || os === "Android" || /Tablet/.test(ua)
        ? "tablet"
        : "desktop";
  const browser = /FBAN|FBAV|Instagram|Snapchat|Line\/|; wv\)|GSA\//.test(ua)
    ? "In-app browser"
    : /Edg(e|A|iOS)?\//.test(ua)
      ? "Edge"
      : /OPR\/|Opera|OPT\//.test(ua)
        ? "Opera"
        : /SamsungBrowser/.test(ua)
          ? "Samsung Internet"
          : /YaBrowser/.test(ua)
            ? "Yandex"
            : /Vivaldi/.test(ua)
              ? "Vivaldi"
              : /DuckDuckGo\//.test(ua)
                ? "DuckDuckGo"
                : /Firefox\/|FxiOS/.test(ua)
                  ? "Firefox"
                  : /CriOS|Chrome\//.test(ua)
                    ? "Chrome"
                    : /Safari\//.test(ua)
                      ? "Safari"
                      : "Other";
  return { device, os, browser };
}

/** A two-letter country code, as Vercel gives it (x-vercel-ip-country). */
export const countryCode = (x: string | null | undefined) => (x && /^[A-Z]{2}$/.test(x) ? x : "");

/** A region code within the country (x-vercel-ip-country-region: ISO 3166-2's part after the dash). */
export const regionCode = (x: string | null | undefined) => (x && /^[A-Z0-9]{1,3}$/.test(x) ? x : "");

/** A city name (x-vercel-ip-city, URL-encoded): letters, spaces and a little punctuation only. */
export function cityName(x: string | null | undefined): string {
  if (!x) return "";
  let s: string;
  try {
    s = decodeURIComponent(x);
  } catch {
    return "";
  }
  s = s.replace(/[^\p{L}\p{M} .'’-]/gu, "").trim();
  return s.length <= 48 ? s : "";
}

/** The first language the browser asks for (Accept-Language), as its two- or three-letter code. */
export function languageOf(acceptLanguage: string | null | undefined): string {
  const m = /^\s*([a-zA-Z]{2,3})(?:[-_][a-zA-Z0-9]+)*\s*(?:[;,]|$)/.exec(acceptLanguage ?? "");
  return m ? m[1].toLowerCase() : "";
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/**
 * The visitor's own clock at `t`: the hour ("00"–"23") and weekday ("Mon"–"Sun") in their time
 * zone (x-vercel-ip-timezone), or empty strings when it isn't known.
 */
export function localClock(t: number, timeZone: string | null | undefined): { hour: string; day: string } {
  if (!timeZone || timeZone.length > 64) return { hour: "", day: "" };
  try {
    const parts = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", hourCycle: "h23", weekday: "short" }).formatToParts(new Date(t));
    const hour = parts.find((p) => p.type === "hour")?.value ?? "";
    const day = parts.find((p) => p.type === "weekday")?.value ?? "";
    return { hour: /^\d\d$/.test(hour) ? hour : "", day: WEEKDAYS.includes(day) ? day : "" };
  } catch {
    return { hour: "", day: "" };
  }
}
