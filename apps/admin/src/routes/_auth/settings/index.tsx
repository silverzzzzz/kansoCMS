import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { api } from '../../../api/client.ts'
import { ApiError } from '../../../api/errors.ts'
import { postTypesQuery, settingsQuery } from '../../../api/queries.ts'
import { unwrap } from '../../../api/request.ts'
import { MediaField } from '../../../components/media/MediaField.tsx'
import { PageHeading } from '../../../components/PageHeading.tsx'
import { Alert, Button, Field, inputClass } from '../../../components/ui.tsx'

export const Route = createFileRoute('/_auth/settings/')({
  loader: async ({ context }) => {
    if (context.user.role !== 'admin') return
    await Promise.all([
      context.queryClient.ensureQueryData(settingsQuery),
      context.queryClient.ensureQueryData(postTypesQuery),
    ])
  },
  component: SettingsPage,
})

function SettingsPage() {
  const { user } = Route.useRouteContext()
  const enabled = user.role === 'admin'
  const queryClient = useQueryClient()
  const settings = useQuery({ ...settingsQuery, enabled })
  const postTypes = useQuery({ ...postTypesQuery, enabled })
  const initial = settings.data
  const [title, setTitle] = useState(initial?.site.title ?? 'kansoCMS')
  const [description, setDescription] = useState(initial?.site.description ?? '')
  const [locale, setLocale] = useState(initial?.site.locale ?? 'ja')
  const [timezone, setTimezone] = useState(initial?.site.timezone ?? 'Asia/Tokyo')
  const [logoMediaId, setLogoMediaId] = useState<number | null>(initial?.site.logoMediaId ?? null)
  const [homePostTypeSlug, setHomePostTypeSlug] = useState(initial?.site.homePostTypeSlug ?? '')
  const [name, setName] = useState(initial?.organization.name ?? '')
  const [url, setUrl] = useState(initial?.organization.url ?? '')
  const [logoUrl, setLogoUrl] = useState(initial?.organization.logoUrl ?? '')
  const [sameAs, setSameAs] = useState((initial?.organization.sameAs ?? []).join('\n'))
  const [siteSaved, setSiteSaved] = useState(false)
  const [organizationSaved, setOrganizationSaved] = useState(false)
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
            homePostTypeSlug: homePostTypeSlug || null,
          },
        }),
      ),
    onSuccess: async () => {
      setSiteSaved(true)
      await queryClient.invalidateQueries({ queryKey: ['settings'] })
    },
  })
  const saveOrganization = useMutation({
    mutationFn: () =>
      unwrap(
        api.settings.organization.$put({
          json: {
            name,
            url: url.trim() || null,
            logoUrl: logoUrl.trim() || null,
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

  if (!enabled)
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
          <Field label="言語">
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
          <Field label="ロゴ URL">
            <input
              className={inputClass}
              type="url"
              value={logoUrl}
              onChange={(event) => setLogoUrl(event.target.value)}
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
        <div className="flex justify-end border-t border-neutral-200 pt-5">
          <Button type="submit" disabled={saveOrganization.isPending}>
            {saveOrganization.isPending ? '保存中…' : '組織設定を保存'}
          </Button>
        </div>
      </form>
    </div>
  )
}
