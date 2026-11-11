// A closing overlay (dialog, popover, panel) gives focus back to the control that opened it, so the keyboard
// continues from there instead of the top of the page. The opener is passed explicitly, because Safari does not
// focus a clicked button; it may be a function for openers that are re-rendered while the overlay is open.
const openers = new WeakMap();

export function rememberOpener(overlay, opener) {
    openers.set(overlay, opener);
}

// Call before hiding the overlay. Focus the user has already moved outside the overlay stays where it is.
export function returnFocus(overlay) {
    const opener = openers.get(overlay);
    openers.delete(overlay);
    const active = document.activeElement;
    if (!opener || (active && active !== document.body && !overlay.contains(active))) return;
    // After the current handler: it may re-render the opener.
    queueMicrotask(() => (typeof opener === 'function' ? opener() : opener)?.focus({ preventScroll: true }));
}
