import {
  type PageRevisionSnapshot,
  type PostRevisionSnapshot,
  pageRevisionSnapshotSchema,
  postRevisionSnapshotSchema,
  type RevisionTarget,
} from '@kanso/shared'
import { and, desc, eq, notInArray } from 'drizzle-orm'
import type { Db } from '../db/client.ts'
import { revisions, users } from '../db/schema/index.ts'
import { KansoError } from '../errors.ts'

export const REVISIONS_PER_TARGET = 20

type RevisionSnapshot = PageRevisionSnapshot | PostRevisionSnapshot

function parseSnapshot(target: RevisionTarget, snapshot: unknown): RevisionSnapshot {
  const result =
    target === 'page'
      ? pageRevisionSnapshotSchema.safeParse(snapshot)
      : postRevisionSnapshotSchema.safeParse(snapshot)
  if (!result.success) throw KansoError.validation('Revision snapshot is invalid')
  return result.data
}

export function revisionsService(db: Db) {
  function recordStatements(
    target: RevisionTarget,
    targetId: number,
    snapshot: RevisionSnapshot,
    userId: number | null,
  ) {
    const newestIds = db
      .select({ id: revisions.id })
      .from(revisions)
      .where(and(eq(revisions.targetType, target), eq(revisions.targetId, targetId)))
      .orderBy(desc(revisions.createdAt), desc(revisions.id))
      .limit(REVISIONS_PER_TARGET)

    return [
      db.insert(revisions).values({ targetType: target, targetId, snapshotJson: snapshot, userId }),
      db
        .delete(revisions)
        .where(
          and(
            eq(revisions.targetType, target),
            eq(revisions.targetId, targetId),
            notInArray(revisions.id, newestIds),
          ),
        ),
    ] as const
  }

  function deleteStatement(target: RevisionTarget, targetId: number) {
    return db
      .delete(revisions)
      .where(and(eq(revisions.targetType, target), eq(revisions.targetId, targetId)))
  }

  async function list(target: RevisionTarget, targetId: number) {
    const rows = await db
      .select({
        id: revisions.id,
        createdAt: revisions.createdAt,
        userId: users.id,
        userName: users.name,
        snapshot: revisions.snapshotJson,
      })
      .from(revisions)
      .leftJoin(users, eq(revisions.userId, users.id))
      .where(and(eq(revisions.targetType, target), eq(revisions.targetId, targetId)))
      .orderBy(desc(revisions.createdAt), desc(revisions.id))
      .limit(REVISIONS_PER_TARGET)

    return rows.map((row) => {
      const snapshot = parseSnapshot(target, row.snapshot)
      return {
        id: row.id,
        createdAt: row.createdAt,
        user: row.userId === null ? null : { id: row.userId, name: row.userName ?? '' },
        title: snapshot.title,
        status: snapshot.status,
      }
    })
  }

  async function get(target: RevisionTarget, targetId: number, revisionId: number) {
    const [row] = await db
      .select({
        id: revisions.id,
        createdAt: revisions.createdAt,
        userId: users.id,
        userName: users.name,
        snapshot: revisions.snapshotJson,
      })
      .from(revisions)
      .leftJoin(users, eq(revisions.userId, users.id))
      .where(
        and(
          eq(revisions.id, revisionId),
          eq(revisions.targetType, target),
          eq(revisions.targetId, targetId),
        ),
      )
      .limit(1)
    if (!row) throw KansoError.notFound('Revision')

    return {
      id: row.id,
      createdAt: row.createdAt,
      user: row.userId === null ? null : { id: row.userId, name: row.userName ?? '' },
      snapshot: parseSnapshot(target, row.snapshot),
    }
  }

  return { recordStatements, deleteStatement, list, get }
}

export type RevisionsService = ReturnType<typeof revisionsService>
