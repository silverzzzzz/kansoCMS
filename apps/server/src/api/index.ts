import { Hono } from 'hono'
import type { AppEnv } from '../env.ts'
import { authenticate, requireAuth } from '../middleware/auth.ts'
import { apiKeys } from './api-keys.ts'
import { auth } from './auth.ts'
import { media } from './media.ts'
import { pages } from './pages.ts'
import { postTypes } from './post-types.ts'
import { posts } from './posts.ts'
import { settings } from './settings.ts'
import { setup } from './setup.ts'
import { tags } from './tags.ts'

/**
 * REST API, mounted at /api/v1. Health, setup and login are public; management
 * routes are collected under protectedApi. Public form submission arrives in
 * Phase 2 and is protected by Turnstile instead.
 */
const protectedApi = new Hono<AppEnv>()
  .use('*', requireAuth('read'))
  .on(['POST', 'PUT', 'PATCH', 'DELETE'], '*', requireAuth('write'))
  .route('/api-keys', apiKeys)
  .route('/media', media)
  .route('/pages', pages)
  .route('/post-types', postTypes)
  .route('/posts', posts)
  .route('/settings', settings)
  .route('/tags', tags)

export const api = new Hono<AppEnv>()
  .use('*', authenticate)
  .get('/health', async (c) => {
    const site = await c.var.kanso.settings.site()
    return c.json({ ok: true, site: site.title, version: '0.0.0' })
  })
  .route('/setup', setup)
  .route('/auth', auth)
  .route('/', protectedApi)

/** Consumed by `hc<ApiType>()` in apps/admin. Type-only export. */
export type ApiType = typeof api
