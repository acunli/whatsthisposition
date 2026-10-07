/**
 * POST /api/recognize — multipart form with an `image` field.
 *
 * The image is read into memory, sent to the configured vision provider, and
 * discarded when the request ends. Nothing is written to disk or logged.
 */
import { NextResponse } from "next/server";
import { clientIp, rateLimit } from "@/lib/server/rateLimit";
import type { RecognitionError, RecognitionResponse } from "@/lib/vision/grid";
import { VisionProviderError, getVisionProvider, type VisionInput } from "@/lib/vision/provider";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const MAX_BYTES = 6 * 1024 * 1024;
const TYPES = new Set<VisionInput["mediaType"]>(["image/jpeg", "image/png", "image/webp"]);

function fail(status: number, code: RecognitionError["code"], message: string) {
  return NextResponse.json<RecognitionError>({ ok: false, code, message }, { status });
}

export async function GET() {
  const provider = getVisionProvider();
  return NextResponse.json({ configured: !!provider, provider: provider?.name ?? null });
}

export async function POST(req: Request) {
  // Each call costs a vision-API request: a few per minute per visitor is plenty.
  const wait = rateLimit(`recognize:${clientIp(req)}`, 6, 60_000);
  if (wait) return fail(429, "bad_request", `Too many photos in a short time. Try again in ${wait} s, or read the photo on your device.`);
  const provider = getVisionProvider();
  if (!provider) {
    return fail(
      503,
      "not_configured",
      "Photo recognition isn't set up on this server (no vision API key). You can still enter the position with FEN or set it up by hand.",
    );
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return fail(400, "bad_request", "Upload the photo as form data.");
  }
  const file = form.get("image");
  if (!(file instanceof Blob)) return fail(400, "bad_request", "No image was attached.");
  if (!TYPES.has(file.type as VisionInput["mediaType"])) return fail(400, "bad_request", "Use a JPEG, PNG or WebP image.");
  if (file.size > MAX_BYTES) return fail(413, "too_large", "That image is over 6 MB. Crop it or use a smaller photo.");

  try {
    const data = Buffer.from(await file.arrayBuffer());
    const result = await provider.recognize({ data, mediaType: file.type as VisionInput["mediaType"] }, req.signal);
    if (!result.board_found) {
      return fail(422, "unreadable", result.notes || "No complete chessboard was found in the photo. Crop tightly around the board and try again.");
    }
    return NextResponse.json<RecognitionResponse>({
      ok: true,
      boardFound: result.board_found,
      notes: result.notes,
      rows: result.rows,
      provider: provider.name,
      model: provider.model,
    });
  } catch (err) {
    if (err instanceof VisionProviderError) return fail(502, err.code, err.message);
    if (req.signal.aborted) return fail(499, "bad_request", "The upload was cancelled.");
    console.error("recognize: unexpected error", err instanceof Error ? err.message : err);
    return fail(500, "provider_error", "Something went wrong while reading the photo. Please try again.");
  }
}
