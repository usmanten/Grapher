import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// Everything is inlined into one HTML file, so the page works offline from
// .grapher/index.html and never loads anything from the network.
export default defineConfig({
  plugins: [react(), viteSingleFile({ removeViteModuleLoader: true })],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    modulePreload: false,
    reportCompressedSize: false,
  },
});
