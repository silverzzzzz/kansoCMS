// The e2e program has no @types/node (it would leak into the browser-facing
// packages), so declare the little of Node it uses.
declare module 'node:child_process' {
  export function execFileSync(
    file: string,
    args: readonly string[],
    options: { encoding: 'utf8' },
  ): string
}

declare const process: { execPath: string }
