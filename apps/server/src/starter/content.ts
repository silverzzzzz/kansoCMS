import type {
  createCategorySchema,
  createFormSchema,
  createPageSchema,
  createPostSchema,
  createPostTypeSchema,
  PageSection,
  RichTextDoc,
  RichTextMark,
} from '@kanso/shared'
import type { z } from 'zod'

/**
 * The starter site: a neutral template for a small company or shop. Copy is
 * written to be replaced, and it points at the admin screen that edits each
 * part. Kept as data (no JSX) so the management API can import it.
 */

export const STARTER_IMAGES = [
  { name: 'hero.webp', alt: '緑のグラデーションに同心円を重ねたサンプル画像' },
  { name: 'about.webp', alt: '淡いベージュに丸い図形を重ねたサンプル画像' },
  { name: 'service-a.webp', alt: '青緑のグラデーションに点を並べたサンプル画像' },
  { name: 'service-b.webp', alt: '砂色のグラデーションに波線を重ねたサンプル画像' },
  { name: 'news-1.webp', alt: '深い緑に同心円を重ねたサンプル画像' },
  { name: 'news-2.webp', alt: '灰緑のグラデーションに点を並べたサンプル画像' },
  { name: 'news-3.webp', alt: 'テラコッタ色に丸い図形を重ねたサンプル画像' },
] as const

export type StarterImageName = (typeof STARTER_IMAGES)[number]['name']
export type StarterMedia = Record<StarterImageName, { id: number; url: string }>

/** Post type every starter post belongs to; the home page lists it. */
export const STARTER_POST_TYPE_SLUG = 'news'
export const STARTER_FORM_SLUG = 'contact'

type CategoryKey = 'info' | 'event'

export interface StarterPost {
  category: CategoryKey
  input: Omit<z.input<typeof createPostSchema>, 'postTypeId' | 'categoryIds' | 'tagIds'>
}

export interface StarterContent {
  form: z.input<typeof createFormSchema>
  postType: z.input<typeof createPostTypeSchema>
  categories: { key: CategoryKey; input: z.input<typeof createCategorySchema> }[]
  posts: StarterPost[]
  /** In creation order; the home page goes last so everything it links to exists. */
  pages: z.input<typeof createPageSchema>[]
  /** Values for the active theme's settings namespace. */
  themeSettings: Record<string, unknown>
  siteDescription: string
}

export interface StarterContentInput {
  siteTitle: string
  media: StarterMedia
  now: Date
}

const DAY_MS = 24 * 60 * 60 * 1000

type BlockNode = RichTextDoc['content'][number]
type InlineNode = NonNullable<Extract<BlockNode, { type: 'paragraph' }>['content']>[number]

function text(value: string, marks?: RichTextMark[]): InlineNode {
  return marks ? { type: 'text', text: value, marks } : { type: 'text', text: value }
}

function paragraph(...content: (string | InlineNode)[]): BlockNode {
  return {
    type: 'paragraph',
    content: content.map((part) => (typeof part === 'string' ? text(part) : part)),
  }
}

function heading(level: 2 | 3, value: string): BlockNode {
  return { type: 'heading', attrs: { level }, content: [text(value)] }
}

function bulletList(items: string[]): BlockNode {
  return {
    type: 'bulletList',
    content: items.map((item) => ({ type: 'listItem', content: [paragraph(item)] })),
  }
}

function link(value: string, href: string): InlineNode {
  return text(value, [{ type: 'link', attrs: { href } }])
}

function doc(...content: BlockNode[]): RichTextDoc {
  return { type: 'doc', content }
}

function altOf(name: StarterImageName): string {
  return STARTER_IMAGES.find((image) => image.name === name)?.alt ?? ''
}

export function starterContent({ siteTitle, media, now }: StarterContentInput): StarterContent {
  const daysAgo = (days: number) => new Date(now.getTime() - days * DAY_MS).toISOString()

  const homeSections: PageSection[] = [
    {
      id: 'hero',
      type: 'hero',
      settings: {
        heading: siteTitle,
        text: 'ここにお店や会社の紹介文を一、二文で書きます。このトップページは管理画面の「カスタマイズ」で、文章・画像・ボタン、セクションの並び順まで自由に変更できます。',
        image: media['hero.webp'].id,
        button_label: 'お問い合わせ',
        button_url: '/contact',
      },
    },
    {
      id: 'about',
      type: 'image_with_text',
      settings: {
        image: media['about.webp'].id,
        heading: '私たちについて',
        body: '大切にしている考え方や、お客様に届けたい価値を紹介するセクションです。\n\n創業のきっかけや代表のメッセージなど、詳しい内容は「会社概要」ページにまとめましょう。',
        reverse: false,
      },
    },
    {
      id: 'services',
      type: 'image_with_text',
      settings: {
        image: media['service-a.webp'].id,
        heading: 'サービス',
        body: '提供しているサービスや商品を、ひと目で伝わるように紹介します。\n\n詳しくは「サービス」ページへ。サービスページもセクションで組まれているので、このページと同じように編集できます。',
        reverse: true,
      },
    },
    {
      id: 'news',
      type: 'post_list',
      settings: {
        heading: 'お知らせ',
        source: { postTypeSlug: STARTER_POST_TYPE_SLUG, limit: 3 },
      },
    },
    {
      id: 'contact',
      type: 'cta',
      settings: {
        heading: 'お気軽にご相談ください',
        button_label: 'お問い合わせはこちら',
        button_url: '/contact',
      },
    },
  ]

  const servicesSections: PageSection[] = [
    {
      id: 'intro',
      type: 'hero',
      settings: {
        heading: 'サービス',
        text: `${siteTitle} が提供しているサービスをご紹介します。このページもセクションで構成されています。「カスタマイズ」でページを「サービス」に切り替えると、セクションの追加・並べ替え・削除ができます。`,
      },
    },
    {
      id: 'service_a',
      type: 'image_with_text',
      settings: {
        image: media['service-a.webp'].id,
        heading: 'サービス A',
        body: 'サービスの特徴と、お客様にとってのメリットを書きます。\n\n料金の目安や所要時間、ご依頼の流れを添えると、お問い合わせのきっかけになります。',
        reverse: false,
      },
    },
    {
      id: 'service_b',
      type: 'image_with_text',
      settings: {
        image: media['service-b.webp'].id,
        heading: 'サービス B',
        body: '2 つ目のサービスです。画像を右に置くと、縦に並べたときにリズムが生まれます。\n\nセクションが足りなければ「追加」から増やし、不要なら削除してください。',
        reverse: true,
      },
    },
    {
      id: 'contact',
      type: 'cta',
      settings: {
        heading: 'サービスについてのご相談はこちら',
        button_label: 'お問い合わせ',
        button_url: '/contact',
      },
    },
  ]

  return {
    form: {
      slug: STARTER_FORM_SLUG,
      name: 'お問い合わせ',
      fields: [
        { type: 'text', name: 'name', label: 'お名前', required: true, maxLength: 100 },
        { type: 'email', name: 'email', label: 'メールアドレス', required: true },
        {
          type: 'select',
          name: 'topic',
          label: 'ご用件',
          options: [
            { value: 'consultation', label: 'ご相談' },
            { value: 'estimate', label: 'お見積もり' },
            { value: 'other', label: 'その他' },
          ],
        },
        {
          type: 'textarea',
          name: 'message',
          label: 'お問い合わせ内容',
          required: true,
          rows: 6,
        },
      ],
      successMessage:
        'お問い合わせありがとうございます。内容を確認のうえ、担当者よりご連絡いたします。',
    },

    postType: {
      slug: STARTER_POST_TYPE_SLUG,
      name: 'お知らせ',
      description: '新しいサービスやイベントのご案内、営業に関するお知らせを掲載しています。',
      hasCategories: true,
      hasTags: false,
      sortOrder: 0,
    },
    categories: [
      { key: 'info', input: { slug: 'info', name: 'お知らせ', sortOrder: 0 } },
      { key: 'event', input: { slug: 'event', name: 'イベント', sortOrder: 1 } },
    ],

    posts: [
      {
        category: 'info',
        input: {
          title: 'ウェブサイトを公開しました',
          slug: 'website-launch',
          status: 'published',
          publishedAt: daysAgo(2),
          coverMediaId: media['news-1.webp'].id,
          bodyJson: doc(
            paragraph(`${siteTitle} のウェブサイトを公開しました。`),
            paragraph(
              'これからこのページで、新しいサービスやイベントのご案内、営業日のお知らせなどをお届けしていきます。今後ともよろしくお願いいたします。',
            ),
            paragraph('（この記事はサンプルです。管理画面の「お知らせ」から編集・削除できます。）'),
          ),
        },
      },
      {
        category: 'event',
        input: {
          title: 'ワークショップを開催します',
          slug: 'workshop',
          status: 'published',
          publishedAt: daysAgo(1),
          coverMediaId: media['news-2.webp'].id,
          bodyJson: doc(
            paragraph(
              'はじめての方向けのワークショップを開催します。少人数制なので、気軽にご参加ください。',
            ),
            heading(2, '開催概要'),
            bulletList([
              '日時：〇月〇日（土）14:00〜16:00（サンプル）',
              '会場：本社セミナールーム（サンプル）',
              '参加費：無料',
              '定員：10 名（先着順）',
            ]),
            paragraph(
              'お申し込みは',
              link('お問い合わせ', '/contact'),
              'のフォームから、ご用件に「その他」を選んでお送りください。',
            ),
          ),
        },
      },
      {
        category: 'info',
        input: {
          title: 'サイトの編集方法',
          slug: 'how-to-edit',
          status: 'published',
          publishedAt: now.toISOString(),
          coverMediaId: media['news-3.webp'].id,
          bodyJson: doc(
            paragraph(
              'このサイトは kansoCMS のサンプルです。管理画面にログインすると、次の場所で内容を編集できます。',
            ),
            heading(2, 'トップページとサービスページ'),
            paragraph(
              '「カスタマイズ」でページを選ぶと、セクションの追加・並べ替え・削除や、見出し・文章・画像の変更ができます。右側のプレビューで仕上がりを確かめてから保存してください。',
            ),
            heading(2, '色とフッター'),
            paragraph(
              '「カスタマイズ」の「テーマ設定」タブで、アクセントカラー、フッターの文言、SNS へのリンクを変更できます。',
            ),
            heading(2, '会社概要などの文章ページ'),
            paragraph('「固定ページ」で、この記事と同じエディタを使って本文を書き換えられます。'),
            heading(2, 'お知らせ'),
            paragraph(
              '「お知らせ」で記事を追加・編集できます。新しい記事は、トップページの「お知らせ」欄にも自動で並びます。',
            ),
            heading(2, 'お問い合わせフォーム'),
            paragraph('「フォーム」で入力項目を変更でき、届いた内容も同じ画面で確認できます。'),
            heading(2, 'サンプルが不要になったら'),
            paragraph(
              '「設定」の「サンプルサイト」から、まだ編集していないサンプルをまとめて削除できます。編集したページや記事は残ります。',
            ),
          ),
        },
      },
    ],

    pages: [
      {
        title: 'お問い合わせ',
        slug: 'contact',
        status: 'published',
        sortOrder: 3,
        bodyJson: doc(
          paragraph(
            'ご相談・お見積もりなど、お気軽にお問い合わせください。内容を確認のうえ、担当者よりご連絡いたします。',
          ),
          { type: 'form', attrs: { slug: STARTER_FORM_SLUG } },
          paragraph(
            '通常 2 営業日以内にご返信します（サンプル）。入力項目は管理画面の「フォーム」で変更でき、通知メールの宛先は「設定」で指定できます。',
          ),
        ),
      },
      {
        title: '会社概要',
        slug: 'about',
        status: 'published',
        sortOrder: 1,
        bodyJson: doc(
          heading(2, 'ごあいさつ'),
          paragraph(`${siteTitle} のウェブサイトをご覧いただき、ありがとうございます。`),
          paragraph(
            'このページはサンプルです。会社やお店の成り立ち、大切にしていること、お客様へのメッセージなどに書き換えてください。本文は管理画面の「固定ページ」から、ブログと同じエディタで編集できます。',
          ),
          {
            type: 'image',
            attrs: { src: media['about.webp'].url, alt: altOf('about.webp') },
          },
          heading(2, '会社情報'),
          bulletList([
            `名称：${siteTitle}`,
            '所在地：〒000-0000 東京都千代田区サンプル町 1-2-3（サンプル）',
            '営業時間：10:00〜18:00（サンプル）',
            '定休日：土曜・日曜・祝日（サンプル）',
            '電話番号：00-0000-0000（サンプル）',
          ]),
          paragraph('※ 住所や電話番号はサンプルです。公開前に実際の情報に書き換えてください。'),
        ),
      },
      {
        title: 'サービス',
        slug: 'services',
        status: 'published',
        sortOrder: 2,
        sections: servicesSections,
      },
      {
        title: 'ホーム',
        slug: 'home',
        status: 'published',
        sortOrder: 0,
        sections: homeSections,
      },
    ],

    themeSettings: {
      accent: '#2f6f5e',
      footer_text:
        'このサイトはサンプルです。フッターの文言は「カスタマイズ」の「テーマ設定」で変更できます。',
    },
    siteDescription: `${siteTitle} の公式ウェブサイトです。サービスのご案内やお知らせを掲載しています。`,
  }
}
