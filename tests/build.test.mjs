import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

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

test('GitHub Pages room links serve the same app shell without redirecting', () => {
    const fallbackPath = resolve(buildDirectory, '404.html');
    assert.ok(existsSync(fallbackPath), 'GitHub Pages room-route fallback is missing');

    const html = readFileSync(fallbackPath, 'utf8');
    assert.ok(html.includes('<title>Bandito — карточная игра</title>'));
    assert.ok(html.includes('window.location.pathname'));
    assert.ok(html.includes('document.head.prepend(base)'));
    assert.ok(!html.includes('window.location.replace('));
    assert.ok(!html.includes('window.location.assign('));

    for (const reference of localReferences(html)) {
        assert.ok(existsSync(resolve(buildDirectory, reference)), `Fallback build is missing: ${reference}`);
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

test('game mode icons remain inline SVGs in the production build', () => {
    const html = readFileSync(resolve(buildDirectory, 'index.html'), 'utf8');
    const soloStart = html.indexOf('<section class="card card--glass menu__card menu__card--solo">');
    const soloEnd = html.indexOf('</section>', soloStart);
    const multiplayerStart = html.indexOf('<section id="coopCard" class="card card--glass menu__card">');
    const multiplayerEnd = html.indexOf('</section>', multiplayerStart);
    const soloCard = html.slice(soloStart, soloEnd);
    const multiplayerCard = html.slice(multiplayerStart, multiplayerEnd);

    assert.ok(soloStart >= 0 && soloEnd > soloStart, 'Solo game card is missing from the production build');
    assert.ok(
        multiplayerStart >= 0 && multiplayerEnd > multiplayerStart,
        'Multiplayer card is missing from the production build'
    );
    assert.ok(soloCard.includes('<svg viewBox="0 0 48 48">'), 'Solo game SVG icon is missing');
    assert.ok(multiplayerCard.includes('<svg viewBox="0 0 52 48">'), 'Multiplayer SVG icon is missing');
    assert.ok(!html.includes('solo-organic-circle.webp'), 'The obsolete solo raster icon is still referenced');
    assert.ok(!html.includes('multiplayer-stars.webp'), 'The obsolete multiplayer raster icon is still referenced');
});

function walkFiles(directory) {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const path = join(directory, entry.name);
        return entry.isDirectory() ? walkFiles(path) : [path];
    });
}
