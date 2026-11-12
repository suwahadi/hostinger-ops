import { existsSync } from "node:fs";
import { defineConfig } from "vitest/config";

if (existsSync(".env")) process.loadEnvFile(".env");

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts", "packages/*/src/**/*.test.ts", "apps/*/src/**/*.test.ts"],
    fileParallelism: false,
    // This PC runs Postgres in Docker and is often short on memory; 5 s defaults time out under load.
    testTimeout: 20_000,
    hookTimeout: 120_000,
  },
});
