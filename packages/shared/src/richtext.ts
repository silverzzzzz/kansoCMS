import { z } from 'zod'
import { slugSchema } from './slug.ts'

export const richTextMarkSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('bold') }),
  z.object({ type: z.literal('italic') }),
  z.object({ type: z.literal('underline') }),
  z.object({ type: z.literal('strike') }),
  z.object({ type: z.literal('code') }),
  z.object({
    type: z.literal('link'),
    attrs: z.object({
      href: z.string(),
      target: z.literal('_blank').nullable().optional(),
      rel: z.string().nullable().optional(),
      title: z.string().nullable().optional(),
    }),
  }),
])
export type RichTextMark = z.infer<typeof richTextMarkSchema>

interface RichTextTextNode {
  type: 'text'
  text: string
  marks?: RichTextMark[]
}

interface RichTextHardBreakNode {
  type: 'hardBreak'
}

interface RichTextImageNode {
  type: 'image'
  attrs: {
    src: string
    alt?: string | null
    title?: string | null
    width?: number | null
    height?: number | null
  }
}

type RichTextInlineNode = RichTextTextNode | RichTextHardBreakNode | RichTextImageNode

interface RichTextParagraphNode {
  type: 'paragraph'
  attrs?: {
    textAlign?: 'left' | 'center' | 'right' | null
  }
  content?: RichTextInlineNode[]
}

interface RichTextHeadingNode {
  type: 'heading'
  attrs: {
    level: 1 | 2 | 3 | 4
  }
  content?: RichTextInlineNode[]
}

interface RichTextListItemNode {
  type: 'listItem'
  content: RichTextBlockNode[]
}

interface RichTextBulletListNode {
  type: 'bulletList'
  content: RichTextListItemNode[]
}

interface RichTextOrderedListNode {
  type: 'orderedList'
  attrs?: {
    start?: number
  }
  content: RichTextListItemNode[]
}

interface RichTextBlockquoteNode {
  type: 'blockquote'
  content: RichTextBlockNode[]
}

interface RichTextCodeTextNode {
  type: 'text'
  text: string
}

interface RichTextCodeBlockNode {
  type: 'codeBlock'
  attrs?: {
    language?: string | null
  }
  content?: RichTextCodeTextNode[]
}

interface RichTextHorizontalRuleNode {
  type: 'horizontalRule'
}

interface RichTextRawHtmlNode {
  type: 'rawHtml'
  attrs: {
    html: string
  }
}

interface RichTextFormNode {
  type: 'form'
  attrs: {
    slug: string
  }
}

type RichTextBlockNode =
  | RichTextParagraphNode
  | RichTextHeadingNode
  | RichTextBulletListNode
  | RichTextOrderedListNode
  | RichTextBlockquoteNode
  | RichTextCodeBlockNode
  | RichTextHorizontalRuleNode
  | RichTextImageNode
  | RichTextRawHtmlNode
  | RichTextFormNode

const textNodeSchema = z.object({
  type: z.literal('text'),
  text: z.string().min(1),
  marks: z.array(richTextMarkSchema).optional(),
})

const hardBreakNodeSchema = z.object({ type: z.literal('hardBreak') })

const imageNodeSchema = z.object({
  type: z.literal('image'),
  attrs: z.object({
    src: z.string(),
    alt: z.string().nullable().optional(),
    title: z.string().nullable().optional(),
    width: z.number().int().positive().nullable().optional(),
    height: z.number().int().positive().nullable().optional(),
  }),
})

const inlineNodeSchema = z.discriminatedUnion('type', [
  textNodeSchema,
  hardBreakNodeSchema,
  imageNodeSchema,
])

const paragraphNodeSchema = z.object({
  type: z.literal('paragraph'),
  attrs: z
    .object({
      textAlign: z.enum(['left', 'center', 'right']).nullable().optional(),
    })
    .optional(),
  content: z.array(inlineNodeSchema).optional(),
})

const headingNodeSchema = z.object({
  type: z.literal('heading'),
  attrs: z.object({ level: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]) }),
  content: z.array(inlineNodeSchema).optional(),
})

let blockNodeSchema: z.ZodType<RichTextBlockNode>

const listItemNodeSchema = z.object({
  type: z.literal('listItem'),
  content: z.array(z.lazy(() => blockNodeSchema)),
})

const bulletListNodeSchema = z.object({
  type: z.literal('bulletList'),
  content: z.array(listItemNodeSchema),
})

const orderedListNodeSchema = z.object({
  type: z.literal('orderedList'),
  attrs: z.object({ start: z.number().int().optional() }).optional(),
  content: z.array(listItemNodeSchema),
})

const blockquoteNodeSchema = z.object({
  type: z.literal('blockquote'),
  content: z.array(z.lazy(() => blockNodeSchema)),
})

const codeBlockNodeSchema = z.object({
  type: z.literal('codeBlock'),
  attrs: z.object({ language: z.string().nullable().optional() }).optional(),
  content: z
    .array(
      z.object({
        type: z.literal('text'),
        text: z.string().min(1),
      }),
    )
    .optional(),
})

const horizontalRuleNodeSchema = z.object({ type: z.literal('horizontalRule') })

const rawHtmlNodeSchema = z.object({
  type: z.literal('rawHtml'),
  attrs: z.object({ html: z.string() }),
})

const formNodeSchema = z.object({
  type: z.literal('form'),
  attrs: z.object({ slug: slugSchema }),
})

blockNodeSchema = z.discriminatedUnion('type', [
  paragraphNodeSchema,
  headingNodeSchema,
  bulletListNodeSchema,
  orderedListNodeSchema,
  blockquoteNodeSchema,
  codeBlockNodeSchema,
  horizontalRuleNodeSchema,
  imageNodeSchema,
  rawHtmlNodeSchema,
  formNodeSchema,
])

export const richTextNodeSchema = z.discriminatedUnion('type', [
  textNodeSchema,
  hardBreakNodeSchema,
  paragraphNodeSchema,
  headingNodeSchema,
  bulletListNodeSchema,
  orderedListNodeSchema,
  listItemNodeSchema,
  blockquoteNodeSchema,
  codeBlockNodeSchema,
  horizontalRuleNodeSchema,
  imageNodeSchema,
  rawHtmlNodeSchema,
  formNodeSchema,
])
export type RichTextNode = z.infer<typeof richTextNodeSchema>

export const richTextDocSchema = z.object({
  type: z.literal('doc'),
  content: z.array(blockNodeSchema).default([]),
})
export type RichTextDoc = z.infer<typeof richTextDocSchema>
