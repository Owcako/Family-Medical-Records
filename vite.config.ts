import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'
import { defineConfig } from 'vite'
import {viteStaticCopy} from 'vite-plugin-static-copy'

// https://vite.dev/config/
export default defineConfig({
  server: {
    // Stored records and verification artifacts must not reload an active draft.
    watch: {ignored: ['**/data/**', '**/test-results/**', '**/playwright-report/**', '**/.playwright-mcp/**']},
    // implementation-architecture.svg#O2: same-origin /api calls proxy to FastAPI in development.
    proxy: { '/api': 'http://127.0.0.1:8000' },
  },
  plugins: [
    viteStaticCopy ({targets: [
      {src: 'node_modules/pdfjs-dist/cmaps', dest: 'pdfjs'},
      {src: 'node_modules/pdfjs-dist/standard_fonts', dest: 'pdfjs'},
      {src: 'node_modules/pdfjs-dist/wasm', dest: 'pdfjs'},
    ]}),
    react(),
    babel({ presets: [reactCompilerPreset()] })
  ],
})
