import { createHash, createPrivateKey, sign } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

const privateKeyBase64 = process.env.OTA_SIGNING_PRIVATE_KEY;
const version = process.env.OTA_VERSION;

if (!privateKeyBase64) {
    throw new Error('Missing OTA_SIGNING_PRIVATE_KEY GitHub Actions secret');
}

if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error('OTA_VERSION must be a semantic version such as 0.1.123');
}

const archive = await readFile('web-assets.zip');
const privateKey = createPrivateKey(Buffer.from(privateKeyBase64, 'base64').toString('utf8'));
const manifest = {
    schema_version: 1,
    version,
    min_app_version: '0.1.1',
    archive_name: 'web-assets.zip',
    archive_sha256: createHash('sha256').update(archive).digest('hex'),
    notes: 'Обновление интерфейса Bandito',
};
const manifestBytes = Buffer.from(JSON.stringify(manifest));
const signature = sign(null, manifestBytes, privateKey).toString('base64');

await writeFile('manifest.json', manifestBytes);
await writeFile('manifest.sig', signature + '\n');
