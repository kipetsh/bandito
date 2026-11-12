// Tabler draws outline icons with stroke-width 2 on a 24 canvas, and a mask scales the line together with the icon.
// In CSS, url('@tabler-size/<px>/<style>/<name>.svg') points to a copy of the package icon made for display at <px>:
// <px> is a multiple of 8. An outline copy gets the stroke width that gives a 1.5px line on screen, a filled copy stays as is.
// The copy is written to node_modules/.cache when a stylesheet mentions it, before Vite resolves the url.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';

const require = createRequire(import.meta.url);
const reference = /@tabler-size\/(\d+)\/(outline|filled)\/([a-z0-9-]+)\.svg/g;
const cacheDirectory = resolve('node_modules/.cache/tabler-size');
const screenLine = 1.5;
const canvas = 24;

function writeVariant(size, style, name) {
    if (Number(size) % 8 !== 0) {
        throw new Error(`@tabler-size/${size}/${style}/${name}.svg: icon sizes are multiples of 8px`);
    }
    const svg = readFileSync(require.resolve(`@tabler/icons/${style}/${name}.svg`), 'utf8');
    let variant = svg;
    if (style === 'outline') {
        if (!svg.includes('stroke-width="2"')) {
            throw new Error(`@tabler/icons/${style}/${name}.svg has no stroke-width="2" to replace`);
        }
        const width = Number(((screenLine * canvas) / Number(size)).toFixed(3));
        variant = svg.replace('stroke-width="2"', `stroke-width="${width}"`);
    }
    const target = join(cacheDirectory, size, style, name + '.svg');
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, variant);
}

export const tablerSizeAlias = { find: /^@tabler-size\//, replacement: cacheDirectory + '/' };

export function tablerSize() {
    return {
        name: 'tabler-size',
        enforce: 'pre',
        transform(code, id) {
            if (!/\.css(?:$|\?)/.test(id)) {
                return null;
            }
            for (const [, size, style, name] of code.matchAll(reference)) {
                writeVariant(size, style, name);
            }
            return null;
        },
    };
}
