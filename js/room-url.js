const ROOM_CODE_PATTERN = /^[A-Z0-9]{6}$/i;
const DEFAULT_WEB_ORIGIN = 'https://kipetsh.github.io';
const DEFAULT_WEB_PATH = '/bandito/';

export function getRoomCodeFromPath(pathname) {
    const segments = String(pathname || '')
        .split('/')
        .filter(Boolean);
    const candidate = segments.at(-1) || '';
    return ROOM_CODE_PATTERN.test(candidate) ? candidate.toUpperCase() : null;
}

export function getAppBasePath(pathname) {
    const segments = String(pathname || '')
        .split('/')
        .filter(Boolean);
    if (ROOM_CODE_PATTERN.test(segments.at(-1) || '')) segments.pop();
    return '/' + segments.join('/') + (segments.length ? '/' : '');
}

export function getRoomPath(code, pathname) {
    const basePath = getAppBasePath(pathname);
    return code ? basePath + encodeURIComponent(String(code).toUpperCase()) : basePath;
}

export function getRoomUrl(code, location) {
    const webLocation =
        location && /^https?:$/.test(location.protocol)
            ? location
            : { origin: DEFAULT_WEB_ORIGIN, pathname: DEFAULT_WEB_PATH };
    return new URL(getRoomPath(code, webLocation.pathname), webLocation.origin).href;
}
