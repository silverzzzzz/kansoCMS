import { formFieldListSchema } from '@kanso/shared'
import { describe, expect, it } from 'vitest'
import { buildSubmissionsCsv } from './csv.ts'

const fields = formFieldListSchema.parse([
  { type: 'text', name: 'name', label: 'Name' },
  { type: 'textarea', name: 'message', label: 'Message, body' },
  { type: 'checkbox', name: 'consent', label: 'Consent' },
  { type: 'text', name: 'missing', label: 'Missing' },
])

describe('buildSubmissionsCsv', () => {
  it('builds a BOM-prefixed CRLF file in field-definition order', () => {
    const csv = buildSubmissionsCsv(fields, [
      {
        id: 12,
        createdAt: new Date('2026-09-15T01:02:03.000Z'),
        readAt: null,
        dataJson: {
          consent: true,
          message: 'First, "quoted" line\nSecond line',
          name: 'Alice',
        },
      },
    ])

    expect(csv).toBe(
      '\uFEFFid,createdAt,readAt,Name,"Message, body",Consent,Missing\r\n' +
        '12,2026-09-15T01:02:03.000Z,,Alice,"First, ""quoted"" line\nSecond line",true,\r\n',
    )
    expect(csv.replaceAll('\r\n', '')).not.toContain('\r')
  })

  it('guards formulas while leaving numeric and phone-like values unchanged', () => {
    const field = fields[0]
    if (!field) throw new Error('Expected a test field')
    const csv = buildSubmissionsCsv(
      [field],
      [
        {
          id: 1,
          createdAt: new Date('2026-09-15T00:00:00.000Z'),
          readAt: new Date('2026-09-15T00:01:00.000Z'),
          dataJson: { name: '=HYPERLINK("https://bad.example")' },
        },
        {
          id: 2,
          createdAt: new Date('2026-09-15T00:02:00.000Z'),
          readAt: null,
          dataJson: { name: '+81 (3) 1234-5678' },
        },
        {
          id: 3,
          createdAt: new Date('2026-09-15T00:03:00.000Z'),
          readAt: null,
          dataJson: { name: ' trailing ' },
        },
      ],
    )

    expect(csv).toContain('"\'=HYPERLINK(""https://bad.example"")"')
    expect(csv).toContain(',+81 (3) 1234-5678\r\n')
    expect(csv).toContain('," trailing "\r\n')
  })
})
