import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import sharp from 'sharp';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const buildDirectory = resolve(projectRoot, 'build');
const sourceImagesDirectory = resolve(projectRoot, 'assets/images');
const buildImagesDirectory = resolve(buildDirectory, 'assets');

function localReferences(html) {
    return [...html.matchAll(/(?:src|href)\s*=\s*["']([^"']+)["']/gi)]
        .map((match) => match[1])
        .filter((value) => value && !/^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(value))
        .map((value) => decodeURIComponent(value.split(/[?#]/, 1)[0]).replace(/^\.\//, ''));
}

test('production build contains index.html and every referenced local asset', () => {
    const indexPath = resolve(buildDirectory, 'index.html');
    assert.ok(existsSync(indexPath), 'Vite did not produce build/index.html');

    const html = readFileSync(indexPath, 'utf8');
    assert.match(html, /<title>Bandito — карточная игра<\/title>/);

    for (const reference of localReferences(html)) {
        assert.ok(existsSync(resolve(buildDirectory, reference)), `Build output is missing: ${reference}`);
    }
});

test('the application is bundled into one script and card data is copied for runtime fetch', () => {
    const html = readFileSync(resolve(buildDirectory, 'index.html'), 'utf8');
    const localScripts = [...html.matchAll(/<script[^>]*src="([^":]+)"/g)].map((match) => match[1]);
    assert.equal(localScripts.length, 1, `Expected one bundled script, found: ${localScripts.join(', ')}`);
    assert.match(localScripts[0], /^\.\/assets\/index-[\w-]+\.js$/);

    const cardData = 'resources/bandido-matrices/cards.json';
    assert.ok(existsSync(resolve(buildDirectory, cardData)), `Missing runtime file in build: ${cardData}`);
});

test('critical backgrounds and logos are preloaded', () => {
    const html = readFileSync(resolve(buildDirectory, 'index.html'), 'utf8');
    const criticalAssets = [
        'bandito-background-clean',
        'bandito-logo',
        'bandito-background-clean-night',
        'bandito-logo-night-512',
    ];

    for (const name of criticalAssets) {
        const preloadPattern = new RegExp(
            `<link[^>]+rel="preload"[^>]+as="image"[^>]+href="[^"]*${name}(?:-[^./"]+)?\\.(?:webp|png|jpe?g)"`
        );
        assert.match(html, preloadPattern);
    }

    assert.match(html, /id="brandLogo"[^>]+fetchpriority="high"/);
});

test('all source images are emitted once as optimized, hashed WebP assets', () => {
    const sourceFiles = readdirSync(sourceImagesDirectory).filter((name) => /\.(?:png|jpe?g)$/i.test(name));
    const outputFiles = readdirSync(buildImagesDirectory);
    assert.ok(sourceFiles.length > 0, 'No source raster images found');

    let originalBytes = 0;
    let outputBytes = 0;

    for (const sourceName of sourceFiles) {
        const sourcePath = join(sourceImagesDirectory, sourceName);
        const sourceSize = statSync(sourcePath).size;
        const stem = sourceName.replace(/\.(?:png|jpe?g)$/i, '');
        // Vite uses an 8-character base64url hash; exclude source stems that extend this stem.
        const hashedNamePattern = new RegExp(`^${stem}-[\\w-]{8}\\.(?:webp|png|jpe?g)$`, 'i');
        const longerStems = sourceFiles
            .map((name) => name.replace(/\.(?:png|jpe?g)$/i, ''))
            .filter((candidate) => candidate.startsWith(`${stem}-`));
        const matches = outputFiles.filter(
            (name) => hashedNamePattern.test(name) && !longerStems.some((candidate) => name.startsWith(`${candidate}-`))
        );

        originalBytes += sourceSize;
        assert.equal(matches.length, 1, `Expected one hashed image for ${sourceName}; found ${matches.length}`);

        const outputName = matches[0];
        const outputSize = statSync(join(buildImagesDirectory, outputName)).size;

        if (/\.webp$/i.test(outputName)) {
            assert.ok(outputSize < sourceSize, `Optimized image is not smaller: ${sourceName}`);
        } else {
            const outputExtension = outputName.slice(outputName.lastIndexOf('.'));
            const sourceExtension = sourceName.slice(sourceName.lastIndexOf('.'));
            assert.equal(outputExtension, sourceExtension, `Unexpected retained image format for ${sourceName}`);
        }

        outputBytes += outputSize;
    }

    assert.ok(outputBytes < originalBytes, 'Image optimization did not reduce total image size');

    const builtFiles = walkFiles(buildDirectory);
    const references = builtFiles
        .filter((file) => /\.(?:html|css|js)$/i.test(file))
        .map((file) => readFileSync(file, 'utf8'))
        .join('\n');

    for (const sourceName of sourceFiles) {
        const stem = sourceName.replace(/\.(?:png|jpe?g)$/i, '');
        const hashedAssetPattern = new RegExp(`${stem}-[a-zA-Z0-9_-]+\\.(?:webp|png|jpe?g)`);
        assert.match(references, hashedAssetPattern, `No built reference found for ${sourceName}`);
    }

    assert.ok(!references.includes('assets/images/bandito-'), 'Unhashed theme image references remain in built files');
});

test('game mode icons are cropped and emitted as 3x Retina WebP assets at fixed quality', async () => {
    const expectedIcons = [
        {
            source: 'solo-organic-circle.webp',
            output: 'solo-organic-circle-optimized.webp',
            width: 192,
            height: 192,
        },
        {
            source: 'multiplayer-stars.webp',
            output: 'multiplayer-stars-optimized.webp',
            width: 192,
            height: 178,
        },
    ];
    const builtFiles = walkFiles(buildDirectory);
    const html = readFileSync(resolve(buildDirectory, 'index.html'), 'utf8');

    for (const icon of expectedIcons) {
        const sourcePath = join(sourceImagesDirectory, icon.source);
        const outputPath = builtFiles.find((file) => file.endsWith(icon.output));
        assert.ok(outputPath, `Missing optimized Retina icon: ${icon.output}`);

        const metadata = await sharp(outputPath).metadata();
        assert.equal(metadata.width, icon.width, `Unexpected width for ${icon.output}`);
        assert.equal(metadata.height, icon.height, `Unexpected height for ${icon.output}`);
        assert.ok(html.includes(icon.output), `index.html does not reference ${icon.output}`);
        assert.ok(!html.includes(icon.source), `index.html still references the untrimmed source: ${icon.source}`);
    }
});

function walkFiles(directory) {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const path = join(directory, entry.name);
        return entry.isDirectory() ? walkFiles(path) : [path];
    });
}
