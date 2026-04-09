import { defineConfig } from "vite";

export default defineConfig(({ command }) => ({
  // For local dev we want absolute root paths.
  // For production, the app is served from https://snek.su/pixeldc/
  base: command === "serve" ? "/" : "/pixeldc/",
}));

