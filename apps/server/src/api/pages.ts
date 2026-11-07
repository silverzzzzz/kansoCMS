import { zValidator } from '@hono/zod-validator'
import { KansoError } from '@kanso/core'
import {
  createPageSchema,
  listQuerySchema,
  type PageSection,
  updatePageSchema,
} from '@kanso/shared'
import { type Context, Hono } from 'hono'
import type { AppEnv } from '../env.ts'
import { invalidSectionDetails, sectionsMetaByTheme } from '../site/themes/sections-meta.ts'
import { canUseRawHtml, currentUserId } from './principal.ts'
import { idParamSchema, revisionParamSchema, validationHook } from './validate.ts'

/** Sections are validated against the active theme's catalog, not just their shape. */
async function assertValidSections(
  c: Context<AppEnv>,
  sections: PageSection[] | null | undefined,
): Promise<void> {
  if (!sections || sections.length === 0) return
  const site = await c.var.kanso.settings.site()
  const catalog = sectionsMetaByTheme[site.theme] ?? sectionsMetaByTheme.default
  const details = invalidSectionDetails(catalog, sections)
  if (details.length > 0) throw KansoError.validation('Invalid sections', details)
}

/** API responses expose the stored sections as `sections`, not the column name. */
function toPageItem<T extends { sectionsJson: PageSection[] | null }>({
  sectionsJson,
  ...rest
}: T) {
  return { ...rest, sections: sectionsJson }
}

export const pages = new Hono<AppEnv>()
  .get('/', zValidator('query', listQuerySchema, validationHook), async (c) => {
    const query = c.req.valid('query')
    const page = query.page ?? 1
    const perPage = query.perPage ?? 20
    const result = await c.var.kanso.pages.list(query)
    return c.json({ ...result, page, perPage })
  })
  .post('/', zValidator('json', createPageSchema, validationHook), async (c) => {
    const input = c.req.valid('json')
    await assertValidSections(c, input.sections)
    const item = await c.var.kanso.pages.create(input, {
      allowRawHtml: canUseRawHtml(c.var.principal),
    })
    return c.json({ item: toPageItem(item) }, 201)
  })
  .get('/:id', zValidator('param', idParamSchema, validationHook), async (c) => {
    return c.json({ item: toPageItem(await c.var.kanso.pages.get(c.req.valid('param').id)) })
  })
  .get('/:id/revisions', zValidator('param', idParamSchema, validationHook), async (c) => {
    const id = c.req.valid('param').id
    await c.var.kanso.pages.get(id)
    return c.json({ items: await c.var.kanso.revisions.list('page', id) })
  })
  .get(
    '/:id/revisions/:revisionId',
    zValidator('param', revisionParamSchema, validationHook),
    async (c) => {
      const { id, revisionId } = c.req.valid('param')
      return c.json({ item: await c.var.kanso.revisions.get('page', id, revisionId) })
    },
  )
  .post(
    '/:id/revisions/:revisionId/restore',
    zValidator('param', revisionParamSchema, validationHook),
    async (c) => {
      const { id, revisionId } = c.req.valid('param')
      const item = await c.var.kanso.pages.restoreRevision(id, revisionId, {
        allowRawHtml: canUseRawHtml(c.var.principal),
        userId: currentUserId(c.var.principal),
      })
      return c.json({ item: toPageItem(item) })
    },
  )
  .patch(
    '/:id',
    zValidator('param', idParamSchema, validationHook),
    zValidator('json', updatePageSchema, validationHook),
    async (c) => {
      const id = c.req.valid('param').id
      const input = c.req.valid('json')
      await assertValidSections(c, input.sections)
      const item = await c.var.kanso.pages.update(id, input, {
        allowRawHtml: canUseRawHtml(c.var.principal),
        userId: currentUserId(c.var.principal),
      })
      return c.json({ item: toPageItem(item) })
    },
  )
  .delete('/:id', zValidator('param', idParamSchema, validationHook), async (c) => {
    const id = c.req.valid('param').id
    await c.var.kanso.pages.delete(id)
    return c.json({ ok: true })
  })
