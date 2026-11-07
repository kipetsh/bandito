import sharp from 'sharp';
import { readdir, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';

const buildDirectory = resolve('build');
const rasterExtensions = new Set(['.jpg', '.jpeg', '.png']);
const retinaIconSizes = new Map([
    ['solo-organic-circle.webp', { width: 120, height: 120 }],
    ['multiplayer-stars.webp', { width: 156, height: 144 }],
]);
const textExtensions = new Set(['.html', '.css', '.js', '.json', '.map']);

async function walk(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    const nested = await Promise.all(
        entries.map((entry) => {
            const path = join(directory, entry.name);
            return entry.isDirectory() ? walk(path) : [path];
        })
    );
    return nested.flat();
}

const files = await walk(buildDirectory);
const sourceImages = files.filter((file) => {
    const baseName = file.split('/').at(-1);
    return rasterExtensions.has(extname(file).toLowerCase()) || retinaIconSizes.has(baseName);
});

if (sourceImages.length === 0) {
    throw new Error('No source images were found in the production build.');
}

const optimized = [];
const skipped = [];

for (const inputPath of sourceImages) {
    const extension = extname(inputPath);
    const baseName = inputPath.split('/').at(-1);
    const iconSize = retinaIconSizes.get(baseName);
    const isRetinaIcon = Boolean(iconSize);
    const outputPath = isRetinaIcon
        ? inputPath.slice(0, -extension.length) + '-optimized.webp'
        : inputPath.slice(0, -extension.length) + '.webp';
    const isJpeg = extension.toLowerCase() === '.jpg' || extension.toLowerCase() === '.jpeg';
    const maxDimension = baseName.includes('background') ? 2560 : 1600;

    let pipeline = sharp(inputPath, { failOn: 'error' }).rotate();

    if (isRetinaIcon) {
        pipeline = pipeline
            .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 }, threshold: 8 })
            .resize({
                ...iconSize,
                fit: 'contain',
                background: { r: 0, g: 0, b: 0, alpha: 0 },
            });
    } else {
        pipeline = pipeline.resize({
            width: maxDimension,
            height: maxDimension,
            fit: 'inside',
            withoutEnlargement: true,
        });
    }

    const isMainLogo = baseName.startsWith('bandito-logo');

    pipeline = isRetinaIcon
        ? pipeline.webp({ quality: 88, alphaQuality: 100, effort: 6, smartSubsample: false })
        : isJpeg
          ? pipeline.webp({ quality: 85, effort: 6, smartSubsample: true })
          : isMainLogo
            ? pipeline.webp({ quality: 88, alphaQuality: 100, effort: 6, smartSubsample: false })
            : pipeline.webp({ lossless: true, effort: 6 });

    const result = await pipeline.toFile(outputPath);
    const original = await stat(inputPath);

    if (result.size >= original.size) {
        await unlink(outputPath);
        skipped.push({ inputPath, originalBytes: original.size });
        continue;
    }

    optimized.push({
        inputPath,
        outputPath,
        originalBytes: original.size,
        optimizedBytes: result.size,
    });
}

const replacements = new Map(
    optimized.map(({ inputPath, outputPath }) => [inputPath.split(/[\\/]/).at(-1), outputPath.split(/[\\/]/).at(-1)])
);

if (replacements.size > 0) {
    const textFiles = files.filter((file) => textExtensions.has(extname(file).toLowerCase()));

    for (const file of textFiles) {
        let content = await readFile(file, 'utf8');
        const original = content;

        for (const [sourceName, optimizedName] of replacements) {
            content = content.replaceAll(sourceName, optimizedName);
        }

        if (content !== original) {
            await writeFile(file, content, 'utf8');
        }
    }
}

await Promise.all(optimized.map(({ inputPath }) => unlink(inputPath)));

const originalBytes = optimized.reduce((total, image) => total + image.originalBytes, 0);
const optimizedBytes = optimized.reduce((total, image) => total + image.optimizedBytes, 0);
const reduction = originalBytes === 0 ? 0 : Math.round((1 - optimizedBytes / originalBytes) * 100);

console.log(
    [
        `Optimized ${optimized.length} of ${sourceImages.length} images.`,
        `${(originalBytes / 1024).toFixed(1)} KB → ${(optimizedBytes / 1024).toFixed(1)} KB`,
        `${reduction}% smaller.`,
        skipped.length ? `${skipped.length} image(s) kept in original format because WebP was not smaller.` : '',
    ]
        .filter(Boolean)
        .join(' ')
);
