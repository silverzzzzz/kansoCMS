import { describe, expect, it } from 'vitest'
import { computePaths, hasAncestorCycle, type TreeNode } from './page-tree.ts'

const tree: TreeNode[] = [
  { id: 1, slug: 'company', parentId: null },
  { id: 2, slug: 'team', parentId: 1 },
  { id: 3, slug: 'engineering', parentId: 2 },
  { id: 4, slug: 'contact', parentId: null },
]

describe('computePaths', () => {
  it('computes paths through three levels', () => {
    expect(Object.fromEntries(computePaths(tree))).toEqual({
      1: 'company',
      2: 'company/team',
      3: 'company/team/engineering',
      4: 'contact',
    })
  })

  it('recomputes descendants after a parent change', () => {
    const moved = tree.map((node) => (node.id === 2 ? { ...node, parentId: 4 } : node))
    expect(computePaths(moved).get(3)).toBe('contact/team/engineering')
  })

  it('detects ancestor cycles', () => {
    expect(hasAncestorCycle(tree, 1, 3)).toBe(true)
    const cyclic = tree.map((node) => (node.id === 1 ? { ...node, parentId: 3 } : node))
    expect(() => computePaths(cyclic)).toThrow('Page tree contains a cycle')
  })
})
