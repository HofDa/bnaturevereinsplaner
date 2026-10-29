import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts', 'tests/ui/**/*.test.tsx'],
    environment: 'node',
    restoreMocks: true,
  },
  oxc: { jsx: { runtime: 'automatic' } },
});
