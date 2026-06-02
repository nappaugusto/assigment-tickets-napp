import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    proxy: {
      '/auth': { target: 'http://127.0.0.1:3001', changeOrigin: true },
      '/tickets': { target: 'http://127.0.0.1:3001', changeOrigin: true },
      '/atribuir': { target: 'http://127.0.0.1:3001', changeOrigin: true },
      '/desatribuir': { target: 'http://127.0.0.1:3001', changeOrigin: true },
      '/app-version': { target: 'http://127.0.0.1:3001', changeOrigin: true },
      '/kanban': { target: 'http://127.0.0.1:3001', changeOrigin: true },
      '/notes': { target: 'http://127.0.0.1:3001', changeOrigin: true },
      '/people': { target: 'http://127.0.0.1:3001', changeOrigin: true },
      '/preferences': { target: 'http://127.0.0.1:3001', changeOrigin: true },
      '/mcp': { target: 'http://127.0.0.1:3001', changeOrigin: true },
      '/cases': { target: 'http://127.0.0.1:3001', changeOrigin: true },
    },
  },
})
