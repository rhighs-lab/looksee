import { describe, expect, it } from 'vitest';
import { extractSymbols } from '@/server/code/symbols.js';

describe('Tree-sitter symbols', () => {
  it('finds nested TSX scopes, arrows, types and exact ranges', async () => {
    const result = await extractSymbols(
      'panel.tsx',
      [
        'export interface Props { title: string }',
        'export class Panel {',
        '  render() {',
        '    const item = () => {',
        '      return <span>hello</span>;',
        '    };',
        '    return item();',
        '  }',
        '}',
        'export const Label = () => <span />;',
        'export type Key = string;',
      ].join('\n')
    );
    expect(result.status).toBe('ready');
    expect(result.symbols.map((s) => s.name)).toEqual([
      'Props',
      'Panel',
      'render',
      'item',
      'Label',
      'Key',
    ]);
    const [, panel, render, item] = result.symbols;
    expect(panel).toMatchObject({
      kind: 'class',
      startLine: 2,
      endLine: 9,
      parentId: null,
    });
    expect(render).toMatchObject({
      startLine: 3,
      endLine: 8,
      parentId: panel?.id,
    });
    expect(item).toMatchObject({
      startLine: 4,
      endLine: 6,
      parentId: render?.id,
    });
  });

  it.each([
    [
      'a.py',
      'class Worker:\n    def run(self):\n        return 1\n',
      ['Worker', 'run'],
    ],
    ['a.go', 'package a\nfunc run() {\n println("ok")\n}\n', ['run']],
    [
      'a.rs',
      'struct Worker {}\nimpl Worker {\n fn run(&self) {}\n}',
      ['Worker', 'Worker', 'run'],
    ],
    ['a.java', 'class Worker { void run() {} }', ['Worker', 'run']],
    ['a.cs', 'class Worker { void Run() {} }', ['Worker', 'Run']],
    ['a.cpp', 'class Worker { void run() {} };', ['Worker', 'run']],
    ['a.rb', 'class Worker\n  def run\n    1\n  end\nend', ['Worker', 'run']],
    ['a.php', '<?php class Worker { function run() {} }', ['Worker', 'run']],
    ['a.sh', 'run() {\n echo ok\n}', ['run']],
  ])('extracts declarations from %s', async (file, source, names) => {
    const result = await extractSymbols(file, source);
    expect(result.status).toBe('ready');
    expect(result.symbols.map((s) => s.name)).toEqual(names);
  });

  it('keeps line numbers with unicode and CRLF, and ignores strings and comments', async () => {
    const result = await extractSymbols(
      'a.js',
      '// function fake() {}\r\nconst text = "class Fake {} é";\r\nfunction café() {\r\n return text;\r\n}\r\n'
    );
    expect(result.symbols.filter((s) => s.kind === 'function')).toMatchObject([
      { name: 'café', startLine: 3, endLine: 5 },
    ]);
    expect(result.symbols.some((s) => ['fake', 'Fake'].includes(s.name))).toBe(
      false
    );
  });

  it('handles unfinished edits and separates cached file contents', async () => {
    const first = await extractSymbols('a.ts', 'function before() {}');
    const second = await extractSymbols(
      'a.ts',
      'function after() {\n return 1;'
    );
    expect(first.symbols[0]?.name).toBe('before');
    expect(second.status).toBe('ready');
    expect(second.symbols.some((s) => s.name === 'before')).toBe(false);
  });

  it('reports unsupported, empty, and oversized files without guessing', async () => {
    expect((await extractSymbols('a.txt', 'function fake() {}')).status).toBe(
      'unsupported'
    );
    expect(await extractSymbols('empty.ts', '')).toMatchObject({
      status: 'ready',
      symbols: [],
    });
    expect(
      (await extractSymbols('huge.ts', ' '.repeat(1_048_577))).status
    ).toBe('too-large');
  });
});
