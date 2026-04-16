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
      '/auth': { target: 'http://127.0.0.1:5000', changeOrigin: true },
      '/tickets': { target: 'http://127.0.0.1:5000', changeOrigin: true },
      '/atribuir': { target: 'http://127.0.0.1:5000', changeOrigin: true },
      '/desatribuir': { target: 'http://127.0.0.1:5000', changeOrigin: true },
      '/app-version': { target: 'http://127.0.0.1:5000', changeOrigin: true },
    },
  },
})
