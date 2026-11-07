import { spawnSync } from 'node:child_process';

const commands = [
    ['Prettier', 'format:check'],
    ['ESLint', 'lint'],
];
const results = [];

for (const [label, script] of commands) {
    console.log(`\n=== ${label}: npm run ${script} ===\n`);

    const result = spawnSync('npm', ['run', script], {
        stdio: 'inherit',
        shell: process.platform === 'win32',
    });

    const exitCode = result.error ? 1 : (result.status ?? 1);
    if (result.error) {
        console.error(result.error);
    }

    results.push({ label, exitCode });
}

console.log('\n=== Check summary ===');
for (const { label, exitCode } of results) {
    console.log(`${exitCode === 0 ? 'PASS' : 'FAIL'}  ${label}`);
}

process.exitCode = results.every(({ exitCode }) => exitCode === 0) ? 0 : 1;
