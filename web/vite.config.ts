import { cpSync, mkdirSync } from "node:fs";
import path from "node:path";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, type Plugin } from "vite";

/** Self-host the FFmpeg WebAssembly core (no third-party CDN). */
function copyFfmpeg(): Plugin {
  return {
    name: "copy-ffmpeg-core",
    buildStart() {
      const src = path.resolve(import.meta.dirname, "node_modules/@ffmpeg/core/dist/esm");
      const dest = path.resolve(import.meta.dirname, "public/ffmpeg");
      mkdirSync(dest, { recursive: true });
      for (const f of ["ffmpeg-core.js", "ffmpeg-core.wasm"]) cpSync(path.join(src, f), path.join(dest, f));
    },
  };
}

export default defineConfig({
  // GitHub Pages project site: https://<user>.github.io/<repo>/
  base: process.env.BASE_PATH ?? "/downloader/",
  plugins: [copyFfmpeg(), react(), tailwindcss()],
  optimizeDeps: { exclude: ["@ffmpeg/ffmpeg", "@ffmpeg/util"] },
  build: { target: "es2022", sourcemap: false },
  test: { environment: "node", include: ["tests/**/*.test.ts"] },
} as import("vite").UserConfig);
