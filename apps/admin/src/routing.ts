const adminBasepath = '/admin'

export function toAdminHref(value: string): string {
  const parsed = new URL(value, 'http://kanso.local')
  const suffix = `${parsed.search}${parsed.hash}`

  if (parsed.pathname === adminBasepath || parsed.pathname.startsWith(`${adminBasepath}/`)) {
    return `${parsed.pathname}${suffix}`
  }
  if (parsed.pathname.startsWith('/') && !parsed.pathname.startsWith('//')) {
    return `${adminBasepath}${parsed.pathname}${suffix}`
  }
  return `${adminBasepath}/`
}

export function safeAdminRedirect(value: string | undefined): string {
  if (!value) return `${adminBasepath}/`

  try {
    const parsed = new URL(value, window.location.origin)
    const isAdminPath =
      parsed.pathname === adminBasepath || parsed.pathname.startsWith(`${adminBasepath}/`)
    const isAuthPath =
      parsed.pathname === `${adminBasepath}/login` || parsed.pathname === `${adminBasepath}/setup`

    if (parsed.origin !== window.location.origin || !isAdminPath || isAuthPath) {
      return `${adminBasepath}/`
    }
    return `${parsed.pathname}${parsed.search}${parsed.hash}`
  } catch {
    return `${adminBasepath}/`
  }
}
