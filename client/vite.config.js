import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The client reads the shared .env in the project root (only VITE_ variables).
export default defineConfig({
  plugins: [react()],
  envDir: '..',
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          firebase: ['firebase/app', 'firebase/auth'],
          vendor: ['react', 'react-dom', 'react-router-dom', '@tanstack/react-query', 'socket.io-client'],
        },
      },
    },
  },
  server: {
    port: 5173,
    // `npm run dev:local` points the web app at its own API on port 4100.
    proxy: {
      '/api': process.env.API_PROXY_TARGET || 'http://localhost:4000',
      '/socket.io': { target: process.env.API_PROXY_TARGET || 'http://localhost:4000', ws: true },
    },
  },
});
