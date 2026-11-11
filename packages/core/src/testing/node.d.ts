// The slice of Node's API the test database needs. Declared here instead of
// installing @types/node, which would leak Node globals into every workspace
// program that imports core (the admin bundle included).

// Same shape as vite/client declares, so the two can meet in one program.
interface ImportMeta {
  url: string
}

declare module 'node:fs' {
  export function readdirSync(path: URL): string[]
  export function readFileSync(path: URL, encoding: 'utf8'): string
}

declare module 'node:sqlite' {
  export class StatementSync {
    all(...params: unknown[]): unknown[]
    setReturnArrays(enabled: boolean): void
  }

  export class DatabaseSync {
    constructor(path: string)
    exec(sql: string): void
    prepare(sql: string): StatementSync
    function(
      name: string,
      options: { varargs?: boolean; deterministic?: boolean },
      fn: (...args: unknown[]) => unknown,
    ): void
    close(): void
  }
}
