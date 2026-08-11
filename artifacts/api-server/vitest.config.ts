import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/__tests__/**/*.test.ts"],
    // Run each test file in a separate fork so process.env mutations
    // (API_KEY set/unset per test) cannot bleed between files.
    pool: "forks",
  },
});
