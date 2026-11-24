/**
 * Content-Security-Policy for the admin SPA (`/_admin/*`). The admin is the part
 * that holds a session able to change the site, so the policy is about script:
 * only the admin bundle itself may run, nothing may frame the admin, and
 * plugins, foreign `<base>` URLs and foreign form targets are off. (`base-uri
 * 'self'` because the customize preview sets `<base href>` to the site.)
 * There is no 'unsafe-eval': the admin turns off zod's eval probe (zod-config.ts).
 *
 * Styles, images, fonts, media and frames may also come from `https:` because
 * the customize preview is an `srcdoc` frame, which inherits this policy: the
 * public page it shows can use web fonts or embeds from the site's own head
 * HTML and raw HTML blocks. That frame never runs script (no `allow-scripts`).
 *
 * Served twice with the same value: by `public/_headers` for files that Static
 * Assets answers before the Worker runs (`/_admin/`, `/_admin/index.html`), and
 * by `admin.ts` for client-side routes. A test keeps the two identical.
 */
export const ADMIN_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https:",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data: https:",
  "media-src 'self' https:",
  "frame-src 'self' https:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ')

/**
 * Keeps every admin page out of search results. Served next to ADMIN_CSP (both
 * places, same test) and repeated by the `<meta name="robots">` of the admin's
 * index.html. robots.txt does not list the admin: a crawler only sees noindex
 * on a page it may fetch, and the line would point everyone to the admin.
 */
export const ADMIN_ROBOTS = 'noindex'

/**
 * Policy for an uploaded file opened directly (`/media/*`): a sandboxed
 * document that loads nothing but the file itself, so even a file that a
 * browser mistook for HTML could not run script or reach the site's cookies.
 * `img-src 'self'` and inline styles let the browser's own image viewer work;
 * Chrome 157, Edge 157 and Firefox 155 still display PDFs under it.
 */
export const MEDIA_CSP = "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox"
