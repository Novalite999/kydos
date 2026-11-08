import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: {
    // `npm run dev` proxies /api to `npm run dev:api` (local copy of the Vercel function).
    proxy: { '/api': 'http://localhost:3001' },
  },
});
