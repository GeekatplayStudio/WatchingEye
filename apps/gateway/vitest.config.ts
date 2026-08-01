import { defineConfig } from "vitest/config";

/** Vitest config — keep Node's experimental sqlite out of Vite's resolver. */
export default defineConfig({
  test: {
    server: {
      deps: {
        external: ["node:sqlite"],
      },
    },
  },
  ssr: {
    external: ["node:sqlite"],
  },
});
