export type TreeNode = {
  id: number
  slug: string
  parentId: number | null
}

export function hasAncestorCycle(
  nodes: Pick<TreeNode, 'id' | 'parentId'>[],
  id: number,
  parentId: number | null,
): boolean {
  const parents = new Map(nodes.map((node) => [node.id, node.parentId]))
  parents.set(id, parentId)

  const visited = new Set<number>()
  let currentId = parentId
  while (currentId !== null) {
    if (currentId === id || visited.has(currentId)) return true
    visited.add(currentId)
    currentId = parents.get(currentId) ?? null
  }
  return false
}

export function computePaths(nodes: TreeNode[]): Map<number, string> {
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const paths = new Map<number, string>()
  const visiting = new Set<number>()

  function visit(node: TreeNode): string {
    const knownPath = paths.get(node.id)
    if (knownPath !== undefined) return knownPath
    if (visiting.has(node.id)) throw new Error('Page tree contains a cycle')

    visiting.add(node.id)
    const parent = node.parentId === null ? undefined : byId.get(node.parentId)
    if (node.parentId !== null && !parent) throw new Error('Page tree contains a missing parent')

    const path = parent ? `${visit(parent)}/${node.slug}` : node.slug
    visiting.delete(node.id)
    paths.set(node.id, path)
    return path
  }

  for (const node of nodes) visit(node)
  return paths
}
