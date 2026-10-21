import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Component and unit tests (jsdom). End-to-end tests live in e2e/ and run with Playwright.
export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@": fileURLToPath(new URL("./", import.meta.url)) } },
  test: {
    environment: "jsdom",
    setupFiles: ["./test/setup.ts"],
    include: ["**/*.test.{ts,tsx}"],
    exclude: ["node_modules/**", "e2e/**", ".next/**", ".next-e2e/**"],
  },
});
