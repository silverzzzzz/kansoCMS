import { DEFAULT_SUBMISSION_MESSAGES, type SubmissionMessages } from '@kanso/shared'

export type SiteMessages = {
  notFound: { title: string; body: string }
  home: { running: string; hintBefore: string; hintAfter: string }
  archive: {
    categoryHeading: (term: string, type: string) => string
    tagHeading: (term: string, type: string) => string
  }
  pagination: { newer: string; older: string }
  search: {
    title: string
    label: string
    placeholder: string
    button: string
    resultCount: (n: number) => string
    noResults: string
    kindPage: string
  }
  form: {
    submit: string
    selectPlaceholder: string
    honeypotLabel: string
    successDefault: string
    genericError: string
    turnstileFailed: string
    turnstileUnconfigured: string
  }
  validation: SubmissionMessages
}

export const en: SiteMessages = {
  search: {
    title: 'Search',
    label: 'Search this site',
    placeholder: 'Search…',
    button: 'Search',
    resultCount: (n) => `${n} results`,
    noResults: 'No results.',
    kindPage: 'Page',
  },
  notFound: { title: 'Not Found', body: 'Page not found.' },
  home: {
    running: 'kansoCMS is running.',
    hintBefore: 'Create a page with the path ',
    hintAfter: ' to replace this.',
  },
  archive: {
    categoryHeading: (term, type) => `${term} – ${type}`,
    tagHeading: (term, type) => `#${term} – ${type}`,
  },
  pagination: { newer: 'Newer posts', older: 'Older posts' },
  form: {
    submit: 'Send',
    selectPlaceholder: '— Select —',
    honeypotLabel: 'Leave this field empty',
    successDefault: 'Thank you. Your message has been sent.',
    genericError: 'Invalid submission',
    turnstileFailed: 'Turnstile verification failed',
    turnstileUnconfigured: 'Turnstile is not configured',
  },
  validation: DEFAULT_SUBMISSION_MESSAGES,
}

export const ja: SiteMessages = {
  search: {
    title: '検索',
    label: 'サイト内検索',
    placeholder: '検索…',
    button: '検索',
    resultCount: (n) => `${n} 件`,
    noResults: '該当する結果はありません。',
    kindPage: 'ページ',
  },
  notFound: {
    title: 'ページが見つかりません',
    body: 'お探しのページは見つかりませんでした。',
  },
  home: {
    running: 'kansoCMS は動作しています。',
    hintBefore: 'パス ',
    hintAfter: ' のページを作成すると、この画面が置き換わります。',
  },
  archive: {
    categoryHeading: (term, type) => `${term} – ${type}`,
    tagHeading: (term, type) => `#${term} – ${type}`,
  },
  pagination: { newer: '新しい投稿', older: '古い投稿' },
  form: {
    submit: '送信',
    selectPlaceholder: '— 選択してください —',
    honeypotLabel: 'この欄は空のままにしてください',
    successDefault: 'お問い合わせありがとうございます。送信が完了しました。',
    genericError: '入力内容に誤りがあります。',
    turnstileFailed: 'Turnstile の認証に失敗しました。もう一度お試しください。',
    turnstileUnconfigured: 'Turnstile が設定されていません。',
  },
  validation: {
    required: '必須項目です',
    maxLength: (n) => `${n} 文字以内で入力してください`,
    email: 'メールアドレスの形式が正しくありません',
    tel: '電話番号の形式が正しくありません',
    select: '選択肢から選んでください',
  },
}

export function resolveMessages(locale: string): SiteMessages {
  try {
    const canonical = Intl.getCanonicalLocales(locale)[0]
    const primary = canonical?.split('-')[0]?.toLowerCase()
    return primary === 'ja' ? ja : en
  } catch {
    return en
  }
}
