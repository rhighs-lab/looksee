import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { extname } from 'node:path';
import type { Language, Node } from '@vscode/tree-sitter-wasm';
import TreeSitter from '@vscode/tree-sitter-wasm';
import type { CodeSymbol, FileSymbols } from '../../shared/protocol.js';

const require = createRequire(import.meta.url);
const languages: Record<string, string> = {
  ts: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  tsx: 'tsx',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  py: 'python',
  go: 'go',
  rs: 'rust',
  java: 'java',
  cs: 'c-sharp',
  c: 'cpp',
  h: 'cpp',
  cpp: 'cpp',
  hpp: 'cpp',
  cc: 'cpp',
  rb: 'ruby',
  php: 'php',
  sh: 'bash',
  bash: 'bash',
};
const grammars = new Map<string, Promise<Language>>();
const cache = new Map<string, FileSymbols>();
let initialized: Promise<void> | undefined;
const kinds: Record<string, CodeSymbol['kind']> = {
  class_declaration: 'class',
  class_definition: 'class',
  class_specifier: 'class',
  class: 'class',
  interface_declaration: 'interface',
  struct_item: 'class',
  struct_specifier: 'class',
  impl_item: 'class',
  enum_declaration: 'type',
  enum_item: 'type',
  type_alias_declaration: 'type',
  type_item: 'type',
  function_declaration: 'function',
  function_definition: 'function',
  function_item: 'function',
  method_definition: 'method',
  method_declaration: 'method',
  method: 'method',
  singleton_method: 'method',
  constructor_declaration: 'method',
  generator_function_declaration: 'function',
  type_spec: 'type',
  trait_item: 'interface',
};

function declaration(
  node: Node
): { name: string; kind: CodeSymbol['kind'] } | null {
  let kind = kinds[node.type];
  let name = node.childForFieldName('name');
  if (node.type === 'impl_item') name = node.childForFieldName('type');
  if (
    node.type === 'variable_declarator' ||
    node.type === 'public_field_definition' ||
    node.type === 'pair'
  ) {
    const value = node.childForFieldName('value');
    if (
      !value ||
      !['arrow_function', 'function_expression', 'function'].includes(
        value.type
      )
    )
      return null;
    kind = 'function';
    name ??= node.childForFieldName('key');
  }
  if (!kind) return null;
  if (!name) {
    let declarator = node.childForFieldName('declarator');
    while (declarator?.childForFieldName('declarator'))
      declarator = declarator.childForFieldName('declarator');
    name = declarator;
  }
  return name ? { name: name.text, kind } : null;
}

/** Parse the exact blob being displayed, never a second read of the worktree. */
export async function extractSymbols(
  path: string,
  source: string
): Promise<FileSymbols> {
  const language = languages[extname(path).slice(1).toLowerCase()];
  if (!language) return { status: 'unsupported', symbols: [] };
  if (Buffer.byteLength(source) > 1_048_576)
    return { status: 'too-large', symbols: [] };
  const key = `${language}:${createHash('sha256').update(source).digest('hex')}`;
  const cached = cache.get(key);
  if (cached) {
    cache.delete(key);
    cache.set(key, cached);
    return cached;
  }
  let parser: InstanceType<typeof TreeSitter.Parser> | undefined;
  let tree: ReturnType<InstanceType<typeof TreeSitter.Parser>['parse']> = null;
  try {
    initialized ??= TreeSitter.Parser.init();
    await initialized;
    let grammar = grammars.get(language);
    if (!grammar) {
      grammar = TreeSitter.Language.load(
        require.resolve(
          `@vscode/tree-sitter-wasm/wasm/tree-sitter-${language}.wasm`
        )
      );
      grammars.set(language, grammar);
      grammar.catch(() => grammars.delete(language));
    }
    parser = new TreeSitter.Parser();
    parser.setLanguage(await grammar);
    parser.setTimeoutMicros(100_000);
    tree = parser.parse(source);
    if (!tree) return { status: 'unavailable', symbols: [] };
    const symbols: CodeSymbol[] = [];
    const sourceLines = source.split(/\r?\n/);
    const pending: { node: Node; parentId: string | null }[] = [
      { node: tree.rootNode, parentId: null },
    ];
    let visited = 0;
    while (pending.length) {
      if (++visited > 100_000 || symbols.length >= 2_000)
        return { status: 'too-large', symbols: [] };
      const current = pending.pop()!;
      const { node } = current;
      let { parentId } = current;
      const found = declaration(node);
      if (found) {
        const id = `${node.startIndex}:${node.type}`;
        symbols.push({
          id,
          parentId,
          ...found,
          startLine: node.startPosition.row + 1,
          endLine: Math.max(
            node.startPosition.row + 1,
            node.endPosition.row + (node.endPosition.column > 0 ? 1 : 0)
          ),
          signature: sourceLines[node.startPosition.row]!.trim().slice(0, 240),
        });
        parentId = id;
      }
      for (let i = node.namedChildCount - 1; i >= 0; i--) {
        const child = node.namedChild(i);
        if (child) pending.push({ node: child, parentId });
      }
    }
    const result: FileSymbols = { status: 'ready', symbols };
    cache.set(key, result);
    if (cache.size > 32) cache.delete(cache.keys().next().value!);
    return result;
  } catch {
    return { status: 'unavailable', symbols: [] };
  } finally {
    tree?.delete();
    parser?.delete();
  }
}
