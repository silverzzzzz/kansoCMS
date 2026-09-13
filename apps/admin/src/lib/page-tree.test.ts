import { describe, expect, it } from 'vitest'
import { descendantIds, flattenPageTree } from './page-tree.ts'

const items = [
  { id: 3, parentId: 1, sortOrder: 0, title: 'Team' },
  { id: 2, parentId: null, sortOrder: 0, title: 'About' },
  { id: 1, parentId: null, sortOrder: 1, title: 'Company' },
  { id: 4, parentId: 99, sortOrder: 2, title: 'Orphan' },
]

describe('page tree helpers', () => {
  it('sorts roots and descends into children', () => {
    expect(flattenPageTree(items).map(({ page, depth }) => [page.id, depth])).toEqual([
      [2, 0],
      [1, 0],
      [3, 1],
      [4, 0],
    ])
  })

  it('returns the selected item and all descendants', () => {
    expect([...descendantIds(items, 1)]).toEqual([1, 3])
  })
})
