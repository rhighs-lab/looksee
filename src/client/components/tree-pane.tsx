import {
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  Check,
  ChevronDown,
  Close,
  Folder,
  FolderOpen,
  Search,
} from '@/client/components/icons.js';
import type { TreeDir } from '@/client/lib/tree.js';
import { useReview } from '@/client/store/review.js';

const W_MIN = 180;
const wMax = () => Math.min(800, Math.round(window.innerWidth * 0.6));

export interface TreeSearch {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}

export function TreePane({
  header,
  search,
  children,
}: {
  header: string;
  search?: TreeSearch;
  children: ReactNode;
}) {
  const hidden = useReview((s) => s.treeHidden);
  const width = useReview((s) => s.treeWidth);
  const setWidth = useReview((s) => s.setTreeWidth);
  const paneRef = useRef<HTMLElement>(null);
  const [dragging, setDragging] = useState(false);

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return;
      e.preventDefault();
      const startX = e.clientX;
      const startW = paneRef.current?.getBoundingClientRect().width ?? 300;
      setDragging(true);
      document.body.style.userSelect = 'none';
      document.body.style.cursor = 'col-resize';
      let last = startW;
      const move = (ev: MouseEvent) => {
        last = Math.max(
          W_MIN,
          Math.min(wMax(), Math.round(startW + ev.clientX - startX))
        );
        paneRef.current?.style.setProperty('width', `${last}px`);
      };
      const up = () => {
        document.removeEventListener('mousemove', move);
        document.removeEventListener('mouseup', up);
        document.body.style.userSelect = '';
        document.body.style.cursor = '';
        setDragging(false);
        setWidth(last);
      };
      document.addEventListener('mousemove', move);
      document.addEventListener('mouseup', up);
    },
    [setWidth]
  );

  if (hidden) return null;
  return (
    <>
      <aside
        className="file-tree-pane"
        ref={paneRef}
        style={width ? { width } : undefined}
        aria-label={header}
      >
        <div className="tree-header">{header}</div>
        {search && (
          <div className="tree-search">
            <Search className="tree-search-icon" width={14} height={14} />
            <input
              type="text"
              className="tree-search-input"
              placeholder={search.placeholder}
              spellCheck={false}
              autoComplete="off"
              aria-label={search.placeholder}
              value={search.value}
              onChange={(e) => search.onChange(e.target.value)}
              onKeyDown={(e) => e.key === 'Escape' && search.onChange('')}
            />
            {search.value && (
              <button
                type="button"
                className="tree-search-clear"
                data-tooltip="Clear filter"
                aria-label="Clear filter"
                onClick={() => search.onChange('')}
              >
                <Close />
              </button>
            )}
          </div>
        )}
        <nav className="file-tree">{children}</nav>
      </aside>
      <div
        className={`tree-resizer${dragging ? ' is-dragging' : ''}`}
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize file pane"
        aria-valuenow={width ?? 0}
        tabIndex={0}
        title="Drag to resize, double-click to reset"
        onMouseDown={onMouseDown}
        onDoubleClick={() => setWidth(null)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowLeft' || e.key === 'ArrowRight')
            setWidth(
              (width ?? paneRef.current?.offsetWidth ?? 0) +
                (e.key === 'ArrowLeft' ? -16 : 16)
            );
        }}
      />
    </>
  );
}

export function TreeDirNode<T>({
  node,
  depth,
  renderFile,
}: {
  node: TreeDir<T>;
  depth: number;
  renderFile: (item: T, name: string, depth: number) => ReactNode;
}) {
  const dirs = [...node.dirs.values()].sort((a, b) =>
    a.name.localeCompare(b.name)
  );
  const files = [...node.files].sort((a, b) => a.name.localeCompare(b.name));
  return (
    <>
      {dirs.map((dir) => (
        <TreeDirRow
          key={dir.name}
          dir={dir}
          depth={depth}
          renderFile={renderFile}
        />
      ))}
      {files.map(({ name, item }) => renderFile(item, name, depth))}
    </>
  );
}

function TreeDirRow<T>({
  dir,
  depth,
  renderFile,
}: {
  dir: TreeDir<T>;
  depth: number;
  renderFile: (item: T, name: string, depth: number) => ReactNode;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div className={`tree-dir${open ? '' : ' is-collapsed'}`}>
      <button
        type="button"
        className="tree-row tree-dir-row"
        style={{ paddingLeft: 8 + depth * 14 }}
        onClick={() => setOpen(!open)}
        aria-expanded={open}
      >
        <ChevronDown className="tree-chevron" width={12} height={12} />
        {open ? (
          <FolderOpen className="tree-folder-icon" />
        ) : (
          <Folder className="tree-folder-icon" />
        )}
        <span className="tree-name">{dir.name}</span>
      </button>
      <div className="tree-children">
        <TreeDirNode node={dir} depth={depth + 1} renderFile={renderFile} />
      </div>
    </div>
  );
}

export function useSubnavHeight(): void {
  useEffect(() => {
    const sync = () => {
      const el = document.querySelector<HTMLElement>('.pr-subnav');
      if (el)
        document.documentElement.style.setProperty(
          '--subnav-h',
          `${el.getBoundingClientRect().height}px`
        );
    };
    sync();
    const ro = new ResizeObserver(sync);
    const el = document.querySelector('.pr-subnav');
    if (el) ro.observe(el);
    window.addEventListener('resize', sync);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', sync);
    };
  }, []);
}

export const TreeCheck = () => (
  <span className="tree-check" aria-hidden="true">
    <Check />
  </span>
);
