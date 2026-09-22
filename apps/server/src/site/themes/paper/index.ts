import { PostArticle } from '../default/post.tsx'
import { PostList } from '../default/post-list.tsx'
import type { Theme } from '../types.ts'
import { PaperLayout } from './layout.tsx'

export const paperTheme: Theme = { name: 'paper', Layout: PaperLayout, PostList, PostArticle }
