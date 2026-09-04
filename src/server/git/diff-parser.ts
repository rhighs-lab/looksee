import crypto from 'node:crypto';
import type {
  ChangeKind,
  DiffLine,
  FileDiff,
  Hunk,
} from '@/shared/protocol.js';

const EXT_LANG: Record<string, string> = {
  // web
  ts: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  tsx: 'tsx',
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  jsx: 'jsx',
  vue: 'vue',
  svelte: 'svelte',
  astro: 'astro',
  html: 'html',
  htm: 'html',
  xhtml: 'html',
  css: 'css',
  scss: 'scss',
  sass: 'sass',
  less: 'less',
  styl: 'stylus',
  postcss: 'postcss',
  // data and config
  json: 'json',
  jsonc: 'jsonc',
  json5: 'json5',
  jsonl: 'json',
  ndjson: 'json',
  yml: 'yaml',
  yaml: 'yaml',
  toml: 'toml',
  ini: 'ini',
  cfg: 'ini',
  conf: 'ini',
  properties: 'ini',
  env: 'dotenv',
  xml: 'xml',
  svg: 'xml',
  plist: 'xml',
  csv: 'csv',
  tsv: 'csv',
  proto: 'proto',
  graphql: 'graphql',
  gql: 'graphql',
  prisma: 'prisma',
  hcl: 'hcl',
  tf: 'terraform',
  tfvars: 'terraform',
  // shell and ops
  sh: 'bash',
  bash: 'bash',
  zsh: 'bash',
  ksh: 'bash',
  fish: 'fish',
  ps1: 'powershell',
  psm1: 'powershell',
  bat: 'bat',
  cmd: 'bat',
  awk: 'awk',
  nix: 'nix',
  // systems
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  cxx: 'cpp',
  cc: 'cpp',
  hpp: 'cpp',
  hxx: 'cpp',
  hh: 'cpp',
  ino: 'cpp',
  rs: 'rust',
  go: 'go',
  zig: 'zig',
  d: 'd',
  nim: 'nim',
  v: 'v',
  asm: 'asm',
  s: 'asm',
  wat: 'wasm',
  wasm: 'wasm',
  // jvm and .net
  java: 'java',
  kt: 'kotlin',
  kts: 'kotlin',
  scala: 'scala',
  sc: 'scala',
  groovy: 'groovy',
  gradle: 'groovy',
  clj: 'clojure',
  cljs: 'clojure',
  cljc: 'clojure',
  cs: 'csharp',
  fs: 'fsharp',
  fsx: 'fsharp',
  vb: 'vb',
  // scripting
  py: 'python',
  pyi: 'python',
  pyw: 'python',
  rb: 'ruby',
  rake: 'ruby',
  gemspec: 'ruby',
  erb: 'erb',
  php: 'php',
  lua: 'lua',
  luau: 'luau',
  pl: 'perl',
  pm: 'perl',
  raku: 'perl',
  tcl: 'tcl',
  r: 'r',
  jl: 'julia',
  dart: 'dart',
  swift: 'swift',
  m: 'objective-c',
  mm: 'objective-cpp',
  ex: 'elixir',
  exs: 'elixir',
  erl: 'erlang',
  hrl: 'erlang',
  hs: 'haskell',
  lhs: 'haskell',
  elm: 'elm',
  ml: 'ocaml',
  mli: 'ocaml',
  purs: 'purescript',
  rkt: 'racket',
  scm: 'scheme',
  ss: 'scheme',
  lisp: 'common-lisp',
  el: 'lisp',
  cr: 'crystal',
  gleam: 'gleam',
  hx: 'haxe',
  sol: 'solidity',
  move: 'move',
  // query and markup
  sql: 'sql',
  psql: 'sql',
  plsql: 'plsql',
  md: 'markdown',
  markdown: 'markdown',
  mdx: 'mdx',
  rst: 'rst',
  adoc: 'asciidoc',
  asciidoc: 'asciidoc',
  tex: 'latex',
  latex: 'latex',
  bib: 'bibtex',
  wiki: 'wikitext',
  // build and misc
  cmake: 'cmake',
  mk: 'make',
  make: 'make',
  bzl: 'python',
  diff: 'diff',
  patch: 'diff',
  log: 'log',
  http: 'http',
  ipynb: 'json',
  vim: 'viml',
  applescript: 'applescript',
  liquid: 'liquid',
  hbs: 'handlebars',
  handlebars: 'handlebars',
  pug: 'pug',
  jade: 'pug',
  twig: 'twig',
  njk: 'jinja',
  jinja: 'jinja',
  j2: 'jinja',
  razor: 'razor',
  blade: 'blade',
  sv: 'system-verilog',
  vhd: 'vhdl',
  vhdl: 'vhdl',
  glsl: 'glsl',
  hlsl: 'hlsl',
  wgsl: 'wgsl',
  metal: 'cpp',
  gdscript: 'gdscript',
  gd: 'gdscript',
};

// files whose language lives in the name rather than an extension
const NAME_LANG: Record<string, string> = {
  dockerfile: 'docker',
  containerfile: 'docker',
  makefile: 'make',
  gnumakefile: 'make',
  'cmakelists.txt': 'cmake',
  'cargo.lock': 'toml',
  gemfile: 'ruby',
  rakefile: 'ruby',
  podfile: 'ruby',
  vagrantfile: 'ruby',
  brewfile: 'ruby',
  'build.gradle': 'groovy',
  'go.sum': 'log',
  '.gitattributes': 'ini',
  '.env': 'dotenv',
  '.editorconfig': 'ini',
  '.bashrc': 'bash',
  '.zshrc': 'bash',
  '.profile': 'bash',
  '.bash_profile': 'bash',
};

export function inferLanguage(p: string | null): string | null {
  if (!p) return null;
  const base = (p.split('/').pop() ?? '').toLowerCase();
  const byName = NAME_LANG[base];
  if (byName) return byName;
  // Dockerfile.dev, Makefile.local and friends carry the name as the stem
  const stem = base.split('.')[0] ?? '';
  if (stem && !base.startsWith('.') && NAME_LANG[stem]) return NAME_LANG[stem]!;
  const dot = base.lastIndexOf('.');
  const ext = dot > 0 ? base.slice(dot + 1) : '';
  return EXT_LANG[ext] ?? null;
}

export type ParsedFile = Omit<
  FileDiff,
  'rev' | 'oldRev' | 'newLineCount' | 'truncated'
>;

function stripPrefix(p: string): string | null {
  if (p === '/dev/null') return null;
  return p.replace(/^[abciw]\//, '');
}

function parseHunkHeader(line: string): Omit<Hunk, 'lines'> | null {
  const m = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/.exec(line);
  if (!m) return null;
  return {
    oldStart: parseInt(m[1]!, 10),
    oldLines: m[2] == null ? 1 : parseInt(m[2], 10),
    newStart: parseInt(m[3]!, 10),
    newLines: m[4] == null ? 1 : parseInt(m[4], 10),
    sectionHeading: (m[5] ?? '').replace(/^\s/, ''),
    header: line,
  };
}

const isFileStart = (l: string) => l.startsWith('diff ');

export function parsePatch(patch: string): ParsedFile[] {
  const lines = patch.split('\n');
  const files: ParsedFile[] = [];
  let i = 0;
  while (i < lines.length) {
    const start = lines[i]!;
    if (!start.startsWith('diff --git')) {
      i++;
      continue;
    }
    const sectionStart = i;
    let oldPath: string | null = null;
    let newPath: string | null = null;
    let kind: ChangeKind = 'modified';
    let binary = false;
    const dg = /^diff --git a\/(.*) b\/(.*)$/.exec(start);
    if (dg) {
      oldPath = dg[1]!;
      newPath = dg[2]!;
    }
    i++;
    while (
      i < lines.length &&
      !lines[i]!.startsWith('@@') &&
      !isFileStart(lines[i]!)
    ) {
      const l = lines[i]!;
      if (l.startsWith('new file mode')) kind = 'added';
      else if (l.startsWith('deleted file mode')) kind = 'deleted';
      else if (l.startsWith('rename from ')) {
        kind = 'renamed';
        oldPath = l.slice('rename from '.length);
      } else if (l.startsWith('rename to ')) {
        kind = 'renamed';
        newPath = l.slice('rename to '.length);
      } else if (l.startsWith('copy from ')) {
        kind = 'copied';
        oldPath = l.slice('copy from '.length);
      } else if (l.startsWith('copy to ')) {
        kind = 'copied';
        newPath = l.slice('copy to '.length);
      } else if (
        l.startsWith('Binary files') ||
        l.startsWith('GIT binary patch')
      )
        binary = true;
      else if (l.startsWith('--- ')) {
        const p = stripPrefix(l.slice(4).trim());
        if (p !== null) oldPath = p;
        else if (kind === 'modified') kind = 'added';
      } else if (l.startsWith('+++ ')) {
        const p = stripPrefix(l.slice(4).trim());
        if (p !== null) newPath = p;
        else if (kind === 'modified') kind = 'deleted';
      }
      i++;
    }

    const hunks: Hunk[] = [];
    let cur: Hunk | null = null;
    let oldNo = 0;
    let newNo = 0;
    let additions = 0;
    let deletions = 0;
    while (i < lines.length && !isFileStart(lines[i]!)) {
      const l = lines[i]!;
      if (l.startsWith('@@')) {
        const h = parseHunkHeader(l);
        if (h) {
          cur = { ...h, lines: [] };
          hunks.push(cur);
          oldNo = h.oldStart;
          newNo = h.newStart;
        }
        i++;
        continue;
      }
      if (!cur || l.startsWith('\\')) {
        i++;
        continue;
      }
      const marker = l[0];
      const content = l.slice(1);
      let dl: DiffLine | null = null;
      if (marker === '+') {
        dl = { type: 'add', oldNumber: null, newNumber: newNo++, content };
        additions++;
      } else if (marker === '-') {
        dl = { type: 'del', oldNumber: oldNo++, newNumber: null, content };
        deletions++;
      } else if (marker === ' ') {
        dl = {
          type: 'context',
          oldNumber: oldNo++,
          newNumber: newNo++,
          content,
        };
      }
      if (dl) cur.lines.push(dl);
      i++;
    }

    const raw = lines.slice(sectionStart, i).join('\n');
    const finalNew = newPath ?? oldPath ?? '';
    const finalOld = oldPath ?? newPath ?? '';
    const path = kind === 'deleted' ? finalOld : finalNew;
    files.push({
      path,
      oldPath: finalOld !== path ? finalOld : kind === 'deleted' ? null : null,
      kind,
      binary,
      language: inferLanguage(path),
      additions,
      deletions,
      hunks,
      digest: crypto.createHash('sha1').update(raw).digest('hex').slice(0, 16),
    });
  }
  return files;
}
