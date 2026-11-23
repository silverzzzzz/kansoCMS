import { SETUP_TOKEN_MIN_LENGTH } from '@kanso/shared'
import { useMutation, useQuery } from '@tanstack/react-query'
import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router'
import type { FormEvent } from 'react'
import { useEffect, useState } from 'react'
import { api } from '../api/client.ts'
import { ApiError } from '../api/errors.ts'
import { meQueryOptions, setupStatusQueryOptions } from '../api/queries.ts'
import { unwrap } from '../api/request.ts'
import { BrandLogo } from '../components/BrandLogo.tsx'
import {
  createPasskey,
  defaultPasskeyName,
  passkeyErrorMessage,
  passkeysSupported,
} from '../lib/passkey.ts'
import { setupTokenHeaders, tokenFromHash } from '../lib/setup-token.ts'

type SetupInput = {
  siteTitle?: string
  name: string
  email: string
  starter: boolean
  token: string
}

export const Route = createFileRoute('/setup')({
  beforeLoad: async ({ context }) => {
    const setupStatus = await context.queryClient.fetchQuery(setupStatusQueryOptions)
    if (!setupStatus.needed) throw redirect({ to: '/login' })
  },
  component: SetupPage,
})

function SetupPage() {
  const navigate = useNavigate({ from: '/setup' })
  const { queryClient } = Route.useRouteContext()
  const supported = passkeysSupported()
  const tokenState = useQuery(setupStatusQueryOptions).data?.token ?? 'off'
  // A link from `pnpm setup:token` carries the token in the fragment. Keep it
  // for the form and take it out of the address bar and the history entry.
  // Opening the link in a tab already on this page only changes the fragment,
  // so `hashchange` is handled as well as the first render.
  const [linkToken, setLinkToken] = useState(() => tokenFromHash(window.location.hash))
  useEffect(() => {
    function takeToken() {
      if (!window.location.hash) return
      const token = tokenFromHash(window.location.hash)
      if (token) setLinkToken(token)
      const { pathname, search } = window.location
      window.history.replaceState(window.history.state, '', `${pathname}${search}`)
    }
    takeToken()
    window.addEventListener('hashchange', takeToken)
    return () => window.removeEventListener('hashchange', takeToken)
  }, [])
  // Setup still succeeds when the starter site fails; say so before moving on.
  const [starterError, setStarterError] = useState<string | null>(null)
  const setup = useMutation({
    // The admin is created only after the passkey exists, so cancelling the
    // browser dialog leaves setup untouched and the form can be sent again.
    mutationFn: async ({ token, ...input }: SetupInput) => {
      const tokenOptions = setupTokenHeaders(token)
      const { options } = await unwrap(api.setup.options.$post({ json: input }, tokenOptions))
      const credential = await createPasskey(options)
      return unwrap(
        api.setup.$post({ json: { credential, passkeyName: defaultPasskeyName() } }, tokenOptions),
      )
    },
    onSuccess: async (data) => {
      queryClient.setQueryData(meQueryOptions.queryKey, data.user)
      queryClient.setQueryData(setupStatusQueryOptions.queryKey, { needed: false, token: 'off' })
      if (data.starter && !data.starter.installed) {
        setStarterError(data.starter.error ?? '原因不明のエラー')
        return
      }
      await navigate({ to: '/' })
    },
  })

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const siteTitle = String(form.get('siteTitle') ?? '').trim()
    setup.mutate({
      siteTitle: siteTitle || undefined,
      name: String(form.get('name') ?? '').trim(),
      email: String(form.get('email') ?? '').trim(),
      starter: form.get('starter') === 'on',
      token: String(form.get('setupToken') ?? ''),
    })
  }

  // Validation errors come back in English from the API; everything else is a
  // passkey ceremony failure with its own Japanese message.
  const status = setup.error instanceof ApiError ? setup.error.status : null
  const error = setup.error
    ? status === 400
      ? '入力内容を確認してください。'
      : status === 403
        ? 'セットアップトークンが正しくありません。'
        : status === 409
          ? 'セットアップはすでに完了しています。ログイン画面からログインしてください。'
          : passkeyErrorMessage(setup.error)
    : null

  if (tokenState === 'unset') {
    return (
      <main className="flex min-h-screen items-center justify-center bg-neutral-100 px-5 py-12 text-neutral-950">
        <section className="w-full max-w-md border border-neutral-200 bg-white p-6 shadow-sm sm:p-8">
          <BrandLogo />
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">
            セットアップはロックされています
          </h1>
          <p className="mt-4 text-sm leading-6 text-neutral-700">
            ほかの人に最初の管理者を作られないよう、公開したサイトのセットアップにはセットアップトークンが必要です。Cloudflare
            にログインできる人が、サイトのリポジトリで次のコマンドを実行し、表示されたリンクを開いてください。
          </p>
          <pre className="mt-4 overflow-x-auto bg-neutral-100 p-3 text-xs text-neutral-900">
            pnpm setup:token --url {window.location.origin}
          </pre>
          <p className="mt-4 text-xs leading-5 text-neutral-600">
            自分で決めた値を使う場合は、{SETUP_TOKEN_MIN_LENGTH} 文字以上の値を
            <code className="mx-1">wrangler secret put SETUP_TOKEN</code>
            で設定してから、このページを再読み込みしてください。
          </p>
        </section>
      </main>
    )
  }

  if (starterError !== null) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-neutral-100 px-5 py-12 text-neutral-950">
        <section className="w-full max-w-md border border-neutral-200 bg-white p-6 shadow-sm sm:p-8">
          <BrandLogo />
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">セットアップが完了しました</h1>
          <p role="alert" className="mt-4 border-l-2 border-red-600 pl-3 text-sm text-red-700">
            サンプルサイトは作成できませんでした ({starterError}
            )。管理画面の「設定」→「サンプルサイト」からもう一度お試しください。
          </p>
          <button
            type="button"
            onClick={() => navigate({ to: '/' })}
            className="mt-8 w-full bg-neutral-950 px-4 py-2.5 text-sm font-medium text-white outline-none hover:bg-neutral-800 focus-visible:ring-2 focus-visible:ring-neutral-950 focus-visible:ring-offset-2"
          >
            管理画面へ進む
          </button>
        </section>
      </main>
    )
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-neutral-100 px-5 py-12 text-neutral-950">
      <section className="w-full max-w-md border border-neutral-200 bg-white p-6 shadow-sm sm:p-8">
        <BrandLogo />
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">サイトをセットアップ</h1>
        <p className="mt-2 text-sm leading-6 text-neutral-600">
          サイト名と最初の管理者アカウントを登録します。ログインにはパスワードではなく、この端末に保存するパスキー
          (指紋・顔認証・PIN で使う鍵) を使います。
        </p>
        {!supported && (
          <p role="alert" className="mt-4 border-l-2 border-red-600 pl-3 text-sm text-red-700">
            このブラウザはパスキーに対応していません。最新の Chrome、Edge、Safari、Firefox
            でセットアップしてください。
          </p>
        )}

        <form className="mt-8 space-y-5" onSubmit={handleSubmit}>
          {tokenState === 'required' && (
            <div>
              <Field
                // A new link token replaces whatever was typed.
                key={linkToken}
                label="セットアップトークン"
                name="setupToken"
                autoComplete="off"
                defaultValue={linkToken}
                spellCheck={false}
                required
              />
              <p className="mt-1 text-xs leading-5 text-neutral-600">
                <code>pnpm setup:token</code>{' '}
                が表示した値です。表示されたリンクから開いた場合は入力済みです。
              </p>
            </div>
          )}
          <Field label="サイト名" name="siteTitle" autoComplete="organization" maxLength={120} />
          <Field label="名前" name="name" autoComplete="name" maxLength={100} required />
          <Field label="メールアドレス" name="email" type="email" autoComplete="email" required />
          <label className="flex items-start gap-3 border border-neutral-200 bg-neutral-50 p-3 text-sm text-neutral-800">
            <input type="checkbox" name="starter" defaultChecked className="mt-1 size-4" />
            <span>
              <span className="font-medium">サンプルサイトを入れる</span>
              <span className="mt-1 block text-xs leading-5 text-neutral-600">
                会社・店舗向けのトップページ、会社概要、お問い合わせフォーム、お知らせを作成します。あとから設定画面で削除できます。
              </span>
            </span>
          </label>

          {error && (
            <p role="alert" className="border-l-2 border-red-600 pl-3 text-sm text-red-700">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={!supported || setup.isPending}
            className="w-full bg-neutral-950 px-4 py-2.5 text-sm font-medium text-white outline-none hover:bg-neutral-800 focus-visible:ring-2 focus-visible:ring-neutral-950 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-neutral-400"
          >
            {setup.isPending ? 'パスキーを作成中…' : 'パスキーを作成してセットアップ'}
          </button>
        </form>
      </section>
    </main>
  )
}

type FieldProps = {
  label: string
  name: string
  type?: 'email' | 'text'
  autoComplete: string
  required?: boolean
  maxLength?: number
  defaultValue?: string
  spellCheck?: boolean
}

function Field({ label, name, type = 'text', ...props }: FieldProps) {
  return (
    <label className="block text-sm font-medium text-neutral-800">
      {label}
      <input
        className="mt-2 block w-full border border-neutral-300 bg-white px-3 py-2.5 text-base outline-none transition-colors placeholder:text-neutral-400 focus:border-neutral-950 focus:ring-1 focus:ring-neutral-950 sm:text-sm"
        name={name}
        type={type}
        {...props}
      />
    </label>
  )
}
