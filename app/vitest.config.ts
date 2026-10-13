import { defineConfig } from "vitest/config";

// Own config so unit tests skip the TanStack/Worker build plugins and the
// vendored packages' suites (those run through `bun run test:packages`).
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
