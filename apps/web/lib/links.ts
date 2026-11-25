/**
 * Store listing URLs. Set them once the extension is published, e.g. in Vercel's environment variables:
 *   NEXT_PUBLIC_CHROME_WEB_STORE_URL=https://chromewebstore.google.com/detail/mediagrab/<id>
 *   NEXT_PUBLIC_FIREFOX_ADDONS_URL=https://addons.mozilla.org/firefox/addon/mediagrab/
 * Until then the site links to its own Extension page with manual install steps.
 */
export const CHROME_WEB_STORE_URL = process.env.NEXT_PUBLIC_CHROME_WEB_STORE_URL || null;
export const FIREFOX_ADDONS_URL = process.env.NEXT_PUBLIC_FIREFOX_ADDONS_URL || null;
