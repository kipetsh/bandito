import { defineConfig } from 'vite';
import { tablerSize, tablerSizeAlias } from './tools/vite-tabler-size.mjs';

export default defineConfig({
    // Relative paths keep the build working on GitHub Pages project URLs.
    base: './',
    plugins: [tablerSize()],
    resolve: {
        alias: [tablerSizeAlias],
    },
    build: {
        outDir: 'build',
        emptyOutDir: true,
        target: 'es2022',
        sourcemap: true,
    },
    server: {
        port: 3000,
        open: true,
    },
});
