import { type ThemeName, themeNameSchema } from '@kanso/shared'
import { defaultTheme } from './default/index.ts'
import { paperTheme } from './paper/index.ts'
import type { Theme } from './types.ts'

export const themes: Record<ThemeName, Theme> = { default: defaultTheme, paper: paperTheme }

export function resolveTheme(name: string | undefined): Theme {
  const result = themeNameSchema.safeParse(name)
  return result.success ? themes[result.data] : themes.default
}
