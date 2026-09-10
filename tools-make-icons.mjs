/* Erzeugt den PNG-Iconsatz aus der Vektormarke.

   Zwei Bildsprachen:
   · App-Icon (Home-Bildschirm): Verlaufsfläche, Marke in Weiß. Auf dem
     bunten Hintergrund eines Startbildschirms setzt sich das durch.
   · Maskable: dieselbe Fläche randlos, Marke auf 60 % eingerückt, damit
     Android beim Zuschneiden auf einen Kreis nichts abschneidet.        */

import { chromium } from "playwright";
const OUT = new URL("./icons", import.meta.url).pathname;

const MARK = (color, scale) => `
  <svg viewBox="0 0 224 136" style="width:${scale}%;height:auto;overflow:visible">
    <path fill="none" stroke="${color}" stroke-width="28" stroke-linecap="round"
          d="M90.4 107A46 46 0 1 1 90.4 29C116 43 120 94 150 101C176 106 191 97 204 74"/>
    <circle cx="168" cy="48" r="21" fill="${color}"/>
  </svg>`;

/* radius: Eckenradius in Prozent der Kantenlänge. 0 = randlos. */
function page({ size, radius, bg, mark, scale }){
  return `<!DOCTYPE html><meta charset="utf-8">
  <style>
    html,body{margin:0;padding:0;background:transparent}
    .icon{width:${size}px;height:${size}px;display:grid;place-items:center;
      border-radius:${radius}%;background:${bg};overflow:hidden}
  </style>
  <div class="icon">${MARK(mark, scale)}</div>`;
}

const GRAD = "linear-gradient(135deg,#0A6EEA 0%,#1BB6C0 52%,#63DD82 100%)";

const JOBS = [
  { file:"icon-512.png",           size:512, radius:22, bg:GRAD, mark:"#fff",   scale:62 },
  { file:"icon-192.png",           size:192, radius:22, bg:GRAD, mark:"#fff",   scale:62 },
  /* Randlos und kleiner gesetzt: Android schneidet bis zu 20 % weg. */
  { file:"icon-maskable-512.png",  size:512, radius:0,  bg:GRAD, mark:"#fff",   scale:48 },
  /* iOS legt die Rundung selbst an, deshalb hier ohne eigene Ecken. */
  { file:"apple-touch-icon.png",   size:180, radius:0,  bg:GRAD, mark:"#fff",   scale:64 },
  { file:"favicon-32.png",         size:32,  radius:0,  bg:GRAD, mark:"#fff",   scale:74 },
];

const b = await chromium.launch({ executablePath:"/opt/pw-browsers/chromium", args:["--no-sandbox"] });

for (const j of JOBS){
  const p = await b.newPage({ viewport:{ width:j.size, height:j.size }, deviceScaleFactor:1 });
  let html = page(j);
  // Die weiche Variante trägt die Marke im Markenverlauf statt in Weiß
  if (j.mark.startsWith("url")){
    html = html.replace("<svg viewBox", `<svg viewBox`).replace("</svg>", "</svg>")
      .replace('<path fill="none"',
        `<defs><linearGradient id="g" gradientUnits="userSpaceOnUse" x1="6" y1="122" x2="218" y2="30">
          <stop offset="0" stop-color="#0A6EEA"/><stop offset=".52" stop-color="#1BB6C0"/>
          <stop offset="1" stop-color="#63DD82"/></linearGradient></defs><path fill="none"`);
  }
  await p.setContent(html);
  await p.waitForTimeout(120);
  await p.locator(".icon").screenshot({ path:`${OUT}/${j.file}`, omitBackground:true });
  console.log("  ✓", j.file, `${j.size}×${j.size}`);
  await p.close();
}
await b.close();
