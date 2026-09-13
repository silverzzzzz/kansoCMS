export function formatDate(date: Date, options: { locale: string; timeZone: string }): string {
  return new Intl.DateTimeFormat(options.locale, {
    dateStyle: 'long',
    timeZone: options.timeZone,
  }).format(date)
}
