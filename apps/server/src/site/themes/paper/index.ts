import { PostArticle } from '../default/post.tsx'
import { PostList } from '../default/post-list.tsx'
import { standardSections } from '../sections.tsx'
import { standardThemeSettingsFields } from '../sections-meta.ts'
import type { Theme } from '../types.ts'
import { PaperLayout } from './layout.tsx'

export const paperTheme: Theme = {
  name: 'paper',
  Layout: PaperLayout,
  PostList,
  PostArticle,
  sections: standardSections,
  settingsFields: standardThemeSettingsFields,
}
