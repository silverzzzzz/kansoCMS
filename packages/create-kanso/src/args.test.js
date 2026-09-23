import { describe, expect, it } from 'vitest'
import { deriveName, parseArgs, resolveOptions, validateName, validateSiteUrl } from './args.js'

describe('arguments', () => {
  it('resolves noninteractive defaults', () => {
    expect(resolveOptions(parseArgs([]))).toEqual({
      dir: 'my-site',
      name: 'my-site',
      d1: 'my-site',
      r2: 'my-site-media',
      siteUrl: 'https://example.com',
      ref: 'main',
      force: false,
      git: true,
      yes: false,
      help: false,
      version: false,
    })
  })
  it('accepts every option and an explicit directory', () => {
    expect(
      resolveOptions(
        parseArgs([
          'folder',
          '--site-url',
          'http://localhost:5199',
          '--name',
          'worker',
          '--d1',
          'database',
          '--r2',
          'media',
          '--ref',
          'refs/heads/test',
          '--from',
          './checkout',
          '--force',
          '--no-git',
          '--yes',
          '--help',
          '--version',
        ]),
      ),
    ).toEqual({
      dir: 'folder',
      name: 'worker',
      d1: 'database',
      r2: 'media',
      ref: 'refs/heads/test',
      from: './checkout',
      force: true,
      git: false,
      yes: true,
      help: true,
      version: true,
      siteUrl: 'http://localhost:5199',
    })
  })
  it.each(['--unknown', '-x'])('rejects unknown flag %s with usage', (arg) => {
    expect(() => parseArgs([arg])).toThrow(/Unknown option:.*\n\nUsage:/)
  })
  it.each(['--site-url', '--name', '--d1', '--r2', '--ref', '--from'])(
    'requires a value for %s',
    (flag) => {
      expect(() => parseArgs([flag])).toThrow('Missing value')
      expect(() => parseArgs([flag, '--yes'])).toThrow('Missing value')
    },
  )
  it('rejects extra or empty directories', () => {
    expect(() => parseArgs(['one', 'two'])).toThrow('Only one directory')
    expect(() => resolveOptions(parseArgs(['']))).toThrow('must not be empty')
  })
  it('derives names and uses the override for resource defaults', () => {
    expect(deriveName('Some DIR___---Name!')).toBe('some-dir-name')
    expect(resolveOptions(parseArgs(['日本語', '--name', 'site']))).toMatchObject({
      d1: 'site',
      r2: 'site-media',
    })
    expect(() => deriveName('日本語')).toThrow('Worker name')
    expect(() => deriveName('---')).toThrow('Worker name')
  })
  it.each(['', '-bad', 'Upper', 'under_score', 'a'.repeat(64)])(
    'rejects invalid worker name %s',
    (name) => {
      expect(() => validateName(name)).toThrow('Worker name')
    },
  )
  it('accepts names at the specified boundaries', () => {
    expect(validateName('0')).toBe('0')
    expect(validateName('a'.repeat(63))).toHaveLength(63)
    expect(validateName('trailing-')).toBe('trailing-')
  })
  it.each(['ftp://example.com', '/relative', 'example.com', '', 'https://'])(
    'rejects invalid site URL %s',
    (url) => {
      expect(() => validateSiteUrl(url)).toThrow('http(s)')
    },
  )
  it.each(['https://example.test', 'http://localhost:5199/path'])('accepts URL %s', (url) => {
    expect(validateSiteUrl(url)).toBe(url)
  })
})
