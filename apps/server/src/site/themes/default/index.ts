import type { Theme } from '../types.ts'
import { Layout } from './layout.tsx'
import { PostArticle } from './post.tsx'
import { PostList } from './post-list.tsx'

export const defaultTheme: Theme = { name: 'default', Layout, PostList, PostArticle }
