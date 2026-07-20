import { defineConfig } from 'vitest/config'

// Explicit config so Vitest resolves this directory as its own project root.
// Without it, running `vitest` from here makes Vitest traverse up the directory
// tree and pick up a parent repo's vitest config (e.g. when clerk-docs is nested
// inside the docs site repo), which fails because its deps aren't installed here.
export default defineConfig({
  test: {},
})
