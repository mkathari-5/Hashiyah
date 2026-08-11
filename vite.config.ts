/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath } from 'node:url'

// fileURLToPath, not `.pathname` — this project lives under a path containing a
// space, which `.pathname` would hand back percent-encoded.
const src = fileURLToPath(new URL('./src', import.meta.url))

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { port: 5174, strictPort: true },
  resolve: {
    alias: { '@': src },
  },
  build: {
    target: 'es2022',
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
})

