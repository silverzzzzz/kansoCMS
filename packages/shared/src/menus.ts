import { z } from 'zod'
import { slugSchema } from './slug.ts'

/** Relative path, anchor or absolute http(s) URL. */
export const menuHrefSchema = z
  .string()
  .trim()
  .min(1)
  .max(500)
  .refine(
    (href) => href.startsWith('/') || href.startsWith('#') || /^https?:\/\//i.test(href),
    'Use a path (/…), an anchor (#…) or an http(s) URL',
  )

const menuItemBase = z.object({
  label: z.string().trim().min(1).max(100),
  href: menuHrefSchema,
})

export const menuItemSchema = menuItemBase.extend({
  children: z.array(menuItemBase).max(20).default([]),
})

export const menuItemsSchema = z.array(menuItemSchema).max(50)

export const menuFieldsSchema = z.object({
  slug: slugSchema,
  name: z.string().trim().min(1).max(100),
  items: menuItemsSchema,
})

export const createMenuSchema = menuFieldsSchema.partial().required({ slug: true, name: true })
export const updateMenuSchema = menuFieldsSchema.partial()

export type MenuItem = z.infer<typeof menuItemSchema>
export type MenuFields = z.infer<typeof menuFieldsSchema>
export type CreateMenuInput = z.infer<typeof createMenuSchema>
export type UpdateMenuInput = z.infer<typeof updateMenuSchema>

/** Menu slug rendered as the site header navigation. */
export const HEADER_MENU_SLUG = 'header'
