import { Hono } from 'hono'
import type { AppEnv } from '../env.ts'
import { authenticate, requireAuth } from '../middleware/auth.ts'
import { bumpSiteCacheVersion } from '../middleware/cache.ts'
import { activity } from './activity.ts'
import { ai } from './ai.ts'
import { analytics } from './analytics.ts'
import { apiKeys } from './api-keys.ts'
import { auth } from './auth.ts'
import { forms } from './forms.ts'
import { media } from './media.ts'
import { menus } from './menus.ts'
import { pages } from './pages.ts'
import { postTypes } from './post-types.ts'
import { posts } from './posts.ts'
import { publicForms } from './public-forms.ts'
import { redirects } from './redirects.ts'
import { search } from './search.ts'
import { settings } from './settings.ts'
import { setup } from './setup.ts'
import { shareLinks } from './share-links.ts'
import { siteInfo } from './site.ts'
import { starter } from './starter.ts'
import { tags } from './tags.ts'
import { transfer } from './transfer.ts'

/**
 * REST API, mounted at /api/v1. Health, setup and login are public; management
 * routes are collected under protectedApi. Public form submission arrives in
 * Phase 2 and is protected by Turnstile instead.
 */
const protectedApi = new Hono<AppEnv>()
  .use('*', requireAuth('read'))
  .on(['POST', 'PUT', 'PATCH', 'DELETE'], '*', requireAuth('write'))
  .on(['POST', 'PUT', 'PATCH', 'DELETE'], '*', bumpSiteCacheVersion)
  .route('/activity', activity)
  .route('/ai', ai)
  .route('/analytics', analytics)
  .route('/api-keys', apiKeys)
  .route('/forms', forms)
  .route('/media', media)
  .route('/menus', menus)
  .route('/pages', pages)
  .route('/post-types', postTypes)
  .route('/posts', posts)
  .route('/redirects', redirects)
  .route('/search', search)
  .route('/settings', settings)
  .route('/share-links', shareLinks)
  .route('/site', siteInfo)
  .route('/starter', starter)
  .route('/tags', tags)
  .route('/', transfer)

export const api = new Hono<AppEnv>()
  .use('*', authenticate)
  .get('/health', async (c) => {
    const site = await c.var.kanso.settings.site()
    return c.json({ ok: true, site: site.title, version: '0.0.0' })
  })
  .route('/setup', setup)
  .route('/auth', auth)
  .route('/public/forms', publicForms)
  .route('/', protectedApi)

/** Consumed by `hc<ApiType>()` in apps/admin. Type-only export. */
export type ApiType = typeof api
