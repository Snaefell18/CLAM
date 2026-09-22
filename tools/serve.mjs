import http from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("../",import.meta.url));
const types = { ".html":"text/html; charset=utf-8", ".js":"text/javascript; charset=utf-8",
  ".css":"text/css", ".svg":"image/svg+xml", ".png":"image/png", ".webmanifest":"application/manifest+json" };
const modules = new Set(["app.js","backend.js","runtime.js","demo-store.js","demo-ui.js",
  "demo.css","risk.js","data.js","doctor.js","catalog.js","admin.js","seed.js",
  "index.html","manifest.webmanifest"]);
export function startServer(port = 4173){
  const server = http.createServer(async (req,res) => {
    try {
      const pathname = new URL(req.url,"http://localhost").pathname;
      const name = pathname === "/" ? "index.html" : decodeURIComponent(pathname.slice(1));
      if (!modules.has(name) && !/^icons\/[a-z0-9-]+\.(png|svg)$/.test(name)){
        res.writeHead(404); res.end("Not found"); return;
      }
      const data = await readFile(path.join(root,name));
      res.writeHead(200, { "content-type":types[path.extname(name)] || "application/octet-stream", "cache-control":"no-store" });
      res.end(data);
    } catch { res.writeHead(404); res.end("Not found"); }
  });
  return new Promise(resolve => server.listen(port,"127.0.0.1",() => resolve(server)));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)){
  const server = await startServer(Number(process.env.PORT || 4173));
  console.log(`CLAM Demo: http://127.0.0.1:${server.address().port}/?demo=1`);
}
