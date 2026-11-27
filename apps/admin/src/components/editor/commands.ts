import type { Editor } from '@tiptap/react'

export function isAllowedLink(value: string): boolean {
  return /^(?:https?:\/\/|mailto:|tel:|\/|#)/i.test(value)
}

/** Only infer a scheme for a hostname. Keep paths, fragments and explicit schemes intact. */
export function normalizeLink(input: string): string | null {
  const value = input.trim()
  if (!value || isAllowedLink(value)) return value
  if (!/^[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)+(?::\d+)?(?:[/?#][^\s]*)?$/u.test(value)) return null
  const href = `https://${value}`
  return URL.canParse(href) ? href : null
}

export type EditorPanel = 'link' | 'image' | 'form'
type CommandGroup = 'style' | 'inline' | 'block' | 'insert' | 'history'
export type EditorCommand = {
  id: string
  label: string
  group: CommandGroup
  icon?: string
  shortcut?: string
  opensPicker?: boolean
  active?: (editor: Editor) => boolean
  enabled?: (editor: Editor) => boolean
  run: (editor: Editor, open: (panel: EditorPanel) => void) => void
}

export const commands: EditorCommand[] = [
  {
    id: 'paragraph',
    label: '段落',
    group: 'style',
    active: (e) => e.isActive('paragraph'),
    run: (e) => e.chain().focus().setParagraph().run(),
  },
  ...([2, 3, 4] as const).map((level) => ({
    id: `h${level}`,
    label: `見出し ${level}`,
    group: 'style' as const,
    active: (e: Editor) => e.isActive('heading', { level }),
    run: (e: Editor) => e.chain().focus().setHeading({ level }).run(),
  })),
  {
    id: 'bold',
    label: '太字',
    group: 'inline',
    shortcut: 'Ctrl/⌘+B',
    icon: 'M7 4h6a4 4 0 0 1 0 8H7Zm0 8h7a4 4 0 0 1 0 8H7Z',
    active: (e) => e.isActive('bold'),
    run: (e) => e.chain().focus().toggleBold().run(),
  },
  {
    id: 'italic',
    label: '斜体',
    group: 'inline',
    shortcut: 'Ctrl/⌘+I',
    icon: 'M11 4h8M5 20h8M15 4 9 20',
    active: (e) => e.isActive('italic'),
    run: (e) => e.chain().focus().toggleItalic().run(),
  },
  {
    id: 'underline',
    label: '下線',
    group: 'inline',
    shortcut: 'Ctrl/⌘+U',
    icon: 'M6 4v6a6 6 0 0 0 12 0V4M4 20h16',
    active: (e) => e.isActive('underline'),
    run: (e) => e.chain().focus().toggleUnderline().run(),
  },
  {
    id: 'strike',
    label: '打ち消し',
    group: 'inline',
    icon: 'M17 6c-3-4-11-3-11 1 0 2 2 3 4 4m3 2c3 1 5 2 5 4 0 4-9 5-12 0M3 12h18',
    active: (e) => e.isActive('strike'),
    run: (e) => e.chain().focus().toggleStrike().run(),
  },
  {
    id: 'code',
    label: 'コード',
    group: 'inline',
    icon: 'm8 7-5 5 5 5m8-10 5 5-5 5',
    active: (e) => e.isActive('code'),
    run: (e) => e.chain().focus().toggleCode().run(),
  },
  {
    id: 'link',
    label: 'リンク',
    shortcut: 'Ctrl/⌘+K',
    group: 'inline',
    icon: 'm10 14 4-4m-6 3-2 2a3 3 0 0 0 4 4l3-3m-2-8 3-3a3 3 0 0 1 5 5l-3 3',
    active: (e) => e.isActive('link'),
    run: (_, open) => open('link'),
  },
  {
    id: 'bulletList',
    label: '箇条書き',
    group: 'block',
    icon: 'M9 6h11M9 12h11M9 18h11M4 6h.5M4 12h.5M4 18h.5',
    active: (e) => e.isActive('bulletList'),
    run: (e) => e.chain().focus().toggleBulletList().run(),
  },
  {
    id: 'orderedList',
    label: '番号付き',
    group: 'block',
    icon: 'M10 7h10M10 17h10M3 5l2-1v5m-2 5q1-2 3 0c1 2-3 3-3 5h4',
    active: (e) => e.isActive('orderedList'),
    run: (e) => e.chain().focus().toggleOrderedList().run(),
  },
  {
    id: 'blockquote',
    label: '引用',
    group: 'block',
    icon: 'M9 5C5 7 4 10 4 13v4h6v-6H6m13-6c-4 2-5 5-5 8v4h6v-6h-4',
    active: (e) => e.isActive('blockquote'),
    run: (e) => e.chain().focus().toggleBlockquote().run(),
  },
  {
    id: 'codeBlock',
    label: 'コードブロック',
    group: 'block',
    icon: 'M3 4h18v16H3Zm6 5-3 3 3 3m6-6 3 3-3 3',
    active: (e) => e.isActive('codeBlock'),
    run: (e) => e.chain().focus().toggleCodeBlock().run(),
  },
  {
    id: 'horizontalRule',
    label: '区切り線',
    group: 'insert',
    icon: 'M3 12h18',
    run: (e) => e.chain().focus().setHorizontalRule().run(),
  },
  {
    id: 'image',
    opensPicker: true,
    label: '画像',
    group: 'insert',
    icon: 'M3 4h18v16H3Zm0 12 5-5 4 4 3-3 6 6M15 8h1',
    run: (_, open) => open('image'),
  },
  {
    id: 'form',
    opensPicker: true,
    label: 'フォーム',
    group: 'insert',
    icon: 'M4 3h16v18H4Zm4 5h8m-8 4h8m-8 4h3',
    run: (_, open) => open('form'),
  },
  {
    id: 'rawHtml',
    label: 'HTML ブロック',
    group: 'insert',
    icon: 'm7 8-4 4 4 4m10-8 4 4-4 4m-4-12-3 16',
    run: (e) =>
      e
        .chain()
        .focus()
        .insertContent({ type: 'rawHtml', attrs: { html: '' } })
        .run(),
  },
  {
    id: 'undo',
    label: '元に戻す',
    group: 'history',
    shortcut: 'Ctrl/⌘+Z',
    icon: 'm8 5-5 5 5 5m-5-5h11a6 6 0 0 1 0 12',
    enabled: (e) => e.can().undo(),
    run: (e) => e.chain().focus().undo().run(),
  },
  {
    id: 'redo',
    label: 'やり直す',
    group: 'history',
    shortcut: 'Ctrl/⌘+Shift+Z',
    icon: 'm16 5 5 5-5 5m5-5H10a6 6 0 0 0 0 12',
    enabled: (e) => e.can().redo(),
    run: (e) => e.chain().focus().redo().run(),
  },
]
