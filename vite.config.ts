import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  base: './', // Ensure assets are loaded correctly in Electron
  build: {
    outDir: 'dist', // Output directory for production build
  },
  server: {
    port: 3000, // Specify a port for the development server
  },
})
