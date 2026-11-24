import { KansoError } from '@kanso/core'
import { contentFieldsSchema, listQuerySchema, type RichTextDoc, slugSchema } from '@kanso/shared'
import { createMcpHandler, McpServer } from '@modelcontextprotocol/server'
import type { Context } from 'hono'
import { z } from 'zod'
import { logActivity } from './api/activity.ts'
import type { AppEnv } from './env.ts'

const kind = z.enum(['page', 'post'])
const id = z.number().int().positive()
const readOnly = { readOnlyHint: true, openWorldHint: false }
const createOnly = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
}
const draft = z.strictObject({
  title: contentFieldsSchema.shape.title,
  slug: slugSchema,
  body: z.string().max(32_000).describe('Plain text. Each line becomes a paragraph.'),
})

function draftDocument(body: string): RichTextDoc {
  return {
    type: 'doc',
    content: body.split(/\r\n|\n|\r/).map((line) => ({
      type: 'paragraph',
      content: line ? [{ type: 'text', text: line }] : [],
    })),
  }
}

async function toolResult(action: () => Promise<unknown>) {
  try {
    const value = await action()
    return { content: [{ type: 'text' as const, text: JSON.stringify(value) }] }
  } catch (error) {
    const text = error instanceof KansoError ? error.message : 'CMS operation failed'
    return { isError: true, content: [{ type: 'text' as const, text }] }
  }
}

function contentServer(c: Context<AppEnv>, canWrite: boolean) {
  const cms = c.var.kanso
  const server = new McpServer({ name: 'kansoCMS', version: '1.0.0' })
  server.registerTool(
    'list_content',
    {
      description:
        'List pages or posts, optionally filtering by title and status. Use get_content to read the body.',
      inputSchema: listQuerySchema
        .pick({ q: true, status: true })
        .extend({
          kind,
          page: id.default(1),
          perPage: id.max(100).default(20),
        })
        .strict(),
      annotations: readOnly,
    },
    ({ kind, ...query }) =>
      toolResult(async () => {
        const { items, total } = await (kind === 'page' ? cms.pages : cms.posts).list(query)
        return {
          items: items.map(({ id, title, slug, status, publishedAt }) => ({
            id,
            title,
            slug,
            status,
            publishedAt,
          })),
          total,
          page: query.page,
        }
      }),
  )
  server.registerTool(
    'get_content',
    {
      description: 'Read a page or post by ID, including its rich-text body and any page sections.',
      inputSchema: z.strictObject({ kind, id }),
      annotations: readOnly,
    },
    ({ kind, id }) =>
      toolResult(async () => {
        const item = await (kind === 'page' ? cms.pages : cms.posts).get(id)
        return {
          id: item.id,
          title: item.title,
          slug: item.slug,
          status: item.status,
          excerpt: item.excerpt,
          body: item.bodyJson,
          ...('sectionsJson' in item ? { sections: item.sectionsJson } : {}),
        }
      }),
  )

  server.registerTool(
    'list_post_types',
    {
      description: 'List available post type IDs and names to select a type for a new post draft.',
      inputSchema: z.strictObject({}),
      annotations: readOnly,
    },
    () =>
      toolResult(async () =>
        (await cms.postTypes.list()).map(({ id, name, slug }) => ({ id, name, slug })),
      ),
  )

  if (!canWrite) return server

  async function recordDraft(
    targetType: 'page' | 'post',
    item: { id: number; title: string; slug: string; status: string },
  ) {
    await logActivity(c, {
      action: 'create',
      targetType,
      targetId: item.id,
      summary: `MCP で下書き「${item.title}」を作成`,
    })
    return { id: item.id, title: item.title, slug: item.slug, status: item.status }
  }
  server.registerTool(
    'create_page_draft',
    {
      description: 'Create an unpublished top-level page draft from plain text.',
      inputSchema: draft,
      annotations: createOnly,
    },
    ({ title, slug, body }) =>
      toolResult(async () => {
        const item = await cms.pages.create(
          { title, slug, bodyJson: draftDocument(body), status: 'draft' },
          { allowRawHtml: false },
        )
        return recordDraft('page', item)
      }),
  )
  server.registerTool(
    'create_post_draft',
    {
      description:
        'Create an unpublished post from plain text. Use list_post_types to choose a postTypeId.',
      inputSchema: draft.extend({ postTypeId: id }),
      annotations: createOnly,
    },
    ({ title, slug, body, postTypeId }) =>
      toolResult(async () => {
        const item = await cms.posts.create(
          { title, slug, postTypeId, bodyJson: draftDocument(body), status: 'draft' },
          { allowRawHtml: false, authorId: null },
        )
        return recordDraft('post', item)
      }),
  )
  return server
}

export async function serveMcp(c: Context<AppEnv>) {
  c.header('Cache-Control', 'no-store')
  const origin = c.req.header('Origin')
  if (origin !== undefined && origin !== new URL(c.req.url).origin)
    return c.text('Forbidden origin', 403)
  if (c.req.method !== 'POST') {
    c.header('Allow', 'POST')
    return c.body(null, 405)
  }
  const token = /^Bearer ([^\s]+)$/i.exec(c.req.header('Authorization') ?? '')?.[1]
  const apiKey = token ? await c.var.kanso.auth.verifyApiKey(token) : null
  if (!apiKey) {
    c.header('WWW-Authenticate', 'Bearer realm="kansoCMS"')
    return c.json({ error: 'A valid CMS API key is required' }, 401)
  }
  c.set('principal', { kind: 'apiKey', apiKey })
  const handler = createMcpHandler(() => contentServer(c, apiKey.scope === 'write'), {
    maxRequestBodySize: 256 * 1024,
  })
  c.res = await handler.fetch(c.req.raw)
  c.header('Cache-Control', 'no-store, no-transform')
  return c.res
}
