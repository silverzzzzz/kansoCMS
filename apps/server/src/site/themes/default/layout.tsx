import type { PageMeta } from '@kanso/seo'
import { raw } from 'hono/html'
import type { Child } from 'hono/jsx'
import { Head } from '../../head.tsx'

export interface NavItem {
  label: string
  href: string
}

export interface LayoutProps {
  meta: PageMeta
  jsonLd?: unknown[]
  nav: NavItem[]
  children: Child
}

/**
 * Default theme shell. Zero client-side JavaScript; styling comes from
 * /theme.css in apps/server/public. Fork this directory to make a theme.
 */
export function Layout({ meta, jsonLd, nav, children }: LayoutProps) {
  return (
    <>
      {raw('<!DOCTYPE html>')}
      <html lang={meta.locale}>
        <head>
          <Head meta={meta} jsonLd={jsonLd} />
          <link rel="stylesheet" href="/theme.css" />
        </head>
        <body>
          <header class="site-header">
            <a class="site-title" href="/">
              {meta.siteName}
            </a>
            <nav class="site-nav">
              {nav.map((item) => (
                <a href={item.href}>{item.label}</a>
              ))}
            </nav>
          </header>
          <main class="site-main">{children}</main>
          <footer class="site-footer">
            <small>
              © {new Date().getFullYear()} {meta.siteName}
            </small>
          </footer>
        </body>
      </html>
    </>
  )
}
