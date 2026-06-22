import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:8080",
        changeOrigin: true,
        headers: {
          Origin: "http://localhost:5173",
        },
      },
      "/.well-known": {
        target: "http://localhost:8080",
        changeOrigin: true,
        headers: {
          Origin: "http://localhost:5173",
        },
      },
    },
  },
});
