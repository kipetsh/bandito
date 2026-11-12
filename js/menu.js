// Menu of actions (css/components/menu.css): the toggle opens and closes the popover. An action, a click outside and
// Esc close it; Esc and a click outside give focus back to the toggle (js/focus-return.js).
import { rememberOpener, returnFocus } from '#js/focus-return.js';

const menus = [];

export function createMenu(toggle, popover) {
    const isOpen = () => !popover.classList.contains('hidden');
    // Without focus return: for actions and screen changes, which put focus where they need it.
    const hide = () => {
        popover.classList.add('hidden');
        toggle.setAttribute('aria-expanded', 'false');
    };
    const close = () => {
        if (!isOpen()) return;
        returnFocus(popover);
        hide();
    };

    toggle.addEventListener('click', () => {
        if (isOpen()) return close();
        rememberOpener(popover, toggle);
        popover.classList.remove('hidden');
        toggle.setAttribute('aria-expanded', 'true');
    });
    // The action's own handler runs first, on the button itself.
    popover.addEventListener('click', (e) => {
        if (e.target.closest('button')) hide();
    });
    document.addEventListener('click', (e) => {
        if (isOpen() && !toggle.contains(e.target) && !popover.contains(e.target)) close();
    });
    // Capture: Esc closes the menu only, before the page's own Esc handlers see it.
    document.addEventListener(
        'keydown',
        (e) => {
            if (e.key !== 'Escape' || !isOpen()) return;
            close();
            e.preventDefault();
            e.stopPropagation();
        },
        true
    );

    const menu = { hide, close, isOpen };
    menus.push(menu);
    return menu;
}

// Screen changes hide every open menu.
export function hideMenus() {
    menus.forEach((menu) => menu.hide());
}
