import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const API_PORT = process.env.PORT ?? '4000';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: `http://localhost:${API_PORT}`, changeOrigin: false },
    },
  },
  build: { outDir: 'dist', sourcemap: false },
});
