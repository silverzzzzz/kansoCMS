import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { z } from 'zod'
import type { Db } from '../db/client.ts'
import { cacheVersionService } from './cache-version.ts'

const settingsMock = vi.hoisted(() => {
  let value: unknown
  return {
    reset() {
      value = undefined
    },
    get: vi.fn(async (_key: string, schema: z.ZodType) => schema.parse(value ?? {})),
    set: vi.fn(async (_key: string, schema: z.ZodType, next: unknown) => {
      value = schema.parse(next)
      return value
    }),
  }
})

vi.mock('./settings.ts', () => ({ settingsService: () => settingsMock }))

describe('cacheVersionService', () => {
  beforeEach(() => {
    settingsMock.reset()
    vi.clearAllMocks()
  })

  it("returns '0' before the first bump", async () => {
    const service = cacheVersionService(Object.create(null) as Db)

    await expect(service.get()).resolves.toBe('0')
  })

  it('bumps to a fresh 16-character hexadecimal token and persists it', async () => {
    const service = cacheVersionService(Object.create(null) as Db)
    const previous = await service.get()
    const version = await service.bump()

    expect(version).toMatch(/^[0-9a-f]{16}$/)
    expect(version).not.toBe(previous)
    await expect(service.get()).resolves.toBe(version)
  })
})
