#!/usr/bin/env node
// Checks the SoCLaaS (OpenAI-compatible) vision setup from .env.local:
//   1. lists the models your key can use
//   2. sends a tiny red test image and asks for its colour
// Usage: npm run vision:check   (optionally: npm run vision:check -- <model>)
import { readFileSync, existsSync } from "node:fs";
import { deflateSync } from "node:zlib";

function loadEnv(file) {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
loadEnv(".env.local");
loadEnv(".env");

const base = (process.env.SOCLAAS_BASE_URL || "https://soclaas-api.comp.nus.edu.sg/v1").replace(/\/$/, "");
const key = process.env.SOCLAAS_API_KEY;
const model = process.argv[2] || process.env.SOCLAAS_MODEL || "default";
if (!key) {
  console.error("SOCLAAS_API_KEY is empty. Paste your key into .env.local first.");
  process.exit(1);
}

// A 16×16 solid red PNG, built by hand so the script has no dependencies.
function redPng() {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const w = 16;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(w, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const raw = Buffer.concat(Array.from({ length: w }, () => Buffer.concat([Buffer.from([0]), Buffer.from(Array(w).fill([230, 30, 30]).flat())])));
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

const headers = { Authorization: `Bearer ${key}`, "Content-Type": "application/json" };

console.log(`Gateway: ${base}`);
try {
  const r = await fetch(`${base}/models`, { headers });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) console.log(`  /models → HTTP ${r.status}: ${JSON.stringify(j).slice(0, 200)}`);
  else console.log(`  Models: ${(j.data ?? []).map((m) => m.id).join(", ") || "(none listed)"}`);
} catch (e) {
  console.log(`  Couldn't reach the gateway: ${e.message}. You may need the NUS network or VPN.`);
  process.exit(1);
}

console.log(`\nVision test with model "${model}"…`);
const body = {
  model,
  temperature: 0,
  max_tokens: 200,
  messages: [
    {
      role: "user",
      content: [
        { type: "image_url", image_url: { url: `data:image/png;base64,${redPng().toString("base64")}` } },
        { type: "text", text: "What single colour fills this image? Answer with one word." },
      ],
    },
  ],
};
const r = await fetch(`${base}/chat/completions`, { method: "POST", headers, body: JSON.stringify(body) });
const j = await r.json().catch(() => ({}));
if (!r.ok) {
  console.log(`  HTTP ${r.status}: ${JSON.stringify(j).slice(0, 300)}`);
  console.log("  → This model probably doesn't accept images. Try another model: npm run vision:check -- <model-id>");
  process.exit(1);
}
const answer = (j.choices?.[0]?.message?.content ?? "").replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
console.log(`  Answer: ${answer}`);
console.log(/red/i.test(answer) ? "  ✓ The model can see images. Photo recognition should work." : "  ✗ The model didn't see the image correctly. Pick a vision (VL) model.");
