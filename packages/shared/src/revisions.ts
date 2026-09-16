import { z } from 'zod'
import { pageFieldsSchema } from './pages.ts'
import { postFieldsSchema } from './posts.ts'

export const REVISION_TARGETS = ['page', 'post'] as const
export type RevisionTarget = (typeof REVISION_TARGETS)[number]
export const revisionTargetSchema = z.enum(REVISION_TARGETS)

export const pageRevisionSnapshotSchema = pageFieldsSchema
export const postRevisionSnapshotSchema = postFieldsSchema.omit({ postTypeId: true })

export type PageRevisionSnapshot = z.infer<typeof pageRevisionSnapshotSchema>
export type PostRevisionSnapshot = z.infer<typeof postRevisionSnapshotSchema>
