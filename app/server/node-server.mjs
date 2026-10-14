// Production server for Render (or any Node 22 host). Serves the built static
// files from dist/client and hands everything else to the TanStack Start
// handler in dist/server/server.js, which speaks the standard fetch API.
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";

const here = path.dirname(fileURLToPath(import.meta.url));
const CLIENT_DIR = path.resolve(here, "../dist/client");
const SERVER_ENTRY = path.resolve(here, "../dist/server/server.js");
const PORT = Number(process.env.PORT ?? 3000);
const HOST = process.env.HOST ?? "0.0.0.0";

const { default: app } = await import(SERVER_ENTRY);

const TYPES = {
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".wasm": "application/wasm",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
};
const COMPRESSIBLE = /^(text\/|application\/(javascript|json|manifest\+json|wasm|xml)|image\/svg)/;

const BASE_HEADERS = {
  "strict-transport-security": "max-age=63072000; includeSubDomains",
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
};

// Static files are immutable between deploys, so compressed copies are kept in memory.
const compressedCache = new Map();

async function resolveStatic(urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  if (decoded.includes("\0")) return null;
  const file = path.resolve(CLIENT_DIR, "." + path.posix.normalize(decoded));
  if (!file.startsWith(CLIENT_DIR + path.sep)) return null;
  if (path.basename(file).startsWith(".")) return null;
  try {
    const info = await stat(file);
    return info.isFile() ? { file, size: info.size, mtime: info.mtime } : null;
  } catch {
    return null;
  }
}

function pickEncoding(req) {
  const accept = String(req.headers["accept-encoding"] ?? "");
  if (/\bbr\b/.test(accept)) return "br";
  if (/\bgzip\b/.test(accept)) return "gzip";
  return null;
}

async function serveStatic(req, res, found, urlPath) {
  const type = TYPES[path.extname(found.file).toLowerCase()] ?? "application/octet-stream";
  const immutable = urlPath.startsWith("/assets/");
  const headers = {
    ...BASE_HEADERS,
    "content-type": type,
    "cache-control": immutable ? "public, max-age=31536000, immutable" : "public, max-age=3600",
    "last-modified": found.mtime.toUTCString(),
    vary: "accept-encoding",
  };
  const encoding = COMPRESSIBLE.test(type) && found.size > 1024 ? pickEncoding(req) : null;
  if (encoding) {
    const key = `${found.file}|${encoding}`;
    let body = compressedCache.get(key);
    if (!body) {
      const raw = await readFile(found.file);
      body =
        encoding === "br"
          ? zlib.brotliCompressSync(raw, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 9 } })
          : zlib.gzipSync(raw, { level: 9 });
      compressedCache.set(key, body);
    }
    res.writeHead(200, { ...headers, "content-encoding": encoding, "content-length": body.length });
    res.end(req.method === "HEAD" ? undefined : body);
    return;
  }
  res.writeHead(200, { ...headers, "content-length": found.size });
  if (req.method === "HEAD") res.end();
  else createReadStream(found.file).pipe(res);
}

function toRequest(req) {
  const proto = String(req.headers["x-forwarded-proto"] ?? "http")
    .split(",")[0]
    .trim();
  const host = req.headers.host ?? `localhost:${PORT}`;
  const url = new URL(req.url ?? "/", `${proto}://${host}`);
  const headers = new Headers();
  for (let i = 0; i < req.rawHeaders.length; i += 2) {
    headers.append(req.rawHeaders[i], req.rawHeaders[i + 1]);
  }
  const hasBody = req.method !== "GET" && req.method !== "HEAD";
  return new Request(url, {
    method: req.method,
    headers,
    body: hasBody ? Readable.toWeb(req) : undefined,
    duplex: hasBody ? "half" : undefined,
  });
}

async function sendResponse(req, res, response) {
  const headers = {};
  response.headers.forEach((value, key) => {
    if (key !== "set-cookie") headers[key] = value;
  });
  const cookies = response.headers.getSetCookie?.() ?? [];
  if (cookies.length) headers["set-cookie"] = cookies;

  const type = response.headers.get("content-type") ?? "";
  const encoding =
    response.body && !response.headers.has("content-encoding") && COMPRESSIBLE.test(type)
      ? pickEncoding(req)
      : null;
  if (encoding) {
    delete headers["content-length"];
    headers["content-encoding"] = encoding;
    headers.vary = headers.vary ? `${headers.vary}, accept-encoding` : "accept-encoding";
  }
  res.writeHead(response.status, response.statusText, headers);
  if (!response.body || req.method === "HEAD") {
    res.end();
    return;
  }
  const body = Readable.fromWeb(response.body);
  if (!encoding) {
    body.pipe(res);
    return;
  }
  // Flush per chunk so streamed SSR still reaches the browser progressively.
  const compressor =
    encoding === "br"
      ? zlib.createBrotliCompress({ flush: zlib.constants.BROTLI_OPERATION_FLUSH })
      : zlib.createGzip({ flush: zlib.constants.Z_SYNC_FLUSH });
  body.pipe(compressor).pipe(res);
}

const server = http.createServer(async (req, res) => {
  try {
    const urlPath = (req.url ?? "/").split("?")[0];
    if (urlPath === "/healthz") {
      res.writeHead(200, {
        ...BASE_HEADERS,
        "content-type": "text/plain",
        "cache-control": "no-store",
      });
      res.end("ok");
      return;
    }
    if ((req.method === "GET" || req.method === "HEAD") && urlPath !== "/") {
      const found = await resolveStatic(urlPath);
      if (found) {
        await serveStatic(req, res, found, urlPath);
        return;
      }
    }
    const response = await app.fetch(toRequest(req), process.env, {
      waitUntil: (promise) => promise.catch((error) => console.error(error)),
      passThroughOnException: () => {},
    });
    await sendResponse(req, res, response);
  } catch (error) {
    console.error("request failed", error);
    if (!res.headersSent) res.writeHead(500, { ...BASE_HEADERS, "content-type": "text/plain" });
    res.end("Internal Server Error");
  }
});

server.keepAliveTimeout = 65_000;
server.listen(PORT, HOST, () => {
  console.log(`PowerEAN listening on http://${HOST}:${PORT}`);
});

for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  });
}
