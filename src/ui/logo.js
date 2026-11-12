// Tiles logo: an infinity sign (lemniscate) drawn as a single stroke in currentColor, so it takes the
// colour of the text around it (white, like the buttons). LOGO_FAVICON is the same mark on a dark
// rounded square, readable on light and dark browser tabs.
const MARK='<path d="M12 12c-2.2-2.9-4.1-4.3-5.9-4.3a4.3 4.3 0 0 0 0 8.6c1.8 0 3.7-1.4 5.9-4.3zm0 0c2.2 2.9 4.1 4.3 5.9 4.3a4.3 4.3 0 0 0 0-8.6c-1.8 0-3.7 1.4-5.9 4.3z" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/>';

export const LOGO_SVG=`<svg class="logo" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false">${MARK}</svg>`;
export const LOGO_FAVICON='data:image/svg+xml,'+encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24" rx="5" fill="#0e0e0e"/><g color="#ffffff">${MARK}</g></svg>`);
