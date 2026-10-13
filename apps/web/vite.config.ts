import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const apiOrigin = env.WEB_API_ORIGIN || "http://127.0.0.1:3000";
  const apiProxy = {
    "/v2": { target: apiOrigin, changeOrigin: false },
    "/v1": {
      target: apiOrigin,
      changeOrigin: false,
    },
  };

  return {
    plugins: [react()],
    ...(mode === "desktop"
      ? { define: { "import.meta.env.VITE_CAREER_OS_V2": JSON.stringify("1") } }
      : {}),
    worker: { format: "es" },
    server: {
      host: "127.0.0.1",
      port: 5173,
      strictPort: true,
      proxy: apiProxy,
    },
    preview: {
      host: "127.0.0.1",
      port: 5173,
      strictPort: true,
      proxy: apiProxy,
    },
  };
});
