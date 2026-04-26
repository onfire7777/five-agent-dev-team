import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  root: "apps/dashboard",
  plugins: [react()],
  server: {
    port: Number(process.env.DASHBOARD_PORT || 5173),
    strictPort: false
  },
  preview: {
    port: Number(process.env.DASHBOARD_PORT || 5173)
  },
  build: {
    outDir: "../../dist/apps/dashboard",
    emptyOutDir: true
  }
});
