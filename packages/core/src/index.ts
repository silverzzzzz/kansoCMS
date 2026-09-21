// Cloudflare types are imported as a module (not the ambient globals) so that
// browser programs — apps/admin pulls this graph in via the type-only
// `ApiType` import — can type-check core without Workers globals.
import type { D1Database, R2Bucket } from '@cloudflare/workers-types'
import { createDb } from './db/client.ts'
import { authService } from './services/auth.ts'
import { cacheVersionService } from './services/cache-version.ts'
import { formsService } from './services/forms.ts'
import { mediaService } from './services/media.ts'
import { pagesService } from './services/pages.ts'
import { postTypesService } from './services/post-types.ts'
import { postsService } from './services/posts.ts'
import { redirectsService } from './services/redirects.ts'
import { revisionsService } from './services/revisions.ts'
import { searchService } from './services/search.ts'
import { settingsService } from './services/settings.ts'
import { taxonomiesService } from './services/taxonomies.ts'

export {
  effectiveExcerpt,
  extractExcerpt,
  plainText,
  type RenderOptions,
  renderRichText,
} from './content/index.ts'
export { buildSubmissionsCsv, type SubmissionCsvRow } from './forms/csv.ts'
export {
  buildSubmissionNotification,
  type SubmissionNotification,
  type SubmissionNotificationInput,
} from './mail/notification.ts'

export interface KansoBindings {
  db: D1Database
  media: R2Bucket
}

/**
 * Entry point for everything outside `core`. Construct once per request from
 * the Worker `env` (bindings are request-safe; no module-level state).
 */
export function createKanso(bindings: KansoBindings) {
  const db = createDb(bindings.db)
  return {
    db,
    bucket: bindings.media,
    auth: authService(db),
    cacheVersion: cacheVersionService(db),
    forms: formsService(db),
    media: mediaService(db, bindings.media),
    settings: settingsService(db),
    pages: pagesService(db),
    postTypes: postTypesService(db),
    posts: postsService(db),
    redirects: redirectsService(db),
    revisions: revisionsService(db),
    search: searchService(db),
    taxonomies: taxonomiesService(db),
  }
}

export type Kanso = ReturnType<typeof createKanso>

export type { Db } from './db/client.ts'
export { KansoError, type KansoErrorCode } from './errors.ts'
