import { formFieldListSchema } from '@kanso/shared'
import { describe, expect, it } from 'vitest'
import { buildSubmissionNotification } from './notification.ts'

const fields = formFieldListSchema.parse([
  { type: 'text', name: 'name', label: 'Name <required>' },
  { type: 'textarea', name: 'message', label: 'Message' },
  { type: 'checkbox', name: 'consent', label: 'I agree' },
  { type: 'checkbox', name: 'updates', label: 'Updates' },
  { type: 'text', name: 'missing', label: 'Missing' },
])

describe('buildSubmissionNotification', () => {
  it('builds ordered, escaped text and HTML bodies', () => {
    const notification = buildSubmissionNotification({
      form: { name: 'Contact & Support', fields },
      values: {
        name: `<script>alert("x")</script> & 'q'`,
        message: 'First line\nSecond line',
        consent: true,
        updates: false,
      },
      submissionId: 42,
      siteTitle: 'Example <Site>',
      adminUrl: 'https://example.com/admin/forms/7/submissions/42',
    })

    expect(notification.subject).toBe('[Example <Site>] Contact & Support')
    expect(notification.text).toBe(
      [
        `Name <required>: <script>alert("x")</script> & 'q'`,
        'Message: First line\nSecond line',
        'I agree: Yes',
        'Updates: No',
        'Missing: ',
        '',
        'Submission #42',
        'https://example.com/admin/forms/7/submissions/42',
      ].join('\n'),
    )
    expect(notification.html).toContain('<!doctype html>')
    expect(notification.html).toContain('<meta charset="utf-8">')
    expect(notification.html).toContain('<h1>Contact &amp; Support</h1>')
    expect(notification.html).toContain('Name &lt;required&gt;')
    expect(notification.html).toContain(
      '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;q&#39;',
    )
    expect(notification.html).toContain('First line<br>Second line')
    expect(notification.html.indexOf('I agree')).toBeLessThan(notification.html.indexOf('Updates'))
    expect(notification.html).toContain('<td>Yes</td>')
    expect(notification.html).toContain('<td>No</td>')
    expect(notification.html).toContain('https://example.com/admin/forms/7/submissions/42')
    expect(notification.html).not.toContain('<script>')
  })
})
