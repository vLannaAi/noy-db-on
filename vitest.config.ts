import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    projects: [
      'on-*/vitest.config.ts',
    ],
  },
})
