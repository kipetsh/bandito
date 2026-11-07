import { defineConfig } from 'vite';

export default defineConfig({
    // Relative paths keep the build working on GitHub Pages project URLs.
    base: './',
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
