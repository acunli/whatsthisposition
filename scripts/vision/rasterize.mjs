import { chromium } from "playwright";
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
const b = await chromium.launch();
const p = await b.newPage();
mkdirSync("png", { recursive: true });
for (const set of readdirSync("sets")) {
  mkdirSync(`png/${set}`, { recursive: true });
  for (const f of readdirSync(`sets/${set}`)) {
    const svg = readFileSync(`sets/${set}/${f}`, "utf8");
    const data = await p.evaluate(async (svg) => {
      const img = new Image();
      img.src = "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(svg)));
      await img.decode();
      const c = document.createElement("canvas");
      c.width = c.height = 128;
      c.getContext("2d").drawImage(img, 0, 0, 128, 128);
      return c.toDataURL("image/png");
    }, svg);
    writeFileSync(`png/${set}/${f.replace(".svg", ".png")}`, Buffer.from(data.split(",")[1], "base64"));
  }
}
await b.close();
