import { describe, expect, it } from 'vitest'
import { postTypeInsertValues } from './post-types.ts'

describe('postTypeInsertValues', () => {
  it('defaults archive noindex to off and keeps explicit values', () => {
    expect(postTypeInsertValues({ slug: 'blog', name: 'Blog' }).noindex).toBe(false)
    expect(postTypeInsertValues({ slug: 'blog', name: 'Blog', noindex: true }).noindex).toBe(true)
  })

  it('persists custom field definitions to fields_json', () => {
    const fields = [{ type: 'text' as const, name: 'venue', label: '会場', maxLength: 200 }]
    expect(postTypeInsertValues({ slug: 'blog', name: 'Blog' }).fieldsJson).toBeNull()
    expect(postTypeInsertValues({ slug: 'blog', name: 'Blog', fields }).fieldsJson).toEqual(fields)
  })
})
