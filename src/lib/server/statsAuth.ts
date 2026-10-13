import "server-only";

/**
 * The usage dashboard (/stats) is for the site's owner: HTTP Basic sign-in with the password
 * in STATS_PASSWORD (any user name). Without that variable the dashboard doesn't exist (404).
 */
import { createHash, timingSafeEqual } from "node:crypto";
import { SITE_ASCII } from "../brand";

export const statsEnabled = () => !!process.env.STATS_PASSWORD;

/** True when an Authorization header carries the dashboard password (compared in constant time). */
export function statsAllowed(authorization: string | null, password = process.env.STATS_PASSWORD): boolean {
  if (!password || !authorization?.startsWith("Basic ")) return false;
  let decoded: string;
  try {
    decoded = Buffer.from(authorization.slice(6), "base64").toString("utf8");
  } catch {
    return false;
  }
  const given = decoded.slice(decoded.indexOf(":") + 1);
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(password).digest();
  return decoded.includes(":") && timingSafeEqual(a, b);
}

/** HTTP headers are plain ASCII, so the realm uses the ASCII name. */
export const STATS_CHALLENGE = `Basic realm="${SITE_ASCII} usage", charset="UTF-8"`;
