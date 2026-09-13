type TreeItem = {
  id: number
  parentId: number | null
  sortOrder: number
  title: string
}

export function flattenPageTree<T extends TreeItem>(items: T[]): { page: T; depth: number }[] {
  const ids = new Set(items.map((item) => item.id))
  const children = new Map<number | null, T[]>()
  for (const item of items) {
    const parentId = item.parentId !== null && ids.has(item.parentId) ? item.parentId : null
    const group = children.get(parentId) ?? []
    group.push(item)
    children.set(parentId, group)
  }
  for (const group of children.values()) {
    group.sort((a, b) => a.sortOrder - b.sortOrder || a.title.localeCompare(b.title, 'ja'))
  }

  const result: { page: T; depth: number }[] = []
  const visited = new Set<number>()
  function visit(parentId: number | null, depth: number) {
    for (const page of children.get(parentId) ?? []) {
      if (visited.has(page.id)) continue
      visited.add(page.id)
      result.push({ page, depth })
      visit(page.id, depth + 1)
    }
  }
  visit(null, 0)
  for (const page of items) {
    if (visited.has(page.id)) continue
    result.push({ page, depth: 0 })
  }
  return result
}

export function descendantIds<T extends Pick<TreeItem, 'id' | 'parentId'>>(
  items: T[],
  id: number,
): Set<number> {
  const result = new Set<number>([id])
  let changed = true
  while (changed) {
    changed = false
    for (const item of items) {
      if (item.parentId !== null && result.has(item.parentId) && !result.has(item.id)) {
        result.add(item.id)
        changed = true
      }
    }
  }
  return result
}
