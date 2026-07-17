import babel from '@rolldown/plugin-babel'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  // React Compiler stays out of the Vitest pipeline: react-hook-form's
  // formState proxy subscriptions are defeated by memoization under happy-dom.
  plugins: [
    react(),
    ...(process.env['VITEST'] === undefined ? [babel({ presets: [reactCompilerPreset()] })] : []),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      // Domain-only view of core: the SPA must never bundle/execute core's
      // server-side services (see src/core-domain.ts).
      '@rivian-kanban/core': fileURLToPath(new URL('./src/core-domain.ts', import.meta.url)),
    },
  },
  server: {
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
  test: {
    name: 'web',
    environment: 'happy-dom',
    include: ['src/**/*.unit.test.{ts,tsx}'],
    setupFiles: ['./src/test/setup.ts'],
    server: {
      deps: {
        // Load core natively (Node type-stripping) like the backend test
        // projects (ADR-014): a second, Vite-transformed instrumentation of
        // the same sources skews the merged coverage mapping.
        external: [/[\\/]packages[\\/]core[\\/]/],
      },
    },
  },
})
