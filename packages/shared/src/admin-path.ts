/**
 * Where the admin UI is served, without a trailing slash. The Worker, the admin build and router,
 * the admin links in e-mails and the reserved slugs read it from here.
 * `apps/server/public/_headers` repeats it, and a test keeps the two equal.
 */
export const ADMIN_PATH = '/_admin'

/** The admin path's top-level segment, which no page, post type or redirect may claim. */
export const ADMIN_SEGMENT = ADMIN_PATH.slice(1)
