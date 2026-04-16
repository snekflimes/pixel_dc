import { defineConfig } from "vite";

export default defineConfig(({ command, mode }) => ({
  // dev — "/" ; прод — "/pixeldc/"; e2e — "/" чтобы vite preview отдавал чанки без рассинхрона путей.
  base:
    command === "serve" ? "/" : mode === "e2e" ? "/" : "/pixeldc/",
}));

