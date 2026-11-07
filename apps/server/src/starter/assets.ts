import type { Bindings } from '../env.ts'

/**
 * Read a bundled starter image (`public/starter/<name>`) through the Static
 * Assets binding, which serves the same files in `vite dev` and on Workers.
 */
export function starterImageLoader(env: Bindings, requestUrl: string) {
  return async (name: string): Promise<ArrayBuffer> => {
    // A plain URL string keeps this file type-compatible with the admin app's
    // DOM lib, which sees it through the hc client types.
    const url = new URL(`/starter/${encodeURIComponent(name)}`, requestUrl).toString()
    const response = await env.ASSETS.fetch(url)
    if (!response.ok) {
      throw new Error(`Starter image ${name} is not available (HTTP ${response.status})`)
    }
    return response.arrayBuffer()
  }
}
