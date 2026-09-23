import { gzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { readTarGz } from './tar.js'

/** @param {{name: string, type?: string, body?: string, prefix?: string}[]} entries */
export function archive(entries) {
  const blocks = []
  for (const { name, type = '0', body = '', prefix = '' } of entries) {
    const data = Buffer.from(body)
    const header = Buffer.alloc(512)
    header.write(name, 0, 100)
    header.write('0000644\0', 100)
    header.write(`${data.length.toString(8).padStart(11, '0')}\0`, 124)
    header.write(type, 156)
    header.write('ustar\0', 257)
    header.write('00', 263)
    header.write(prefix, 345, 155)
    header.fill(32, 148, 156)
    const checksum = header.reduce((sum, byte) => sum + byte, 0)
    header.write(`${checksum.toString(8).padStart(6, '0')}\0 `, 148)
    blocks.push(header, data, Buffer.alloc((512 - (data.length % 512)) % 512))
  }
  return gzipSync(Buffer.concat([...blocks, Buffer.alloc(1024)]))
}

describe('ustar reader', () => {
  it('skips metadata and links, strips the root and omits task boards', () => {
    const entries = readTarGz(
      archive([
        { name: 'pax_global_header', type: 'g', body: 'metadata' },
        { name: 'repo/', type: '5' },
        { name: 'repo/nested/', type: '5' },
        { name: 'repo/nested/file.txt', body: 'hello' },
        { name: 'file.txt', prefix: 'repo/prefix', type: '\0', body: 'prefix' },
        { name: 'repo/docs/tasks/', type: '5' },
        { name: 'repo/docs/tasks/phase-3.md', body: 'board' },
        { name: 'repo/docs/architecture.md', body: 'architecture' },
        { name: 'repo/extended', type: 'x', body: 'pax' },
        { name: 'repo/link', type: '2' },
        { name: 'repo/hardlink', type: '1' },
      ]),
    )
    expect(entries).toEqual(
      new Map([
        ['nested', null],
        ['nested/file.txt', Buffer.from('hello')],
        ['prefix/file.txt', Buffer.from('prefix')],
        ['docs/architecture.md', Buffer.from('architecture')],
      ]),
    )
  })
  it.each([
    '../escape',
    'repo/../escape',
    'repo/nested/../../escape',
    '/absolute',
    'C:/escape',
    'repo/C:/escape',
    'repo/..\\escape',
  ])('rejects unsafe path %s before root stripping', (name) => {
    expect(() => readTarGz(archive([{ name, body: 'bad' }]))).toThrow('Unsafe template path')
  })
  it('rejects traversal in a ustar prefix', () => {
    expect(() => readTarGz(archive([{ name: 'escape', prefix: 'repo/..' }]))).toThrow(
      'Unsafe template path',
    )
  })
  it('rejects truncated data and invalid sizes', () => {
    const header = Buffer.alloc(512)
    header.write('repo/file')
    header.write('00000002000\0', 124)
    expect(() => readTarGz(gzipSync(header))).toThrow('Truncated tar entry')
    header.write('not-octal!!!', 124)
    expect(() => readTarGz(gzipSync(header))).toThrow('Invalid tar entry size')
    expect(() => readTarGz(gzipSync(Buffer.alloc(10)))).toThrow('Truncated tar header')
  })
})
