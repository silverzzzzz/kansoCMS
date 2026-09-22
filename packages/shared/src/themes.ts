import { z } from 'zod'

export const THEME_NAMES = ['default', 'paper'] as const
export type ThemeName = (typeof THEME_NAMES)[number]
export const themeNameSchema = z.enum(THEME_NAMES)
export const THEMES: Record<ThemeName, { label: string; description: string }> = {
  default: {
    label: 'Default',
    description: 'Sans-serif, left-aligned header, light/dark',
  },
  paper: {
    label: 'Paper',
    description: 'Serif, centered masthead, warm paper background',
  },
}
