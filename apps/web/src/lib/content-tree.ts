/**
 * A LET’S Draw AI space's content as a tree (escopo-mvp 5.1): the API answers a flat list, siblings in
 * order; the panel nests it, filters it, and works out where a dragged item lands.
 */
export type TreeNode = { id: string; parentId: string | null; title: string; position: number; kind?: string }
export type TreeItem<T extends TreeNode> = T & { children: TreeItem<T>[] }

/** Nests the list; a page whose parent is gone sits at the top rather than vanishing. */
export const buildTree = <T extends TreeNode>(nodes: readonly T[]): TreeItem<T>[] => {
  const items = new Map(nodes.map((node) => [node.id, { ...node, children: [] as TreeItem<T>[] }]))
  const roots: TreeItem<T>[] = []
  for (const node of [...nodes].sort((a, b) => a.position - b.position)) {
    const item = items.get(node.id) as TreeItem<T>
    const parent = node.parentId ? items.get(node.parentId) : undefined
    ;(parent ? parent.children : roots).push(item)
  }
  return roots
}

/** The item and everything below it — none of which it may be moved under. */
export const descendantsOf = (nodes: readonly TreeNode[], id: string): Set<string> => {
  const found = new Set([id])
  let grew = true
  while (grew) {
    grew = false
    for (const node of nodes.filter((each) => each.parentId && found.has(each.parentId) && !found.has(each.id))) {
      found.add(node.id)
      grew = true
    }
  }
  return found
}

/** The items above this one, top first: its path in the tree. */
export const ancestorsOf = <T extends TreeNode>(nodes: readonly T[], id: string): T[] => {
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const path: T[] = []
  for (let current = byId.get(id)?.parentId; current; current = byId.get(current)?.parentId) {
    const node = byId.get(current)
    if (!node || path.includes(node)) {
      break
    }
    path.unshift(node)
  }
  return path
}

export type DropZone = 'before' | 'inside' | 'after'

/**
 * Where an item dropped on another goes: inside it as the last child, or next to it among its
 * siblings. Nothing when the drop would put it under itself, or inside a whiteboard.
 *
 * @example dropTarget(nodes, 'b', 'a', 'inside')   // { parentId: 'a', index: <children of a> }
 */
export const dropTarget = (
  nodes: readonly TreeNode[],
  dragged: string,
  target: string,
  zone: DropZone
): { parentId: string | null; index: number } | undefined => {
  const over = nodes.find((node) => node.id === target)
  if (!over || descendantsOf(nodes, dragged).has(target) || (zone === 'inside' && over.kind === 'whiteboard')) {
    return undefined
  }
  const parentId = zone === 'inside' ? over.id : over.parentId
  const siblings = nodes
    .filter((node) => node.parentId === parentId && node.id !== dragged)
    .sort((a, b) => a.position - b.position)
  if (zone === 'inside') {
    return { parentId, index: siblings.length }
  }
  const at = siblings.findIndex((node) => node.id === over.id)
  return { parentId, index: zone === 'before' ? at : at + 1 }
}

/**
 * The tree narrowed to what matches: items whose title holds the text (accents ignored) and are of a
 * kind shown — kept with the folders above them, so each match is still where it lives.
 */
export const filterTree = <T extends TreeNode>(nodes: readonly T[], text: string, kinds: ReadonlySet<string>): T[] => {
  const wanted = _normal(text.trim())
  if (!wanted && kinds.size === 0) {
    return [...nodes]
  }
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const keep = new Set<string>()
  for (const node of nodes.filter((each) => _matches(each, wanted, kinds))) {
    for (
      let current: T | undefined = node;
      current && !keep.has(current.id);
      current = byId.get(current.parentId ?? '')
    ) {
      keep.add(current.id)
    }
  }
  return nodes.filter((node) => keep.has(node.id))
}

const _normal = (text: string) =>
  text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()

const _matches = (node: TreeNode, wanted: string, kinds: ReadonlySet<string>) =>
  (!wanted || _normal(node.title).includes(wanted)) && (kinds.size === 0 || kinds.has(node.kind ?? ''))
