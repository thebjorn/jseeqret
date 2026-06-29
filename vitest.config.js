import { defineConfig, configDefaults } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    // Agent worktrees under .claude/ are isolated scratch checkouts of the
    // repo; their test copies must not be globbed into this project's run.
    exclude: [...configDefaults.exclude, '**/.claude/**'],
    coverage: {
      provider: 'v8',
      include: ['src/core/**/*.js'],
      reporter: ['text', 'lcov', 'json-summary'],
      reportsDirectory: 'coverage',
    },
  },
})
