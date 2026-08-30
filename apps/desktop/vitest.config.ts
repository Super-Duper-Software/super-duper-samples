import { defineConfig } from 'vitest/config'

// Tests construct the core in-process with no Electron (CONVENTIONS.md).
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
  },
})
