import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    testTimeout: 30000,
    hookTimeout: 60000,
    fileParallelism: false,
    globalSetup: ["test/global-setup.ts"],
    env: {
      NODE_ENV: "test",
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? "postgresql://rec:rec@localhost:5432/rec_test",
      STORAGE_DIR: "./.test-storage",
      WEB_DIR: "./.no-web",
      COOKIE_SECURE: "false",
      LOG_LEVEL: "warn",
    },
  },
});
