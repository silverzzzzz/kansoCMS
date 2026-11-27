import { THEME_NAMES, THEMES, type ThemeName } from '@kanso/shared'
import { useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { api } from '../../../api/client.ts'
import { ApiError, fieldErrors } from '../../../api/errors.ts'
import { pagesListQuery, postTypesQuery, settingsQuery } from '../../../api/queries.ts'
import { unwrap } from '../../../api/request.ts'
import { SaveBar } from '../../../components/editing/SaveBar.tsx'
import { confirmEditorLeave, useEditorSave } from '../../../components/editing/useEditorSave.ts'
import { SelectField, TextareaField, TextField } from '../../../components/fields.tsx'
import { MediaField } from '../../../components/media/MediaField.tsx'
import { PageHeading } from '../../../components/PageHeading.tsx'
import { StarterSection } from '../../../components/starter/StarterSection.tsx'
import { Alert, inputClass } from '../../../components/ui.tsx'

export const Route = createFileRoute('/_auth/settings/')({
  loader: async ({ context }) => {
    if (context.user.role !== 'admin') return
    await Promise.all([
      context.queryClient.ensureQueryData(settingsQuery),
      context.queryClient.ensureQueryData(postTypesQuery),
      context.queryClient.ensureQueryData(pagesListQuery({ perPage: '100' })),
    ])
  },
  component: SettingsPage,
})

function SettingsPage() {
  const { user } = Route.useRouteContext()
  // Installing or removing the starter site rewrites settings (the site
  // description), so the forms remount and re-seed from fresh data.
  const [formsKey, setFormsKey] = useState(0)
  const [starterPending, setStarterPending] = useState(false)
  const [settingsPending, setSettingsPending] = useState(false)

  if (user.role !== 'admin')
    return (
      <div>
        <PageHeading title="設定" />
        <div className="mt-6">
          <Alert tone="error">権限がありません</Alert>
        </div>
      </div>
    )
  return (
    <div>
      <PageHeading title="設定" description="サイト情報と公開者情報を管理します。" />
      <div inert={starterPending}>
        <SettingsForms key={formsKey} onPending={setSettingsPending} />
      </div>
      <StarterSection
        disabled={settingsPending}
        beforeChange={() =>
          confirmEditorLeave('未保存の設定を破棄して、サンプルサイトの変更を続けますか？')
        }
        onPending={setStarterPending}
        onChanged={() => setFormsKey((key) => key + 1)}
      />
    </div>
  )
}

function settingsErrors(error: unknown) {
  const fields: Record<string, string> = {}
  for (const [path, message] of Object.entries(fieldErrors(error))) {
    const key = path.split('.')[0] ?? path
    if (key === 'sameAs')
      fields[key] = '関連 URL は 1 行に 1 件、https:// などで始まる URL を入力してください。'
    else if (key === 'twitterHandle')
      fields[key] = '半角英数字またはアンダースコアを使い、15 文字以内で入力してください。'
    else if (key === 'notifyTo' && message.startsWith('Invalid email address: ')) {
      fields[key] =
        `「${message.slice('Invalid email address: '.length)}」のメールアドレスを確認してください。`
    } else if (key === 'notifyTo' && message === 'Use no more than 10 email addresses') {
      fields[key] = '通知先は 10 件以内で入力してください。'
    } else fields[key] = message
  }
  return fields
}

function settingsErrorMessage(error: unknown) {
  if (!error) return
  return Object.keys(fieldErrors(error)).length > 0
    ? '入力内容を確認してください。'
    : error instanceof ApiError
      ? error.message
      : '設定を保存できませんでした。'
}

function SettingsForms({ onPending }: { onPending: (pending: boolean) => void }) {
  const queryClient = useQueryClient()
  const { data: initial } = useSuspenseQuery(settingsQuery)
  const postTypes = useQuery(postTypesQuery)
  const pages = useQuery(pagesListQuery({ perPage: '100' }))
  const [site, setSite] = useState(initial.site)
  const [organization, setOrganization] = useState(() => ({
    ...initial.organization,
    sameAs: initial.organization.sameAs.join('\n'),
  }))
  const [forms, setForms] = useState(initial.forms)
  const saveSite = useEditorSave({
    value: site,
    onSave: async (value) => {
      const { site: updated } = await unwrap(
        api.settings.site.$put({
          json: {
            ...value,
            headHtml: value.headHtml?.trim() ? value.headHtml : null,
            bodyEndHtml: value.bodyEndHtml?.trim() ? value.bodyEndHtml : null,
            robotsExtra: value.robotsExtra?.trim() ? value.robotsExtra : null,
          },
        }),
      )
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['settings'] }),
        // The section catalog depends on the active theme.
        queryClient.invalidateQueries({ queryKey: ['site'] }),
      ])
      return { value: updated, apply: () => setSite(updated) }
    },
  })
  const saveOrganization = useEditorSave({
    value: organization,
    onSave: async (value) => {
      const { organization: updated } = await unwrap(
        api.settings.organization.$put({
          json: {
            ...value,
            url: value.url?.trim() || null,
            sameAs: value.sameAs
              .split(/\r?\n/)
              .map((line) => line.trim())
              .filter(Boolean),
          },
        }),
      )
      await queryClient.invalidateQueries({ queryKey: ['settings'] })
      const canonical = { ...updated, sameAs: updated.sameAs.join('\n') }
      return { value: canonical, apply: () => setOrganization(canonical) }
    },
  })
  const saveForms = useEditorSave({
    value: forms,
    onSave: async (value) => {
      const { forms: updated } = await unwrap(api.settings.forms.$put({ json: value }))
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['settings'] }),
        queryClient.invalidateQueries({ queryKey: ['forms'] }),
      ])
      return { value: updated, apply: () => setForms(updated) }
    },
  })
  const pending = saveSite.pending || saveOrganization.pending || saveForms.pending
  useEffect(() => onPending(pending), [onPending, pending])
  const siteErrors = settingsErrors(saveSite.error)
  const organizationErrors = settingsErrors(saveOrganization.error)
  const formsErrors = settingsErrors(saveForms.error)

  return (
    <>
      <form
        ref={saveSite.formRef}
        aria-labelledby="site-settings-title"
        className="mt-8 space-y-5 border border-neutral-200 bg-white p-5"
        onSubmit={(event) => {
          event.preventDefault()
          void saveSite.submit()
        }}
      >
        <h2 id="site-settings-title" className="text-lg font-semibold">
          サイト
        </h2>
        <SaveBar
          save={saveSite}
          label="サイト設定を保存"
          error={settingsErrorMessage(saveSite.error)}
        />
        <div className="grid gap-5 sm:grid-cols-2">
          <TextField
            label="サイト名"
            error={siteErrors.title}
            name="title"
            maxLength={120}
            value={site.title}
            required
            onChange={(event) => setSite({ ...site, title: event.target.value })}
          />
          <TextField
            label="言語"
            hint="公開サイトの文言は ja / en に対応しています (それ以外は英語)。"
            error={siteErrors.locale}
            name="locale"
            maxLength={35}
            value={site.locale}
            required
            onChange={(event) => setSite({ ...site, locale: event.target.value })}
          />
          <TextField
            label="タイムゾーン"
            error={siteErrors.timezone}
            name="timezone"
            value={site.timezone}
            required
            onChange={(event) => setSite({ ...site, timezone: event.target.value })}
          />
          <SelectField
            label="ホームの投稿タイプ"
            error={siteErrors.homePostTypeSlug}
            name="homePostTypeSlug"
            value={site.homePostTypeSlug ?? ''}
            onChange={(event) => setSite({ ...site, homePostTypeSlug: event.target.value || null })}
          >
            <option value="">なし</option>
            {postTypes.data?.items.map((type) => (
              <option key={type.id} value={type.slug}>
                {type.name}
              </option>
            ))}
          </SelectField>
          <SelectField
            label="テーマ"
            hint="公開サイトの見た目。テーマの追加方法は README の Themes を参照。"
            error={siteErrors.theme}
            name="theme"
            value={site.theme}
            onChange={(event) => setSite({ ...site, theme: event.target.value as ThemeName })}
          >
            {THEME_NAMES.map((name) => (
              <option key={name} value={name}>
                {THEMES[name].label}
              </option>
            ))}
          </SelectField>
        </div>
        <TextareaField
          label="説明"
          error={siteErrors.description}
          name="description"
          maxLength={320}
          showCount
          rows={4}
          value={site.description}
          onChange={(event) => setSite({ ...site, description: event.target.value })}
        />
        <MediaField
          label="ロゴ"
          value={site.logoMediaId}
          error={siteErrors.logoMediaId}
          onChange={(id) => setSite({ ...site, logoMediaId: id })}
        />
        <div>
          <MediaField
            label="既定のOG画像"
            value={site.ogImageMediaId}
            error={siteErrors.ogImageMediaId}
            onChange={(id) => setSite({ ...site, ogImageMediaId: id })}
          />
          <p className="mt-1 text-xs text-neutral-500">
            ページ・投稿・一覧で OG 画像を設定していないときに使われます。
          </p>
        </div>
        <div>
          <MediaField
            label="ファビコン"
            value={site.faviconMediaId}
            error={siteErrors.faviconMediaId}
            onChange={(id) => setSite({ ...site, faviconMediaId: id })}
          />
          <p className="mt-1 text-xs text-neutral-500">
            全ページに &lt;link rel="icon"&gt; を出力します。正方形の PNG/ICO 画像を推奨します。
          </p>
        </div>
        <TextField
          label="Google サイト検証"
          hint="Search Console の HTML タグ認証で使う content 値です (google-site-verification=... の ... 部分)。"
          error={siteErrors.googleSiteVerification}
          name="googleSiteVerification"
          maxLength={200}
          value={site.googleSiteVerification}
          onChange={(event) => setSite({ ...site, googleSiteVerification: event.target.value })}
        />
        <TextareaField
          label="カスタム head"
          hint="&lt;/head&gt; の直前にそのまま出力されます。GA・GTM 等のスニペット用。管理者のみ編集できます。"
          error={siteErrors.headHtml}
          name="headHtml"
          maxLength={16000}
          className={`${inputClass} font-mono text-xs`}
          rows={6}
          value={site.headHtml ?? ''}
          onChange={(event) => setSite({ ...site, headHtml: event.target.value })}
        />
        <TextareaField
          label="カスタム body 末尾"
          hint="&lt;/body&gt; の直前にそのまま出力されます。"
          error={siteErrors.bodyEndHtml}
          name="bodyEndHtml"
          maxLength={16000}
          className={`${inputClass} font-mono text-xs`}
          rows={6}
          value={site.bodyEndHtml ?? ''}
          onChange={(event) => setSite({ ...site, bodyEndHtml: event.target.value })}
        />
        <TextareaField
          label="robots.txt 追加ルール"
          hint="既定のルール (Disallow: /api 等) と Sitemap 行の間にそのまま出力されます。"
          error={siteErrors.robotsExtra}
          name="robotsExtra"
          maxLength={4096}
          className={`${inputClass} font-mono text-xs`}
          rows={5}
          value={site.robotsExtra ?? ''}
          placeholder={'User-agent: *\nDisallow: /private/'}
          onChange={(event) => setSite({ ...site, robotsExtra: event.target.value })}
        />
        <label className="flex items-start gap-2 text-sm font-medium text-neutral-800">
          <input
            type="checkbox"
            checked={site.disallowAiTraining}
            onChange={(event) => setSite({ ...site, disallowAiTraining: event.target.checked })}
          />
          AI の学習に使わないよう求める
        </label>
        <p className="-mt-3 text-xs text-neutral-500">
          {
            'robots.txt に「検索は可、AI の学習は不可」の表明 (Content-Signal) を加え、主な学習用クローラー (GPTBot、ClaudeBot、Google-Extended など) のクロールを断ります。検索エンジンへの登録には影響しません。従うかどうかはクローラー次第です。'
          }
        </p>
        <label className="flex items-start gap-2 text-sm font-medium text-neutral-800">
          <input
            type="checkbox"
            checked={site.noindex}
            onChange={(event) => setSite({ ...site, noindex: event.target.checked })}
          />
          サイト全体を検索エンジンに登録しない
        </label>
        <p className="-mt-3 text-xs text-neutral-500">
          準備中・ステージングサイト向け。全ページに noindex を出力し、サイトマップは空になります
          (robots.txt でのクロール拒否は行いません)。
        </p>
        <SelectField
          label="カスタム 404 ページ"
          hint="存在しない URL へのアクセスで、標準メッセージの代わりにこのページの本文を表示します (ステータスは 404 のまま)。"
          error={siteErrors.notFoundPageId}
          name="notFoundPageId"
          value={site.notFoundPageId ?? ''}
          onChange={(event) =>
            setSite({ ...site, notFoundPageId: Number(event.target.value) || null })
          }
        >
          <option value="">標準 (なし)</option>
          {(pages.data?.items ?? []).map((page) => (
            <option key={page.id} value={page.id}>
              {page.title} (/{page.path})
            </option>
          ))}
        </SelectField>
        <div className="space-y-3 border border-neutral-200 bg-neutral-50 p-4">
          <label className="flex items-start gap-2 text-sm font-medium text-neutral-800">
            <input
              type="checkbox"
              checked={site.maintenance}
              onChange={(event) => setSite({ ...site, maintenance: event.target.checked })}
            />
            メンテナンスモード
          </label>
          <p className="text-xs text-neutral-500">
            有効にすると公開サイトは 503
            のメンテナンスページになります。ログイン中の管理者はそのまま閲覧でき、
            robots.txt・サイトマップ・プレビューは通常どおり動作します。
          </p>
          <TextareaField
            label="メンテナンスメッセージ"
            hint="空の場合は既定の文言を表示します。"
            error={siteErrors.maintenanceMessage}
            name="maintenanceMessage"
            maxLength={500}
            rows={3}
            value={site.maintenanceMessage}
            onChange={(event) => setSite({ ...site, maintenanceMessage: event.target.value })}
          />
        </div>
      </form>
      <form
        ref={saveOrganization.formRef}
        aria-labelledby="organization-settings-title"
        className="mt-8 space-y-5 border border-neutral-200 bg-white p-5"
        onSubmit={(event) => {
          event.preventDefault()
          void saveOrganization.submit()
        }}
      >
        <h2 id="organization-settings-title" className="text-lg font-semibold">
          組織
        </h2>
        <SaveBar
          save={saveOrganization}
          label="組織設定を保存"
          error={settingsErrorMessage(saveOrganization.error)}
        />
        <div className="grid gap-5 sm:grid-cols-2">
          <TextField
            label="組織名"
            error={organizationErrors.name}
            name="name"
            maxLength={120}
            value={organization.name}
            onChange={(event) => setOrganization({ ...organization, name: event.target.value })}
          />
          <TextField
            label="Web サイト URL"
            error={organizationErrors.url}
            name="url"
            type="url"
            value={organization.url ?? ''}
            onChange={(event) => setOrganization({ ...organization, url: event.target.value })}
          />
          <TextField
            label="X アカウント"
            hint="@なしで入力します。twitter:site に使われます。"
            error={organizationErrors.twitterHandle}
            name="twitterHandle"
            value={organization.twitterHandle}
            onChange={(event) =>
              setOrganization({ ...organization, twitterHandle: event.target.value })
            }
          />
          <TextareaField
            label="関連 URL"
            hint="1 行に 1 件入力します。"
            error={organizationErrors.sameAs}
            name="sameAs"
            rows={5}
            value={organization.sameAs}
            onChange={(event) => setOrganization({ ...organization, sameAs: event.target.value })}
          />
        </div>
        <div>
          <MediaField
            label="ロゴ"
            value={organization.logoMediaId}
            error={organizationErrors.logoMediaId}
            onChange={(id) => setOrganization({ ...organization, logoMediaId: id })}
          />
          <p className="mt-1 text-xs text-neutral-500">
            JSON-LD の Organization logo に使われます。未選択ならサイトのロゴを使います。
          </p>
        </div>
      </form>
      <form
        ref={saveForms.formRef}
        aria-labelledby="forms-settings-title"
        className="mt-8 space-y-5 border border-neutral-200 bg-white p-5"
        onSubmit={(event) => {
          event.preventDefault()
          void saveForms.submit()
        }}
      >
        <h2 id="forms-settings-title" className="text-lg font-semibold">
          フォーム
        </h2>
        <SaveBar
          save={saveForms}
          label="フォーム設定を保存"
          error={settingsErrorMessage(saveForms.error)}
        />
        <div className="grid gap-5 sm:grid-cols-2">
          <TextField
            label="差出人メールアドレス"
            hint="空なら通知メールを送信しません。Cloudflare Email Service でオンボード済みドメインのアドレスを入力します。"
            error={formsErrors.fromEmail}
            name="fromEmail"
            type="email"
            value={forms.fromEmail}
            onChange={(event) => setForms({ ...forms, fromEmail: event.target.value })}
          />
          <TextField
            label="差出人名"
            hint="空ならサイト名を使います。"
            error={formsErrors.fromName}
            name="fromName"
            maxLength={100}
            value={forms.fromName}
            onChange={(event) => setForms({ ...forms, fromName: event.target.value })}
          />
          <TextareaField
            label="既定の通知先"
            hint="カンマまたは改行区切り、最大 10 件"
            error={formsErrors.notifyTo}
            name="notifyTo"
            rows={4}
            value={forms.notifyTo}
            onChange={(event) => setForms({ ...forms, notifyTo: event.target.value })}
          />
          <TextField
            label="Turnstile サイトキー"
            error={formsErrors.turnstileSiteKey}
            name="turnstileSiteKey"
            maxLength={200}
            value={forms.turnstileSiteKey}
            onChange={(event) => setForms({ ...forms, turnstileSiteKey: event.target.value })}
          />
        </div>
        <p className="border-l-2 border-neutral-400 bg-neutral-50 p-3 text-sm text-neutral-700">
          TURNSTILE_SECRET_KEY:{' '}
          {initial.turnstileSecretConfigured
            ? '設定済み'
            : '未設定 — pnpm --filter @kanso/server exec wrangler secret put TURNSTILE_SECRET_KEY'}
        </p>
      </form>
    </>
  )
}
