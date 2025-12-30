import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: '/peoplefinder/', // <-- Add this line
  server: {
    proxy: {
      '/api': {
        target: 'https://hirextra-app.onrender.com',
        changeOrigin: true,
        secure: false,
      }
    }
  }
})