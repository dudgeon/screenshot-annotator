import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// `BASE_PATH` lets the Pages workflow inject `/screenshot-annotator/` for the
// `dudgeon.github.io/screenshot-annotator/` deploy; local `vite dev` falls
// back to `/`. A custom domain build sets BASE_PATH=/.
export default defineConfig({
  base: process.env.BASE_PATH ?? '/',
  plugins: [react()],
  server: { port: 5173 },
});
