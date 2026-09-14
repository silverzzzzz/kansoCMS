import type {
  CreateFormInput,
  FormField,
  SubmissionMeta,
  SubmissionValues,
  UpdateFormInput,
} from '@kanso/shared'
import { submissionSchemaFor } from '@kanso/shared'
import type { SQL } from 'drizzle-orm'
import { and, asc, count, desc, eq, isNotNull, isNull, sql } from 'drizzle-orm'
import type { Db } from '../db/client.ts'
import { formSubmissions, forms } from '../db/schema/index.ts'
import { isUniqueViolation, KansoError } from '../errors.ts'

export type FormContext = { turnstileAvailable: boolean }

type SubmissionListInput = {
  formId: number
  page?: number
  perPage?: number
  unread?: boolean
}

function throwFormConflict(error: unknown): never {
  if (isUniqueViolation(error)) {
    throw KansoError.conflict('Form slug already exists')
  }
  throw error
}

function assertTurnstileAvailable(turnstile: boolean, context: FormContext): void {
  if (turnstile && !context.turnstileAvailable) {
    throw KansoError.validation('Turnstile is not configured')
  }
}

function validationIssues(issues: readonly { path: readonly PropertyKey[]; message: string }[]) {
  return issues.map((issue) => ({
    path: issue.path.map(String).join('.'),
    message: issue.message,
  }))
}

function submissionMeta(value: Record<string, unknown>): SubmissionMeta {
  const item = (key: keyof SubmissionMeta) => {
    const current = value[key]
    return typeof current === 'string' ? current : null
  }
  return {
    ip: item('ip'),
    userAgent: item('userAgent'),
    referrer: item('referrer'),
    country: item('country'),
  }
}

export function formsService(db: Db) {
  async function list() {
    const [formRows, counts] = await Promise.all([
      db
        .select({
          id: forms.id,
          slug: forms.slug,
          name: forms.name,
          notifyTo: forms.notifyTo,
          turnstile: forms.turnstile,
          createdAt: forms.createdAt,
          updatedAt: forms.updatedAt,
        })
        .from(forms)
        .orderBy(asc(forms.name), asc(forms.id)),
      db
        .select({
          formId: formSubmissions.formId,
          submissionCount: count(),
          unreadCount:
            sql<number>`count(case when ${formSubmissions.readAt} is null then 1 end)`.mapWith(
              Number,
            ),
        })
        .from(formSubmissions)
        .groupBy(formSubmissions.formId),
    ])
    const countByForm = new Map(counts.map((row) => [row.formId, row]))
    return formRows.map((form) => ({
      ...form,
      submissionCount: countByForm.get(form.id)?.submissionCount ?? 0,
      unreadCount: countByForm.get(form.id)?.unreadCount ?? 0,
    }))
  }

  async function get(id: number) {
    const form = await db.query.forms.findFirst({ where: eq(forms.id, id) })
    if (!form) throw KansoError.notFound('Form')
    return form
  }

  async function findBySlug(slug: string) {
    return db.query.forms.findFirst({ where: eq(forms.slug, slug) })
  }

  async function create(input: CreateFormInput, context: FormContext) {
    const turnstile = input.turnstile ?? false
    assertTurnstileAvailable(turnstile, context)
    try {
      const [created] = await db
        .insert(forms)
        .values({
          slug: input.slug,
          name: input.name,
          fieldsJson: input.fields,
          notifyTo: input.notifyTo ?? '',
          successMessage: input.successMessage ?? '',
          redirectUrl: input.redirectUrl ?? null,
          turnstile,
        })
        .returning({ id: forms.id })
      if (!created) throw new Error('Form insert did not return a row')
      return get(created.id)
    } catch (error) {
      throwFormConflict(error)
    }
  }

  async function update(id: number, input: UpdateFormInput, context: FormContext) {
    const current = await get(id)
    assertTurnstileAvailable(input.turnstile ?? current.turnstile, context)

    const values: Partial<typeof forms.$inferInsert> = { updatedAt: new Date() }
    if (input.slug !== undefined) values.slug = input.slug
    if (input.name !== undefined) values.name = input.name
    if (input.fields !== undefined) values.fieldsJson = input.fields
    if (input.notifyTo !== undefined) values.notifyTo = input.notifyTo
    if (input.successMessage !== undefined) values.successMessage = input.successMessage
    if (input.redirectUrl !== undefined) values.redirectUrl = input.redirectUrl
    if (input.turnstile !== undefined) values.turnstile = input.turnstile

    try {
      await db.update(forms).set(values).where(eq(forms.id, id))
      return get(id)
    } catch (error) {
      throwFormConflict(error)
    }
  }

  async function deleteForm(id: number): Promise<void> {
    await get(id)
    await db.delete(forms).where(eq(forms.id, id))
  }

  function validateSubmission(
    form: { fieldsJson: FormField[] },
    raw: Record<string, unknown>,
  ): SubmissionValues {
    const result = submissionSchemaFor(form.fieldsJson).safeParse(raw)
    if (!result.success) {
      throw KansoError.validation('Invalid submission', validationIssues(result.error.issues))
    }
    return result.data
  }

  async function listSubmissions(input: SubmissionListInput) {
    await get(input.formId)
    const page = input.page ?? 1
    const perPage = input.perPage ?? 20
    const conditions: SQL[] = [eq(formSubmissions.formId, input.formId)]
    if (input.unread === true) conditions.push(isNull(formSubmissions.readAt))
    if (input.unread === false) conditions.push(isNotNull(formSubmissions.readAt))
    const where = and(...conditions)

    const [items, totals] = await Promise.all([
      db.query.formSubmissions.findMany({
        where,
        orderBy: [desc(formSubmissions.createdAt), desc(formSubmissions.id)],
        limit: perPage,
        offset: (page - 1) * perPage,
      }),
      db.select({ value: count() }).from(formSubmissions).where(where),
    ])
    return { items, total: totals[0]?.value ?? 0 }
  }

  async function getSubmission(formId: number, id: number) {
    const submission = await db.query.formSubmissions.findFirst({
      where: and(eq(formSubmissions.formId, formId), eq(formSubmissions.id, id)),
    })
    if (!submission) throw KansoError.notFound('Form submission')
    return { ...submission, metaJson: submissionMeta(submission.metaJson) }
  }

  async function listSubmissionsForExport(formId: number) {
    await get(formId)
    const rows = await db.query.formSubmissions.findMany({
      where: eq(formSubmissions.formId, formId),
      orderBy: [asc(formSubmissions.createdAt), asc(formSubmissions.id)],
      limit: 10_000,
    })
    return rows
  }

  async function createSubmission(formId: number, values: SubmissionValues, meta: SubmissionMeta) {
    const [created] = await db
      .insert(formSubmissions)
      .values({ formId, dataJson: values, metaJson: meta })
      .returning({ id: formSubmissions.id })
    if (!created) throw new Error('Form submission insert did not return a row')
    return getSubmission(formId, created.id)
  }

  async function markSubmissionRead(formId: number, id: number, read: boolean) {
    await getSubmission(formId, id)
    await db
      .update(formSubmissions)
      .set({ readAt: read ? new Date() : null })
      .where(and(eq(formSubmissions.formId, formId), eq(formSubmissions.id, id)))
    return getSubmission(formId, id)
  }

  async function deleteSubmission(formId: number, id: number): Promise<void> {
    await getSubmission(formId, id)
    await db
      .delete(formSubmissions)
      .where(and(eq(formSubmissions.formId, formId), eq(formSubmissions.id, id)))
  }

  return {
    list,
    get,
    findBySlug,
    create,
    update,
    delete: deleteForm,
    validateSubmission,
    submissions: {
      list: listSubmissions,
      listForExport: listSubmissionsForExport,
      get: getSubmission,
      create: createSubmission,
      markRead: markSubmissionRead,
      delete: deleteSubmission,
    },
  }
}

export type FormsService = ReturnType<typeof formsService>
