import sharp from 'sharp';
import { readdir, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';

const buildDirectory = resolve('build');
const rasterExtensions = new Set(['.jpg', '.jpeg', '.png']);
const retinaIconSizes = new Map([
    ['solo-organic-circle', { width: 192, height: 192 }],
    ['multiplayer-stars', { width: 192, height: 178 }],
]);
const textExtensions = new Set(['.html', '.css', '.js', '.json', '.map']);

function getRetinaIconName(file) {
    const baseName = file.split('/').at(-1);
    return (
        [...retinaIconSizes.keys()].find(
            (name) => baseName === `${name}.webp` || (baseName.startsWith(`${name}-`) && baseName.endsWith('.webp'))
        ) ?? null
    );
}

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
    return rasterExtensions.has(extname(file).toLowerCase()) || getRetinaIconName(file);
});

if (sourceImages.length === 0) {
    throw new Error('No source images were found in the production build.');
}

const optimized = [];
const skipped = [];

for (const inputPath of sourceImages) {
    const extension = extname(inputPath);
    const baseName = inputPath.split('/').at(-1);
    const retinaIconName = getRetinaIconName(inputPath);
    const iconSize = retinaIconName ? retinaIconSizes.get(retinaIconName) : null;
    const isRetinaIcon = Boolean(iconSize);
    const outputPath = isRetinaIcon
        ? inputPath.slice(0, inputPath.lastIndexOf('/') + 1) + retinaIconName + '-optimized.webp'
        : inputPath.slice(0, -extension.length) + '.webp';
    const isJpeg = extension.toLowerCase() === '.jpg' || extension.toLowerCase() === '.jpeg';
    const maxDimension = baseName.includes('background') ? 2560 : 1600;

    let pipeline = sharp(inputPath, { failOn: 'error' }).rotate();

    if (isRetinaIcon) {
        pipeline = pipeline.trim({ background: { r: 0, g: 0, b: 0, alpha: 0 }, threshold: 8 }).resize({
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

    const original = await stat(inputPath);
    let result;

    if (isRetinaIcon) {
        // Always emit the required Retina asset at a consistent quality.
        // Its output size is not compared with the source: the source may already
        // be highly optimized, and visual quality takes priority over byte savings.
        result = await pipeline
            .webp({ quality: 76, alphaQuality: 100, effort: 6, smartSubsample: false })
            .toFile(outputPath);
    } else {
        if (isMainLogo) {
            pipeline = pipeline.webp({ quality: 76, alphaQuality: 100, effort: 6, smartSubsample: false });
        } else if (isJpeg) {
            pipeline = pipeline.webp({ quality: 85, effort: 6, smartSubsample: true });
        } else {
            pipeline = pipeline.webp({ lossless: true, effort: 6 });
        }

        result = await pipeline.toFile(outputPath);

        if (result.size >= original.size) {
            await unlink(outputPath);
            skipped.push({ inputPath, originalBytes: original.size });
            continue;
        }
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
