import { THEME_NAMES, THEMES, type ThemeName } from '@kanso/shared'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { api } from '../../../api/client.ts'
import { ApiError } from '../../../api/errors.ts'
import { pagesListQuery, postTypesQuery, settingsQuery } from '../../../api/queries.ts'
import { unwrap } from '../../../api/request.ts'
import { MediaField } from '../../../components/media/MediaField.tsx'
import { PageHeading } from '../../../components/PageHeading.tsx'
import { StarterSection } from '../../../components/starter/StarterSection.tsx'
import { Alert, Button, Field, inputClass } from '../../../components/ui.tsx'

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
      <SettingsForms key={formsKey} />
      <StarterSection onChanged={() => setFormsKey((key) => key + 1)} />
    </div>
  )
}

function SettingsForms() {
  const queryClient = useQueryClient()
  const settings = useQuery(settingsQuery)
  const postTypes = useQuery(postTypesQuery)
  const pages = useQuery(pagesListQuery({ perPage: '100' }))
  const initial = settings.data
  const [title, setTitle] = useState(initial?.site.title ?? 'kansoCMS')
  const [description, setDescription] = useState(initial?.site.description ?? '')
  const [locale, setLocale] = useState(initial?.site.locale ?? 'ja')
  const [timezone, setTimezone] = useState(initial?.site.timezone ?? 'Asia/Tokyo')
  const [logoMediaId, setLogoMediaId] = useState<number | null>(initial?.site.logoMediaId ?? null)
  const [ogImageMediaId, setOgImageMediaId] = useState<number | null>(
    initial?.site.ogImageMediaId ?? null,
  )
  const [homePostTypeSlug, setHomePostTypeSlug] = useState(initial?.site.homePostTypeSlug ?? '')
  const [siteNoindex, setSiteNoindex] = useState(initial?.site.noindex ?? false)
  const [faviconMediaId, setFaviconMediaId] = useState<number | null>(
    initial?.site.faviconMediaId ?? null,
  )
  const [googleSiteVerification, setGoogleSiteVerification] = useState(
    initial?.site.googleSiteVerification ?? '',
  )
  const [headHtml, setHeadHtml] = useState(initial?.site.headHtml ?? '')
  const [bodyEndHtml, setBodyEndHtml] = useState(initial?.site.bodyEndHtml ?? '')
  const [robotsExtra, setRobotsExtra] = useState(initial?.site.robotsExtra ?? '')
  const [disallowAiTraining, setDisallowAiTraining] = useState(
    initial?.site.disallowAiTraining ?? false,
  )
  const [notFoundPageId, setNotFoundPageId] = useState(String(initial?.site.notFoundPageId ?? ''))
  const [maintenance, setMaintenance] = useState(initial?.site.maintenance ?? false)
  const [maintenanceMessage, setMaintenanceMessage] = useState(
    initial?.site.maintenanceMessage ?? '',
  )
  const [theme, setTheme] = useState<ThemeName>(initial?.site.theme ?? 'default')
  const [name, setName] = useState(initial?.organization.name ?? '')
  const [url, setUrl] = useState(initial?.organization.url ?? '')
  const [orgLogoMediaId, setOrgLogoMediaId] = useState<number | null>(
    initial?.organization.logoMediaId ?? null,
  )
  const [twitterHandle, setTwitterHandle] = useState(initial?.organization.twitterHandle ?? '')
  const [sameAs, setSameAs] = useState((initial?.organization.sameAs ?? []).join('\n'))
  const [fromEmail, setFromEmail] = useState(initial?.forms.fromEmail ?? '')
  const [fromName, setFromName] = useState(initial?.forms.fromName ?? '')
  const [formsNotifyTo, setFormsNotifyTo] = useState(initial?.forms.notifyTo ?? '')
  const [turnstileSiteKey, setTurnstileSiteKey] = useState(initial?.forms.turnstileSiteKey ?? '')
  const [siteSaved, setSiteSaved] = useState(false)
  const [organizationSaved, setOrganizationSaved] = useState(false)
  const [formsSaved, setFormsSaved] = useState(false)
  const saveSite = useMutation({
    mutationFn: () =>
      unwrap(
        api.settings.site.$put({
          json: {
            title,
            description,
            locale,
            timezone,
            logoMediaId,
            ogImageMediaId,
            homePostTypeSlug: homePostTypeSlug || null,
            noindex: siteNoindex,
            faviconMediaId,
            googleSiteVerification,
            headHtml: headHtml.trim() ? headHtml : null,
            bodyEndHtml: bodyEndHtml.trim() ? bodyEndHtml : null,
            robotsExtra: robotsExtra.trim() ? robotsExtra : null,
            disallowAiTraining,
            notFoundPageId: notFoundPageId ? Number(notFoundPageId) : null,
            maintenance,
            maintenanceMessage,
            theme,
          },
        }),
      ),
    onSuccess: async () => {
      setSiteSaved(true)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['settings'] }),
        // The section catalog depends on the active theme.
        queryClient.invalidateQueries({ queryKey: ['site'] }),
      ])
    },
  })
  const saveOrganization = useMutation({
    mutationFn: () =>
      unwrap(
        api.settings.organization.$put({
          json: {
            name,
            url: url.trim() || null,
            logoMediaId: orgLogoMediaId,
            twitterHandle,
            sameAs: sameAs
              .split(/\r?\n/)
              .map((value) => value.trim())
              .filter(Boolean),
          },
        }),
      ),
    onSuccess: async () => {
      setOrganizationSaved(true)
      await queryClient.invalidateQueries({ queryKey: ['settings'] })
    },
  })
  const saveForms = useMutation({
    mutationFn: () =>
      unwrap(
        api.settings.forms.$put({
          json: { fromEmail, fromName, notifyTo: formsNotifyTo, turnstileSiteKey },
        }),
      ),
    onSuccess: async () => {
      setFormsSaved(true)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['settings'] }),
        queryClient.invalidateQueries({ queryKey: ['forms'] }),
      ])
    },
  })

  return (
    <>
      <form
        className="mt-8 space-y-5 border border-neutral-200 bg-white p-5"
        onSubmit={(event) => {
          event.preventDefault()
          setSiteSaved(false)
          saveSite.mutate()
        }}
      >
        <h2 className="text-lg font-semibold">サイト</h2>
        {siteSaved && <Alert tone="success">サイト設定を保存しました。</Alert>}
        {saveSite.error && (
          <Alert tone="error">
            {saveSite.error instanceof ApiError ? saveSite.error.message : '保存できませんでした'}
          </Alert>
        )}
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="サイト名">
            <input
              className={inputClass}
              value={title}
              required
              onChange={(event) => setTitle(event.target.value)}
            />
          </Field>
          <Field label="言語" hint="公開サイトの文言は ja / en に対応しています (それ以外は英語)。">
            <input
              className={inputClass}
              value={locale}
              required
              onChange={(event) => setLocale(event.target.value)}
            />
          </Field>
          <Field label="タイムゾーン">
            <input
              className={inputClass}
              value={timezone}
              required
              onChange={(event) => setTimezone(event.target.value)}
            />
          </Field>
          <Field label="ホームの投稿タイプ">
            <select
              className={inputClass}
              value={homePostTypeSlug}
              onChange={(event) => setHomePostTypeSlug(event.target.value)}
            >
              <option value="">なし</option>
              {postTypes.data?.items.map((type) => (
                <option key={type.id} value={type.slug}>
                  {type.name}
                </option>
              ))}
            </select>
          </Field>
          <Field
            label="テーマ"
            hint="公開サイトの見た目。テーマの追加方法は README の Themes を参照。"
          >
            <select
              className={inputClass}
              value={theme}
              onChange={(event) => setTheme(event.target.value as ThemeName)}
            >
              {THEME_NAMES.map((name) => (
                <option key={name} value={name}>
                  {THEMES[name].label}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <Field label="説明">
          <textarea
            className={inputClass}
            rows={4}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
        </Field>
        <MediaField label="ロゴ" value={logoMediaId} onChange={setLogoMediaId} />
        <div>
          <MediaField label="既定のOG画像" value={ogImageMediaId} onChange={setOgImageMediaId} />
          <p className="mt-1 text-xs text-neutral-500">
            ページ・投稿・一覧で OG 画像を設定していないときに使われます。
          </p>
        </div>
        <div>
          <MediaField label="ファビコン" value={faviconMediaId} onChange={setFaviconMediaId} />
          <p className="mt-1 text-xs text-neutral-500">
            全ページに &lt;link rel="icon"&gt; を出力します。正方形の PNG/ICO 画像を推奨します。
          </p>
        </div>
        <Field
          label="Google サイト検証"
          hint="Search Console の HTML タグ認証で使う content 値です (google-site-verification=... の ... 部分)。"
        >
          <input
            className={inputClass}
            value={googleSiteVerification}
            onChange={(event) => setGoogleSiteVerification(event.target.value)}
          />
        </Field>
        <Field
          label="カスタム head"
          hint="&lt;/head&gt; の直前にそのまま出力されます。GA・GTM 等のスニペット用。管理者のみ編集できます。"
        >
          <textarea
            className={`${inputClass} font-mono text-xs`}
            rows={6}
            value={headHtml}
            onChange={(event) => setHeadHtml(event.target.value)}
          />
        </Field>
        <Field label="カスタム body 末尾" hint="&lt;/body&gt; の直前にそのまま出力されます。">
          <textarea
            className={`${inputClass} font-mono text-xs`}
            rows={6}
            value={bodyEndHtml}
            onChange={(event) => setBodyEndHtml(event.target.value)}
          />
        </Field>
        <Field
          label="robots.txt 追加ルール"
          hint="既定のルール (Disallow: /admin 等) と Sitemap 行の間にそのまま出力されます。"
        >
          <textarea
            className={`${inputClass} font-mono text-xs`}
            rows={5}
            value={robotsExtra}
            placeholder={'User-agent: *\nDisallow: /private/'}
            onChange={(event) => setRobotsExtra(event.target.value)}
          />
        </Field>
        <label className="flex items-start gap-2 text-sm font-medium text-neutral-800">
          <input
            type="checkbox"
            checked={disallowAiTraining}
            onChange={(event) => setDisallowAiTraining(event.target.checked)}
          />
          AI の学習に使わないよう求める
        </label>
        <p className="-mt-3 text-xs text-neutral-500">
          robots.txt に「検索は可、AI の学習は不可」の表明 (Content-Signal)
          を加え、主な学習用クローラー (GPTBot、ClaudeBot、Google-Extended など)
          のクロールを断ります。検索エンジンへの登録には影響しません。従うかどうかはクローラー次第です。
        </p>
        <label className="flex items-start gap-2 text-sm font-medium text-neutral-800">
          <input
            type="checkbox"
            checked={siteNoindex}
            onChange={(event) => setSiteNoindex(event.target.checked)}
          />
          サイト全体を検索エンジンに登録しない
        </label>
        <p className="-mt-3 text-xs text-neutral-500">
          準備中・ステージングサイト向け。全ページに noindex を出力し、サイトマップは空になります
          (robots.txt でのクロール拒否は行いません)。
        </p>
        <Field
          label="カスタム 404 ページ"
          hint="存在しない URL へのアクセスで、標準メッセージの代わりにこのページの本文を表示します (ステータスは 404 のまま)。"
        >
          <select
            className={inputClass}
            value={notFoundPageId}
            onChange={(event) => setNotFoundPageId(event.target.value)}
          >
            <option value="">標準 (なし)</option>
            {(pages.data?.items ?? []).map((page) => (
              <option key={page.id} value={page.id}>
                {page.title} (/{page.path})
              </option>
            ))}
          </select>
        </Field>
        <div className="space-y-3 border border-neutral-200 bg-neutral-50 p-4">
          <label className="flex items-start gap-2 text-sm font-medium text-neutral-800">
            <input
              type="checkbox"
              checked={maintenance}
              onChange={(event) => setMaintenance(event.target.checked)}
            />
            メンテナンスモード
          </label>
          <p className="text-xs text-neutral-500">
            有効にすると公開サイトは 503
            のメンテナンスページになります。ログイン中の管理者はそのまま閲覧でき、
            robots.txt・サイトマップ・プレビューは通常どおり動作します。
          </p>
          <Field label="メンテナンスメッセージ" hint="空の場合は既定の文言を表示します。">
            <textarea
              className={inputClass}
              rows={3}
              value={maintenanceMessage}
              onChange={(event) => setMaintenanceMessage(event.target.value)}
            />
          </Field>
        </div>
        <div className="flex justify-end border-t border-neutral-200 pt-5">
          <Button type="submit" disabled={saveSite.isPending}>
            {saveSite.isPending ? '保存中…' : 'サイト設定を保存'}
          </Button>
        </div>
      </form>
      <form
        className="mt-8 space-y-5 border border-neutral-200 bg-white p-5"
        onSubmit={(event) => {
          event.preventDefault()
          setOrganizationSaved(false)
          saveOrganization.mutate()
        }}
      >
        <h2 className="text-lg font-semibold">組織</h2>
        {organizationSaved && <Alert tone="success">組織設定を保存しました。</Alert>}
        {saveOrganization.error && (
          <Alert tone="error">
            {saveOrganization.error instanceof ApiError
              ? saveOrganization.error.message
              : '保存できませんでした'}
          </Alert>
        )}
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="組織名">
            <input
              className={inputClass}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </Field>
          <Field label="Web サイト URL">
            <input
              className={inputClass}
              type="url"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
            />
          </Field>
          <Field label="X アカウント" hint="@なしで入力します。twitter:site に使われます。">
            <input
              className={inputClass}
              value={twitterHandle}
              onChange={(event) => setTwitterHandle(event.target.value)}
            />
          </Field>
          <Field label="関連 URL" hint="1 行に 1 件入力します。">
            <textarea
              className={inputClass}
              rows={5}
              value={sameAs}
              onChange={(event) => setSameAs(event.target.value)}
            />
          </Field>
        </div>
        <div>
          <MediaField label="ロゴ" value={orgLogoMediaId} onChange={setOrgLogoMediaId} />
          <p className="mt-1 text-xs text-neutral-500">
            JSON-LD の Organization logo に使われます。未選択ならサイトのロゴを使います。
          </p>
        </div>
        <div className="flex justify-end border-t border-neutral-200 pt-5">
          <Button type="submit" disabled={saveOrganization.isPending}>
            {saveOrganization.isPending ? '保存中…' : '組織設定を保存'}
          </Button>
        </div>
      </form>
      <form
        className="mt-8 space-y-5 border border-neutral-200 bg-white p-5"
        onSubmit={(event) => {
          event.preventDefault()
          setFormsSaved(false)
          saveForms.mutate()
        }}
      >
        <h2 className="text-lg font-semibold">フォーム</h2>
        {formsSaved && <Alert tone="success">フォーム設定を保存しました。</Alert>}
        {saveForms.error && (
          <Alert tone="error">
            {saveForms.error instanceof ApiError ? saveForms.error.message : '保存できませんでした'}
          </Alert>
        )}
        <div className="grid gap-5 sm:grid-cols-2">
          <Field
            label="差出人メールアドレス"
            hint="空なら通知メールを送信しません。Cloudflare Email Service でオンボード済みドメインのアドレスを入力します。"
          >
            <input
              className={inputClass}
              type="email"
              value={fromEmail}
              onChange={(event) => setFromEmail(event.target.value)}
            />
          </Field>
          <Field label="差出人名" hint="空ならサイト名を使います。">
            <input
              className={inputClass}
              value={fromName}
              onChange={(event) => setFromName(event.target.value)}
            />
          </Field>
          <Field label="既定の通知先" hint="カンマまたは改行区切り、最大 10 件">
            <textarea
              className={inputClass}
              rows={4}
              value={formsNotifyTo}
              onChange={(event) => setFormsNotifyTo(event.target.value)}
            />
          </Field>
          <Field label="Turnstile サイトキー">
            <input
              className={inputClass}
              value={turnstileSiteKey}
              onChange={(event) => setTurnstileSiteKey(event.target.value)}
            />
          </Field>
        </div>
        <p className="border-l-2 border-neutral-400 bg-neutral-50 p-3 text-sm text-neutral-700">
          TURNSTILE_SECRET_KEY:{' '}
          {initial?.turnstileSecretConfigured
            ? '設定済み'
            : '未設定 — pnpm --filter @kanso/server exec wrangler secret put TURNSTILE_SECRET_KEY'}
        </p>
        <div className="flex justify-end border-t border-neutral-200 pt-5">
          <Button type="submit" disabled={saveForms.isPending}>
            {saveForms.isPending ? '保存中…' : 'フォーム設定を保存'}
          </Button>
        </div>
      </form>
    </>
  )
}
