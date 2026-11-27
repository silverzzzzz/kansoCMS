import { useIsMutating, useQuery } from '@tanstack/react-query'
import { useRef } from 'react'
import { api } from '../../api/client.ts'
import { categoriesQuery, type PostItem, type PostTypeItem, tagsQuery } from '../../api/queries.ts'
import { unwrap } from '../../api/request.ts'
import {
  contentErrors,
  contentPayload,
  contentValue,
  type PostDraft,
  parsePostDraft,
} from '../../lib/content-values.ts'
import { flattenPageTree } from '../../lib/page-tree.ts'
import { defaultSettings, SectionSettingsForm } from '../customize/SectionSettingsForm.tsx'
import { MediaField } from '../media/MediaField.tsx'
import { TagInput, tagCreationKey } from '../TagInput.tsx'
import { ContentForm } from './ContentForm.tsx'
import { ContentRecordFrame } from './ContentRecordFrame.tsx'
import { useContentRecord } from './useContentRecord.ts'

export function PostContentEditor({
  type,
  item,
  reload,
}: {
  type: PostTypeItem
  item?: PostItem
  reload?: () => Promise<void>
}) {
  const tags = useQuery(tagsQuery())
  const creatingTag = useIsMutating({ mutationKey: tagCreationKey }) > 0
  const categories = useQuery(categoriesQuery(type.id))
  const fieldDefs = type.fieldsJson ?? []
  const storedTime = useRef(item?.publishedAt ?? null)
  const { value, setValue, save, editorKey, setUploading, setInvalidBody } =
    useContentRecord<PostDraft>({
      kind: 'post',
      item,
      resource: item ? `post:${item.id}` : `post:new:${type.id}`,
      parse: parsePostDraft,
      initial: () => ({
        content: contentValue(item),
        coverMediaId: item?.coverMediaId ?? null,
        categoryIds: item?.categoryIds ?? [],
        tagIds: item?.tagIds ?? [],
        pinned: item?.pinned ?? false,
        fields: { ...defaultSettings(fieldDefs), ...item?.fieldsJson },
      }),
      write: async (draft, baseUpdatedAt) => {
        if (creatingTag) throw new Error('タグの追加が完了してから保存してください。')
        const { content, ...meta } = draft
        const json = { ...contentPayload(content, storedTime.current), ...meta }
        const result = item
          ? await unwrap(
              api.posts[':id'].$patch({
                param: { id: String(item.id) },
                json: { ...json, baseUpdatedAt },
              }),
            )
          : await unwrap(api.posts.$post({ json: { ...json, postTypeId: type.id } }))
        storedTime.current = result.item.publishedAt
        return {
          id: result.item.id,
          updatedAt: result.item.updatedAt,
          content: contentValue({ ...result.item, bodyJson: content.bodyJson }),
        }
      },
    })
  const errors = contentErrors(save.error)
  const customErrors = Object.fromEntries(
    Object.entries(errors)
      .filter(([key]) => key.startsWith('fields.'))
      .map(([key, message]) => [key.slice(7), message]),
  )
  const categoryRows = flattenPageTree(
    (categories.data?.items ?? []).map((category) => ({ ...category, title: category.name })),
  )
  const change = (patch: Partial<PostDraft>) => setValue((old) => ({ ...old, ...patch }))
  return (
    <ContentRecordFrame
      kind="post"
      item={item}
      heading={item ? '投稿を編集' : `${type.name}を作成`}
      typeSlug={type.slug}
      publicPath={item && `/${type.slug}/${item.slug}`}
      save={save}
      reload={reload}
    >
      <ContentForm
        kind="post"
        creating={!item}
        value={value.content}
        onChange={(patch) => setValue((old) => ({ ...old, content: { ...old.content, ...patch } }))}
        editorKey={editorKey}
        onUploadingChange={setUploading}
        onInvalidChange={setInvalidBody}
        save={save}
        onReload={reload}
        publicPath={`/${type.slug}/${value.content.slug}`}
      >
        <section className="space-y-4 border border-neutral-200 bg-white p-4">
          <MediaField
            label="カバー画像"
            error={errors.coverMediaId}
            value={value.coverMediaId}
            onChange={(coverMediaId) => change({ coverMediaId })}
          />
          <div>
            <label className="flex items-center gap-2 text-sm font-medium text-neutral-800">
              <input
                type="checkbox"
                checked={value.pinned}
                onChange={(event) => change({ pinned: event.target.checked })}
              />
              一覧の先頭に固定
            </label>
            <p className="mt-1 text-xs text-neutral-600">
              アーカイブやホームの一覧で、公開日時より先に表示されます。
            </p>
          </div>
          {type.hasCategories && (
            <fieldset>
              <legend className="text-sm font-medium">カテゴリ</legend>
              <div className="mt-2 space-y-2">
                {categoryRows.map(({ page, depth }) => (
                  <label
                    key={page.id}
                    className="flex items-center gap-2 text-sm"
                    style={{ marginLeft: `${depth * 1.25}rem` }}
                  >
                    <input
                      type="checkbox"
                      checked={value.categoryIds.includes(page.id)}
                      onChange={(event) =>
                        change({
                          categoryIds: event.target.checked
                            ? [...value.categoryIds, page.id]
                            : value.categoryIds.filter((id) => id !== page.id),
                        })
                      }
                    />
                    {page.name}
                  </label>
                ))}
              </div>
            </fieldset>
          )}
          {type.hasTags && (
            <TagInput
              value={(tags.data?.items ?? []).filter((tag) => value.tagIds.includes(tag.id))}
              onChange={(selected) => change({ tagIds: selected.map((tag) => tag.id) })}
            />
          )}
        </section>
        {fieldDefs.length > 0 && (
          <section className="border border-neutral-200 bg-white p-4">
            <h2 className="mb-4 text-sm font-semibold">カスタムフィールド</h2>
            <SectionSettingsForm
              fields={fieldDefs}
              values={value.fields}
              errors={customErrors}
              onChange={(name, next) =>
                setValue((old) => ({ ...old, fields: { ...old.fields, [name]: next } }))
              }
            />
          </section>
        )}
      </ContentForm>
    </ContentRecordFrame>
  )
}
