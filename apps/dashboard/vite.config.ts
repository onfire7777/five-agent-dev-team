import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const dashboardPort = Number(env.DASHBOARD_PORT || process.env.DASHBOARD_PORT || 5173);
  const apiBaseUrl = env.VITE_API_BASE_URL || process.env.VITE_API_BASE_URL || "http://localhost:4310";

  return {
    root: "apps/dashboard",
    plugins: [react()],
    define: {
      __DASHBOARD_API_BASE__: JSON.stringify(apiBaseUrl)
    },
    server: {
      port: dashboardPort,
      strictPort: false
    },
    preview: {
      port: dashboardPort
    },
    build: {
      outDir: "../../dist/apps/dashboard",
      emptyOutDir: true
    }
  };
});
