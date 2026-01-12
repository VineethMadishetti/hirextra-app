import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // base: '/peoplefinder/', // Keep commented out for local dev unless serving from this subpath
  server: {
    proxy: {
      '/api': {
        //  target: 'https://hirextra-app.onrender.com',
        target: 'http://127.0.0.1:5000', // Match the default server port (5000)
        changeOrigin: true,
        secure: false,
      }
    }
  },
  esbuild: {
    drop: ['console', 'debugger'], // Remove logs/debugger in production for speed & security
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'react-vendor': ['react', 'react-dom', 'react-router-dom'],
          'ui-vendor': ['lucide-react', 'react-hot-toast', '@tanstack/react-query']
        }
      }
    }
  }
})