import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = 'src-tauri/gen/android/app/src/main';
const matches = [];

function walk(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) walk(path);
        else if (entry.name === 'MainActivity.kt') matches.push(path);
    }
}

walk(root);

if (matches.length !== 1) {
    throw new Error('Expected exactly one generated MainActivity.kt; found ' + matches.length + '.');
}

const path = matches[0];
const current = readFileSync(path, 'utf8');
const packageLine = current.match(/^package [^\r\n]+/m)?.[0];

if (!packageLine || !/class MainActivity\s*:\s*TauriActivity/.test(current)) {
    throw new Error('Unexpected Tauri MainActivity.kt template; refusing to overwrite it.');
}

const updated = [
    packageLine,
    '',
    'import android.os.Bundle',
    'import android.view.View',
    '',
    'class MainActivity : TauriActivity() {',
    '    override fun onCreate(savedInstanceState: Bundle?) {',
    '        super.onCreate(savedInstanceState)',
    '        hideStatusBar()',
    '    }',
    '',
    '    override fun onWindowFocusChanged(hasFocus: Boolean) {',
    '        super.onWindowFocusChanged(hasFocus)',
    '        if (hasFocus) hideStatusBar()',
    '    }',
    '',
    '    @Suppress("DEPRECATION")',
    '    private fun hideStatusBar() {',
    '        window.decorView.systemUiVisibility =',
    '            View.SYSTEM_UI_FLAG_FULLSCREEN or View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY',
    '    }',
    '}',
    '',
].join('\n');

writeFileSync(path, updated);
console.log('Configured Bandito Android to hide the system status bar.');
