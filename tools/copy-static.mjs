import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const outputDirectory = resolve('build');
await mkdir(outputDirectory, { recursive: true });

// Vite bundles css/ and js/ from index.html; resources/ holds data fetched at runtime.
await cp(resolve('resources'), resolve(outputDirectory, 'resources'), {
    recursive: true,
    force: true,
});

const indexHtml = await readFile(resolve(outputDirectory, 'index.html'), 'utf8');
const fallbackScript = [
    '<script>',
    '    const pathSegments = window.location.pathname.split("/").filter(Boolean);',
    '    if (/^[A-Z0-9]{6}$/i.test(pathSegments.at(-1) || "")) pathSegments.pop();',
    '    const base = document.createElement("base");',
    '    base.href = "/" + pathSegments.join("/") + (pathSegments.length ? "/" : "");',
    '    document.head.prepend(base);',
    '</script>',
].join('\n');
const fallbackHtml = indexHtml.replace('<head>', '<head>\n' + fallbackScript);
if (fallbackHtml === indexHtml) throw new Error('Could not add the app base path to the GitHub Pages fallback.');
await writeFile(resolve(outputDirectory, '404.html'), fallbackHtml);
