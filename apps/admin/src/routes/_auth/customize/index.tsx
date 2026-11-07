import type { PageSection } from '@kanso/shared'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useEffect, useMemo, useState } from 'react'
import { api } from '../../../api/client.ts'
import { ApiError } from '../../../api/errors.ts'
import {
  type PageItem,
  pageQuery,
  pagesListQuery,
  type SectionCatalogItem,
  sectionCatalogQuery,
} from '../../../api/queries.ts'
import { unwrap } from '../../../api/request.ts'
import { ConfirmDialog } from '../../../components/ConfirmDialog.tsx'
import {
  defaultSettings,
  SectionSettingsForm,
} from '../../../components/customize/SectionSettingsForm.tsx'
import { PageHeading } from '../../../components/PageHeading.tsx'
import { Alert, Button, EmptyState, inputClass } from '../../../components/ui.tsx'

type CustomizeSearch = { page?: number }

export const Route = createFileRoute('/_auth/customize/')({
  validateSearch: (search: Record<string, unknown>): CustomizeSearch => ({
    page: typeof search.page === 'number' && search.page >= 1 ? Math.floor(search.page) : undefined,
  }),
  loaderDeps: ({ search }) => search,
  loader: async ({ context }) => {
    await Promise.all([
      context.queryClient.ensureQueryData(pagesListQuery({ perPage: '100' })),
      context.queryClient.ensureQueryData(sectionCatalogQuery),
    ])
  },
  component: CustomizePage,
})

function CustomizePage() {
  const search = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })
  const pages = useQuery(pagesListQuery({ perPage: '100' }))
  const catalog = useQuery(sectionCatalogQuery)
  const items = pages.data?.items ?? []
  const pageId =
    search.page ?? items.find((page) => page.path === 'home')?.id ?? items[0]?.id ?? null
  const detail = useQuery({ ...pageQuery(pageId ?? 0), enabled: pageId !== null })

  if (items.length === 0) {
    return (
      <div>
        <PageHeading title="カスタマイズ" description="ページのセクション構成を編集します。" />
        <div className="mt-8">
          <EmptyState>
            固定ページがまだありません。
            <Link to="/pages/new" className="ml-2 underline">
              ページを作成
            </Link>
            してからカスタマイズできます。
          </EmptyState>
        </div>
      </div>
    )
  }

  return (
    <div>
      <PageHeading
        title="カスタマイズ"
        description="セクションを追加・並べ替えてページを組み立てます。保存すると公開ページに反映されます。"
        actions={
          <select
            className={inputClass.replace('mt-2 ', '')}
            value={pageId ?? ''}
            onChange={(event) => navigate({ search: { page: Number(event.target.value) } })}
          >
            {items.map((page) => (
              <option key={page.id} value={page.id}>
                {page.title}
                {page.path === 'home' ? ' (トップページ)' : ` (/${page.path})`}
              </option>
            ))}
          </select>
        }
      />
      {detail.data?.item && catalog.data ? (
        <Editor
          key={detail.data.item.id}
          page={detail.data.item}
          catalog={catalog.data.items}
          theme={catalog.data.theme}
        />
      ) : (
        <p className="mt-8">読み込み中…</p>
      )}
    </div>
  )
}

function newSection(item: SectionCatalogItem): PageSection {
  return { id: crypto.randomUUID(), type: item.type, settings: defaultSettings(item.fields) }
}

function injectBase(html: string): string {
  return html.replace(/<head([^>]*)>/i, `<head$1><base href="${window.location.origin}/">`)
}

function Editor({
  page,
  catalog,
  theme,
}: {
  page: PageItem
  catalog: SectionCatalogItem[]
  theme: string
}) {
  const queryClient = useQueryClient()
  const [sections, setSections] = useState<PageSection[]>(page.sections ?? [])
  const [savedJson, setSavedJson] = useState(JSON.stringify(page.sections ?? []))
  const [selectedId, setSelectedId] = useState<string | null>(sections[0]?.id ?? null)
  const [addType, setAddType] = useState(catalog[0]?.type ?? '')
  const [previewHtml, setPreviewHtml] = useState('')
  const [previewError, setPreviewError] = useState(false)
  const [detachOpen, setDetachOpen] = useState(false)

  const sectionsJson = JSON.stringify(sections)
  const sectionsMode = page.sections !== null
  const dirty = sectionsJson !== savedJson
  const selected = sections.find((section) => section.id === selectedId) ?? null
  const selectedCatalog = selected
    ? (catalog.find((item) => item.type === selected.type) ?? null)
    : null
  const labelFor = useMemo(() => {
    const labels = new Map(catalog.map((item) => [item.type, item.label]))
    return (type: string) => labels.get(type) ?? type
  }, [catalog])

  useEffect(() => {
    if (!dirty) return
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault()
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [dirty])

  useEffect(() => {
    const timer = setTimeout(async () => {
      try {
        const response = await fetch('/preview/draft/page', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ title: page.title, sections: JSON.parse(sectionsJson) }),
        })
        if (!response.ok) throw new Error(String(response.status))
        setPreviewHtml(injectBase(await response.text()))
        setPreviewError(false)
      } catch {
        setPreviewError(true)
      }
    }, 400)
    return () => clearTimeout(timer)
  }, [sectionsJson, page.title])

  const save = useMutation({
    mutationFn: (value: PageSection[] | null) =>
      unwrap(
        api.pages[':id'].$patch({ param: { id: String(page.id) }, json: { sections: value } }),
      ),
    onSuccess: async (data) => {
      setSavedJson(JSON.stringify(data.item.sections ?? []))
      setDetachOpen(false)
      await queryClient.invalidateQueries({ queryKey: ['pages'] })
    },
  })
  const saveError = save.error instanceof ApiError ? save.error : null

  function move(id: string, delta: -1 | 1) {
    setSections((current) => {
      const index = current.findIndex((section) => section.id === id)
      const target = index + delta
      if (index < 0 || target < 0 || target >= current.length) return current
      const next = [...current]
      const item = next[index]
      const other = next[target]
      if (!item || !other) return current
      next[index] = other
      next[target] = item
      return next
    })
  }

  function updateSelected(name: string, value: unknown) {
    if (!selected) return
    setSections((current) =>
      current.map((section) => {
        if (section.id !== selected.id) return section
        const settings = { ...section.settings }
        if (value === undefined) delete settings[name]
        else settings[name] = value
        return { ...section, settings }
      }),
    )
  }

  return (
    <div className="mt-6">
      {!sectionsMode && (
        <div className="mb-4">
          <Alert tone="info">
            このページは現在リッチテキスト本文で表示されています。セクションを追加して保存すると、本文の代わりにセクションが表示されます
            (本文は保持され、いつでも戻せます)。
          </Alert>
        </div>
      )}
      {saveError && (
        <div className="mb-4">
          <Alert tone="error">
            保存できませんでした: {saveError.message}
            {Array.isArray(saveError.details) && saveError.details.length > 0 && (
              <ul className="mt-1 list-disc pl-5">
                {(saveError.details as { path?: string; message?: string }[]).map(
                  (detail, index) => (
                    <li key={`${detail.path ?? index}`}>
                      {detail.path}: {detail.message}
                    </li>
                  ),
                )}
              </ul>
            )}
          </Alert>
        </div>
      )}
      <div className="flex flex-col gap-6 lg:flex-row">
        <div className="w-full shrink-0 space-y-6 lg:w-96">
          <div className="border border-neutral-200 bg-white p-4">
            <h2 className="text-sm font-semibold text-neutral-800">セクション</h2>
            {sections.length === 0 && (
              <p className="mt-3 text-sm text-neutral-500">まだセクションがありません。</p>
            )}
            <ul className="mt-3 space-y-1">
              {sections.map((section, index) => (
                <li key={section.id} className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setSelectedId(section.id)}
                    className={`min-w-0 flex-1 truncate border px-3 py-2 text-left text-sm ${
                      section.id === selectedId
                        ? 'border-neutral-950 bg-neutral-950 text-white'
                        : 'border-neutral-200 bg-white hover:border-neutral-400'
                    }`}
                  >
                    {labelFor(section.type)}
                  </button>
                  <Button
                    type="button"
                    variant="secondary"
                    size="small"
                    aria-label="上へ移動"
                    disabled={index === 0}
                    onClick={() => move(section.id, -1)}
                  >
                    ↑
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    size="small"
                    aria-label="下へ移動"
                    disabled={index === sections.length - 1}
                    onClick={() => move(section.id, 1)}
                  >
                    ↓
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    size="small"
                    aria-label="削除"
                    onClick={() => {
                      setSections((current) => current.filter((s) => s.id !== section.id))
                      if (selectedId === section.id) setSelectedId(null)
                    }}
                  >
                    ×
                  </Button>
                </li>
              ))}
            </ul>
            <div className="mt-4 flex items-end gap-2">
              <label className="min-w-0 flex-1 text-sm font-medium text-neutral-800">
                追加するセクション
                <select
                  className={inputClass}
                  value={addType}
                  onChange={(event) => setAddType(event.target.value)}
                >
                  {catalog.map((item) => (
                    <option key={item.type} value={item.type}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </label>
              <Button
                type="button"
                variant="secondary"
                disabled={sections.length >= 30}
                onClick={() => {
                  const item = catalog.find((entry) => entry.type === addType)
                  if (!item) return
                  const section = newSection(item)
                  setSections((current) => [...current, section])
                  setSelectedId(section.id)
                }}
              >
                追加
              </Button>
            </div>
          </div>

          {selected && selectedCatalog && (
            <div className="border border-neutral-200 bg-white p-4">
              <h2 className="text-sm font-semibold text-neutral-800">
                {selectedCatalog.label} の設定
              </h2>
              {selectedCatalog.description && (
                <p className="mt-1 text-xs text-neutral-500">{selectedCatalog.description}</p>
              )}
              <div className="mt-4">
                <SectionSettingsForm
                  fields={selectedCatalog.fields}
                  values={selected.settings}
                  onChange={updateSelected}
                />
              </div>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="button"
              disabled={!dirty || save.isPending}
              onClick={() => save.mutate(JSON.parse(sectionsJson))}
            >
              {save.isPending ? '保存中…' : '保存'}
            </Button>
            {dirty ? (
              <span className="text-sm text-neutral-500">未保存の変更があります</span>
            ) : (
              save.isSuccess && <span className="text-sm text-green-700">保存しました</span>
            )}
            {sectionsMode && (
              <Button type="button" variant="secondary" onClick={() => setDetachOpen(true)}>
                セクションをやめて本文に戻す
              </Button>
            )}
          </div>
          <p className="text-xs text-neutral-500">テーマ: {theme}</p>
        </div>

        <div className="min-w-0 flex-1">
          {previewError && (
            <div className="mb-3">
              <Alert tone="error">プレビューを取得できませんでした。</Alert>
            </div>
          )}
          <iframe
            title="プレビュー"
            className="h-[70vh] min-h-96 w-full border border-neutral-300 bg-white"
            srcDoc={previewHtml}
          />
        </div>
      </div>

      <ConfirmDialog
        open={detachOpen}
        title="本文表示に戻す"
        description="セクション構成を削除し、リッチテキスト本文の表示に戻します。よろしいですか?"
        confirmLabel="本文に戻す"
        pending={save.isPending}
        onClose={() => setDetachOpen(false)}
        onConfirm={() => save.mutate(null)}
      />
    </div>
  )
}
