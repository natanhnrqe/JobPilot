import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    // Cada arquivo de teste roda em processo próprio com banco temporário exclusivo.
    pool: "forks",
    poolOptions: {
      forks: {
        execArgv: ["--disable-warning=ExperimentalWarning"],
      },
    },
    reporters: ["default"],
  },
});
