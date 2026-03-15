import http from "node:http";
import { createReadStream, existsSync } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const distDir = path.join(rootDir, "dist");
const host = process.env.HOST || "0.0.0.0";
const port = Number(process.env.PORT || 3000);

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon",
};

const sendFile = async (filePath, res) => {
  try {
    const fileStat = await stat(filePath);
    res.writeHead(200, {
      "Content-Type": mimeTypes[path.extname(filePath)] || "application/octet-stream",
      "Content-Length": fileStat.size,
      "Cache-Control": filePath.includes("/assets/") ? "public, max-age=31536000, immutable" : "no-cache",
    });
    createReadStream(filePath).pipe(res);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
  }
};

const server = http.createServer(async (req, res) => {
  const requestPath = req.url ? req.url.split("?")[0] : "/";
  const normalizedPath = requestPath === "/" ? "/index.html" : requestPath;
  const filePath = path.join(distDir, normalizedPath.replace(/^\/+/, ""));

  if (!existsSync(distDir)) {
    res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("dist/ not found. Run `npm run build` first.");
    return;
  }

  if (existsSync(filePath)) {
    await sendFile(filePath, res);
    return;
  }

  await sendFile(path.join(distDir, "index.html"), res);
});

server.listen(port, host, () => {
  console.log(`Downey Evals Loop serving on http://${host}:${port}`);
});
