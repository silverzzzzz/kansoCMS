import { defineConfig, envField } from 'astro/config'

export default defineConfig({
  output: 'static',
  env: {
    schema: {
      KANSO_API_URL: envField.string({ context: 'server', access: 'public' }),
      KANSO_API_KEY: envField.string({ context: 'server', access: 'secret' }),
      KANSO_POST_TYPE: envField.string({ context: 'server', access: 'public', default: 'blog' }),
      PUBLIC_SITE_TITLE: envField.string({
        context: 'client',
        access: 'public',
        default: 'kansoCMS blog',
      }),
    },
  },
})
