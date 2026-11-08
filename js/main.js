/* Application entry point: the only script loaded by index.html. */
const tauriInvoke =
    typeof window !== 'undefined' && Object.hasOwn(window, '__TAURI__') ? window.__TAURI__?.core?.invoke : null;

function showOtaRestartNotice(update) {
    if (!update?.restart_required) return;

    const banner = document.getElementById('otaUpdateBanner');
    const button = document.getElementById('otaRestartButton');
    if (!banner || !button) return;

    banner.hidden = false;
    button.addEventListener('click', async () => {
        button.disabled = true;
        button.textContent = 'Перезапуск…';
        try {
            await tauriInvoke('ota_restart_app');
        } catch {
            button.disabled = false;
            button.textContent = 'Перезапустить';
        }
    });
}

async function startApplication() {
    if (tauriInvoke) {
        try {
            const launch = await tauriInvoke('ota_prepare_launch');
            if (launch.activated) {
                window.location.reload();
                return;
            }
        } catch {
            // The bundled frontend remains available if OTA state cannot be read.
        }
    }

    await import('#js/settings.js');
    await import('#js/snackbar.js');
    await import('#js/game.js');
    await import('#js/multiplayer.js');

    if (!tauriInvoke) return;

    await new Promise((resolve) => window.setTimeout(resolve, 3000));

    try {
        await tauriInvoke('ota_mark_boot_success');
    } catch {
        // Keep the current frontend if the OTA state cannot be finalized.
    }

    try {
        const update = await tauriInvoke('ota_check_and_install');
        showOtaRestartNotice(update);
    } catch {
        // An unavailable update server must never block the game from starting.
    }
}

export const appReady = startApplication();
