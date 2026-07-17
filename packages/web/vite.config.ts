import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  // React Compiler wiring (reactCompilerPreset + @rolldown/plugin-babel) lands with the board UI
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
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
  },
})
