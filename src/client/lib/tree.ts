export interface TreeDir<T> {
  name: string;
  dirs: Map<string, TreeDir<T>>;
  files: Array<{ name: string; item: T }>;
}

export function buildTree<T>(items: T[], pathOf: (t: T) => string): TreeDir<T> {
  const root: TreeDir<T> = { name: '', dirs: new Map(), files: [] };
  for (const item of items) {
    const parts = pathOf(item).split('/');
    const fileName = parts.pop() ?? '';
    let node = root;
    for (const part of parts) {
      let child = node.dirs.get(part);
      if (!child) {
        child = { name: part, dirs: new Map(), files: [] };
        node.dirs.set(part, child);
      }
      node = child;
    }
    node.files.push({ name: fileName, item });
  }
  compress(root);
  return root;
}

function compress<T>(node: TreeDir<T>): void {
  const merged = new Map<string, TreeDir<T>>();
  for (let dir of node.dirs.values()) {
    while (dir.files.length === 0 && dir.dirs.size === 1) {
      const child = [...dir.dirs.values()][0]!;
      child.name = `${dir.name}/${child.name}`;
      dir = child;
    }
    compress(dir);
    merged.set(dir.name, dir);
  }
  node.dirs = merged;
}
