import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { useRef } from 'react'
import { api } from '../../api/client.ts'
import { type PageItem, pagesListQuery, sectionCatalogQuery } from '../../api/queries.ts'
import { unwrap } from '../../api/request.ts'
import {
  contentErrors,
  contentPayload,
  contentValue,
  type PageDraft,
  parsePageDraft,
} from '../../lib/content-values.ts'
import { descendantIds, flattenPageTree } from '../../lib/page-tree.ts'
import { SelectField, TextField } from '../fields.tsx'
import { Alert } from '../ui.tsx'
import { ContentForm } from './ContentForm.tsx'
import { ContentRecordFrame } from './ContentRecordFrame.tsx'
import { useContentRecord } from './useContentRecord.ts'

export function PageContentEditor({
  item,
  reload,
}: {
  item?: PageItem
  reload?: () => Promise<void>
}) {
  const pages = useQuery(pagesListQuery({ perPage: '100' })).data?.items ?? []
  const catalog = useQuery({ ...sectionCatalogQuery, enabled: !item })
  const storedTime = useRef(item?.publishedAt ?? null)
  const { value, setValue, save, editorKey, setUploading, setInvalidBody } =
    useContentRecord<PageDraft>({
      kind: 'page',
      item,
      resource: `page:${item?.id ?? 'new'}`,
      parse: parsePageDraft,
      initial: () => ({
        content: contentValue(item),
        parentId: item?.parentId ?? null,
        sortOrder: item?.sortOrder ?? 0,
        templateId: 'richtext',
        sections: null,
      }),
      write: async (draft, baseUpdatedAt) => {
        const json = {
          ...contentPayload(draft.content, storedTime.current),
          parentId: draft.parentId,
          sortOrder: draft.sortOrder,
        }
        const result = item
          ? await unwrap(
              api.pages[':id'].$patch({
                param: { id: String(item.id) },
                json: { ...json, baseUpdatedAt },
              }),
            )
          : await unwrap(api.pages.$post({ json: { ...json, sections: draft.sections } }))
        storedTime.current = result.item.publishedAt
        return {
          id: result.item.id,
          updatedAt: result.item.updatedAt,
          content: contentValue({ ...result.item, bodyJson: draft.content.bodyJson }),
        }
      },
    })
  const errors = contentErrors(save.error)
  const excluded = item ? descendantIds(pages, item.id) : new Set<number>()
  const parent = pages.find((page) => page.id === value.parentId)
  const path = parent ? `/${parent.path}/${value.content.slug}` : `/${value.content.slug}`
  const templates = catalog.data?.templates ?? []
  return (
    <ContentRecordFrame
      kind="page"
      item={item}
      heading={item ? '固定ページを編集' : '固定ページを作成'}
      publicPath={item && `/${item.path}`}
      save={save}
      reload={reload}
    >
      {item?.sections != null && (
        <div className="mt-4">
          <Alert tone="info">
            このページは
            <Link to="/customize" search={{ page: item.id }} className="underline">
              カスタマイズ (セクション)
            </Link>
            で表示が管理されています。ここで編集した本文は、セクションをやめるまで公開ページに表示されません。
          </Alert>
        </div>
      )}
      <ContentForm
        kind="page"
        creating={!item}
        value={value.content}
        onChange={(patch) => setValue((old) => ({ ...old, content: { ...old.content, ...patch } }))}
        editorKey={editorKey}
        onUploadingChange={setUploading}
        onInvalidChange={setInvalidBody}
        save={save}
        onReload={reload}
        publicPath={path}
      >
        <section className="space-y-4 border border-neutral-200 bg-white p-4">
          {!item && (
            <>
              <SelectField
                label="テンプレート"
                value={value.templateId}
                onChange={(event) => {
                  const templateId = event.target.value
                  const template = templates.find((template) => template.id === templateId)
                  const sections =
                    template?.sections.map((section) => ({
                      ...section,
                      id: crypto.randomUUID(),
                    })) ?? null
                  setValue((old) => ({ ...old, templateId, sections }))
                }}
              >
                <option value="richtext">リッチテキスト（セクションなし）</option>
                {templates.map((template) => (
                  <option key={template.id} value={template.id}>
                    {template.name} — {template.description}
                  </option>
                ))}
              </SelectField>
              {value.sections && (
                <p className="text-xs text-neutral-600">
                  セクション構成:{' '}
                  {value.sections
                    .map(
                      (section) =>
                        catalog.data?.items.find((entry) => entry.type === section.type)?.label ??
                        section.type,
                    )
                    .join(' / ')}
                  。作成後はカスタマイズ画面で内容を編集できます。
                </p>
              )}
            </>
          )}
          <SelectField
            label="親ページ"
            name="parentId"
            error={errors.parentId}
            value={value.parentId ?? ''}
            onChange={(event) => {
              const parentId = event.target.value ? Number(event.target.value) : null
              setValue((old) => ({ ...old, parentId }))
            }}
          >
            <option value="">なし</option>
            {flattenPageTree(pages)
              .filter(({ page }) => !excluded.has(page.id))
              .map(({ page, depth }) => (
                <option key={page.id} value={page.id}>
                  {'—'.repeat(depth)} {page.title}
                </option>
              ))}
          </SelectField>
          <TextField
            label="表示順"
            name="sortOrder"
            type="number"
            error={errors.sortOrder}
            value={value.sortOrder}
            onChange={(event) => {
              const sortOrder = Number(event.target.value)
              setValue((old) => ({ ...old, sortOrder }))
            }}
          />
        </section>
      </ContentForm>
    </ContentRecordFrame>
  )
}
