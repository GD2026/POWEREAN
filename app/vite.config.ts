import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import {
  higgsfieldDesignInspectorVitePlugin,
  higgsfieldDesignSourceBabelPlugin,
} from "./src/module/design-inspector/vite";
import svgr from "vite-plugin-svgr";
import { defineConfig, type Plugin } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Text reader (Tesseract) files for "Lagersjekk", served from our own origin
// under /assets/ocr/ (no third-party CDN, CSP-friendly, cached as immutable).
// Only the LSTM builds are shipped: the app always runs the LSTM engine.
export const OCR_BASE = "/assets/ocr-v7";
function ocrAssets(): Plugin {
  const require = createRequire(import.meta.url);
  const tesseractDir = path.dirname(require.resolve("tesseract.js/package.json"));
  const coreDir = path.dirname(
    createRequire(path.join(tesseractDir, "package.json")).resolve(
      "tesseract.js-core/package.json",
    ),
  );
  const norDir = path.dirname(require.resolve("@tesseract.js-data/nor/package.json"));
  const files: Record<string, string> = {
    "worker.min.js": path.join(tesseractDir, "dist/worker.min.js"),
    "lang/nor.traineddata.gz": path.join(norDir, "4.0.0_best_int/nor.traineddata.gz"),
  };
  for (const variant of ["lstm", "simd-lstm", "relaxedsimd-lstm"]) {
    const name = `tesseract-core-${variant}.wasm.js`;
    files[`core/${name}`] = path.join(coreDir, name);
  }
  return {
    name: "powerean-ocr-assets",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const rel = req.url?.split("?")[0].replace(`${OCR_BASE}/`, "");
        const file = rel ? files[rel] : undefined;
        if (!req.url?.startsWith(`${OCR_BASE}/`) || !file) return next();
        res.setHeader(
          "content-type",
          rel!.endsWith(".js") ? "text/javascript" : "application/octet-stream",
        );
        res.end(readFileSync(file));
      });
    },
    applyToEnvironment: (env) => env.name === "client",
    generateBundle() {
      for (const [name, file] of Object.entries(files)) {
        this.emitFile({
          type: "asset",
          fileName: `${OCR_BASE.slice(1)}/${name}`,
          source: readFileSync(file),
        });
      }
    },
  };
}

// The vendored @higgsfield/quanta components import their glyphs from the private
// Nexus-only `@higgsfield-ai/icons`. Generated sites build on the PUBLIC npm
// registry, so we redirect every `@higgsfield-ai/icons/*` import to a Material
// Symbols shim instead (see src/lib/quanta-material-icons.ts). tsconfig.json has
// the matching `paths` entry so type-checking resolves it too.
const QUANTA_ICONS_SHIM = fileURLToPath(
  new URL("./src/lib/quanta-material-icons.ts", import.meta.url),
);

export default defineConfig(({ mode }) => {
  const designInspectorEnabled = process.env.HF_DESIGN_INSPECTOR === "1" || mode === "design";

  return {
    resolve: {
      alias: [{ find: /^@higgsfield-ai\/icons(\/.*)?$/, replacement: QUANTA_ICONS_SHIM }],
    },
    // The server bundle runs as a Cloudflare Worker — there is no node_modules
    // at runtime. Vite's default SSR build leaves npm deps as bare external
    // imports (h3, react, @tanstack/*, seroval, …), which resolve on a Node
    // server but throw "No such module" in a Worker. Bundle them all in.
    // (node: builtins stay external — nodejs_compat provides them.)
    ssr: {
      noExternal: true,
      // `cloudflare:workers` is a workerd runtime built-in that exposes the Worker
      // env / bindings (D1 `DB`, R2 `STORAGE`). Like node: builtins it must NOT be
      // bundled; the runtime provides it. (`ssr.external` is typed string[].)
      external: ["cloudflare:workers"],
    },
    build: {
      // Keep `cloudflare:*` external in the SSR rollup pass too — `noExternal`
      // above would otherwise try to resolve+bundle it and fail.
      rollupOptions: { external: [/^cloudflare:/] },
    },
    plugins: [
      // Material Symbols SVGs (the app icon set) import as React components via
      // `?react`. `icon: true` sizes them 1em; fill is forced to currentColor so
      // they color like text (the raw SVGs have no fill attribute). Keep the
      // viewBox so CSS sizing scales the glyph.
      svgr({
        svgrOptions: {
          icon: true,
          svgProps: { fill: "currentColor" },
          svgoConfig: {
            plugins: [{ name: "preset-default", params: { overrides: { removeViewBox: false } } }],
          },
        },
      }),
      // TanStack Start plugin must run before React's plugin.
      //
      // SSR build: `vite build` emits a Workers-shaped server bundle
      // (dist/server/server.js — `export default { fetch }`) plus dist/client
      // (hashed static assets). The platform publishes that as a per-tenant
      // Worker on Workers for Platforms, served at <sub>.higgsfield.app/ (host
      // root, so Vite's default base "/" — no base-path juggling).
      //
      // Rendering happens on the server per request, so site code must be
      // SSR-safe: never touch browser-only globals (window, document,
      // localStorage, navigator) during render or at module top level — only
      // inside effects/handlers, or guarded with `typeof window !== "undefined"`.
      tanstackStart({
        server: { entry: "server" },
      }),
      higgsfieldDesignInspectorVitePlugin(designInspectorEnabled),
      react({
        babel: {
          plugins: designInspectorEnabled ? [higgsfieldDesignSourceBabelPlugin] : [],
        },
      }),
      tailwindcss(),
      tsconfigPaths(),
      ocrAssets(),
    ],
  };
});
