import { describe, expect, it } from 'vitest'
import {
  generateReadme,
  rewriteRootPackage,
  rewriteServerPackage,
  rewriteWrangler,
} from './rewrite.js'

const project = {
  name: 'my-site',
  d1: 'site-db',
  r2: 'site-media',
  siteUrl: 'https://example.test/?x=$&',
}
const wrangler = `{
  "name": "kanso",
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "kanso",
      // Replace with the id printed by \`wrangler d1 create kanso\`.
      "database_id": "00000000-0000-0000-0000-000000000000"
    }
  ],
  "r2_buckets": [
    {
      "binding": "MEDIA",
      "bucket_name": "kanso-media"
    }
  ],
  "send_email": [{ "name": "EMAIL" }],
  "vars": {
    // Absolute origin used for canonical URLs, sitemap and JSON-LD.
    "SITE_URL": "http://localhost:5173"
  }
}`

describe('project rewrites', () => {
  it('changes exactly the four JSONC values while preserving comments and database_id', () => {
    /** @type {string[]} */
    const warnings = []
    const result = rewriteWrangler(wrangler, project, (message) => warnings.push(message))
    expect(result).toBe(
      wrangler
        .replace('"name": "kanso"', '"name": "my-site"')
        .replace('"database_name": "kanso"', '"database_name": "site-db"')
        .replace('"bucket_name": "kanso-media"', '"bucket_name": "site-media"')
        .replace('"http://localhost:5173"', () => JSON.stringify(project.siteUrl)),
    )
    expect(warnings).toEqual([])
  })
  it('changes only migration scripts in the server package', () => {
    const source = `{
  "name": "@kanso/server",
  "scripts": {
    "db:migrate:local": "wrangler d1 migrations apply kanso --local",
    "db:migrate": "wrangler d1 migrations apply kanso --remote"
  }
}`
    expect(rewriteServerPackage(source, project, () => {})).toBe(
      source.replaceAll('apply kanso', 'apply site-db'),
    )
  })
  it('changes the root package name only', () => {
    const source = '{\n  "name": "kanso-cms",\n  "private": true\n}\n'
    expect(rewriteRootPackage(source, project, () => {})).toBe(
      source.replace('kanso-cms', 'my-site'),
    )
  })
  it('generates the project README with resource instructions and links', () => {
    const result = generateReadme(project)
    for (const text of [
      '# my-site',
      'pnpm install',
      'wrangler d1 create site-db',
      'database_id',
      'wrangler r2 bucket create site-media',
      'pnpm db:migrate:local',
      'pnpm dev',
      '/admin/setup',
      'SITE_URL',
      'pnpm db:migrate',
      'pnpm deploy',
      'docs/architecture.md',
      'https://github.com/silverzzzzz/kansoCMS',
    ]) {
      expect(result).toContain(text)
    }
  })
  it('warns for every missing pattern and preserves unmatched content', () => {
    /** @type {string[]} */
    const warnings = []
    for (const rewrite of [rewriteWrangler, rewriteServerPackage, rewriteRootPackage]) {
      expect(rewrite('{}', project, (message) => warnings.push(message))).toBe('{}')
    }
    expect(warnings).toHaveLength(7)
    expect(warnings.every((message) => message.includes('edit it manually'))).toBe(true)
  })
})
