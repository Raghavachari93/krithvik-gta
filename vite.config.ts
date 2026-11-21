import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // relative paths so the build works from any sub-folder (e.g. GitHub Pages)
  base: './',
  plugins: [react()],
  server: { port: 5173, open: false },
  build: { chunkSizeWarningLimit: 2000 },
});
