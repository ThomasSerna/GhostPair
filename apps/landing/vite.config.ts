import { readFile, rm } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

const docsDirectory = resolve(import.meta.dirname, "../../docs");
const generatedAssetsDirectory = resolve(docsDirectory, "assets/landing");
const preservedAssets = new Map([
  ["assets/icon.png", "image/png"],
  ["assets/previews/share-tab.html", "text/html; charset=utf-8"],
  ["assets/previews/connect-host.html", "text/html; charset=utf-8"],
  ["assets/previews/remote-viewer.html", "text/html; charset=utf-8"],
  ["assets/previews/shared-page.html", "text/html; charset=utf-8"],
  ["assets/previews/extension.css", "text/css; charset=utf-8"],
  ["privacy.html", "text/html; charset=utf-8"],
]);

function websiteAssets(): Plugin {
  return {
    name: "ghostpair-website-assets",
    async generateBundle() {
      const license = await readFile(
        new URL("./LICENSE", import.meta.resolve("@fontsource-variable/manrope")),
        "utf8",
      );
      this.emitFile({
        type: "asset",
        fileName: "assets/landing/Manrope-OFL.txt",
        source: license,
      });
    },
    configureServer(server) {
      // Serve the unchanged exports directly from their authoritative docs location.
      server.middlewares.use(async (request, response, next) => {
        const pathname = new URL(request.url ?? "/", "http://localhost")
          .pathname;
        const asset = pathname.replace(/^\/(?:GhostPair\/)?/, "");
        const contentType = preservedAssets.get(asset);
        if (!contentType) return next();

        try {
          const body = await readFile(resolve(docsDirectory, asset));
          response.setHeader("Content-Type", contentType);
          response.end(body);
        } catch (error) {
          next(error);
        }
      });
    },
  };
}

function cleanGeneratedAssets(): Plugin {
  return {
    name: "ghostpair-clean-generated-landing-assets",
    apply: "build",
    async buildStart() {
      // docs also contains release notes, privacy and authentic product exports.
      // Only the dedicated Vite output directory can be removed.
      if (
        relative(docsDirectory, generatedAssetsDirectory) !==
        join("assets", "landing")
      ) {
        throw new Error(
          "Refusing to clean assets outside docs/assets/landing.",
        );
      }
      await rm(generatedAssetsDirectory, { recursive: true, force: true });
    },
  };
}

export default defineConfig({
  plugins: [react(), websiteAssets(), cleanGeneratedAssets()],
  base: "./",
  publicDir: false,
  build: {
    target: "es2022",
    outDir: docsDirectory,
    assetsDir: "assets/landing",
    emptyOutDir: false,
    sourcemap: false,
  },
});
