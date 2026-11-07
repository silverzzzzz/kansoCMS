import { zValidator } from '@hono/zod-validator'
import { KansoError } from '@kanso/core'
import { idSchema, pageSectionsSchema, sectionValuesSchemaFor } from '@kanso/shared'
import { Hono } from 'hono'
import { z } from 'zod'
import { validationHook } from '../api/validate.ts'
import type { AppEnv } from '../env.ts'
import { authenticate } from '../middleware/auth.ts'
import { loadSiteContext } from './context.ts'
import { renderPage, renderPost } from './render.tsx'
import { prepareSections, SectionsBody } from './sections.tsx'

const previewParamSchema = z.object({ kind: z.enum(['page', 'post']), id: idSchema })

const draftPageSchema = z.object({
  title: z.string().trim().max(200).default(''),
  sections: pageSectionsSchema,
  /** Unsaved theme settings for the active theme; falls back to the stored ones. */
  themeSettings: z.record(z.string(), z.unknown()).optional(),
})

export const preview = new Hono<AppEnv>()
  .use('*', authenticate)
  .get('/:kind/:id', zValidator('param', previewParamSchema, validationHook), async (c) => {
    if (c.var.principal?.kind !== 'session') throw KansoError.unauthorized()
    const { kind, id } = c.req.valid('param')
    c.header('cache-control', 'no-store')
    c.header('x-robots-tag', 'noindex')

    if (kind === 'page') return renderPage(c, await c.var.kanso.pages.get(id), { preview: true })

    const post = await c.var.kanso.posts.getWithRelations(id)
    const type = await c.var.kanso.postTypes.get(post.postTypeId)
    return renderPost(c, post, type, { preview: true })
  })
  /** Render unsaved section drafts for the customize editor's preview pane. */
  .post('/draft/page', zValidator('json', draftPageSchema, validationHook), async (c) => {
    if (c.var.principal?.kind !== 'session') throw KansoError.unauthorized()
    const { title, sections, themeSettings } = c.req.valid('json')
    c.header('cache-control', 'no-store')
    c.header('x-robots-tag', 'noindex')

    const ctx = await loadSiteContext(c.var.kanso, c.env.SITE_URL)
    const draftParsed = themeSettings
      ? sectionValuesSchemaFor(ctx.theme.settingsFields).safeParse(themeSettings)
      : null
    const draftTheme = draftParsed?.success ? draftParsed.data : ctx.themeSettings
    const prepared = await prepareSections(c.var.kanso, ctx.theme, sections)
    const meta = ctx.meta({ title: title || null, path: '/', noindex: true })
    return c.html(
      <ctx.theme.Layout meta={meta} nav={ctx.nav} search={ctx.search} themeSettings={draftTheme}>
        <SectionsBody sections={prepared} formatDate={ctx.formatDate} />
      </ctx.theme.Layout>,
    )
  })
