import { rememberOpener, returnFocus } from '#js/focus-return.js';

// Centred dialogs: they fade in and out, give focus back to the opener and keep the page under them still, so a
// wheel or a swipe over the dialog doesn't scroll the page.
const open = new Set();
const closeTimers = new Map();
// Matches the closing animation in modal.css.
const closeDelay = 140;

export const isModalOpen = (modal) => open.has(modal);
export const anyModalOpen = () => open.size > 0;

export function openModal(modal, opener, focusTarget) {
    window.clearTimeout(closeTimers.get(modal));
    rememberOpener(modal, opener);
    open.add(modal);
    modal.classList.remove('is-closing', 'hidden');
    document.body.classList.add('scroll-locked');
    focusTarget.focus({ preventScroll: true });
}

export function closeModal(modal) {
    if (!open.has(modal)) return;
    returnFocus(modal);
    open.delete(modal);
    if (!open.size) document.body.classList.remove('scroll-locked');
    const reducedMotion =
        document.body.classList.contains('reduce-motion') ||
        window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reducedMotion) {
        modal.classList.add('hidden');
        return;
    }
    modal.classList.add('is-closing');
    closeTimers.set(
        modal,
        window.setTimeout(() => {
            modal.classList.add('hidden');
            modal.classList.remove('is-closing');
        }, closeDelay)
    );
}
