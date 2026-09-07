import { expect, it } from 'vitest';
import { scopeChain } from '@/client/lib/scope-chain.js';
import type { CodeSymbol } from '@/shared/protocol.js';

const symbols: CodeSymbol[] = [
  {
    id: 'class',
    parentId: null,
    kind: 'class',
    name: 'Panel',
    signature: 'class Panel {',
    startLine: 2,
    endLine: 20,
  },
  {
    id: 'method',
    parentId: 'class',
    kind: 'method',
    name: 'render',
    signature: 'render() {',
    startLine: 5,
    endLine: 10,
  },
  {
    id: 'next',
    parentId: 'class',
    kind: 'method',
    name: 'next',
    signature: 'next() {',
    startLine: 12,
    endLine: 16,
  },
];
it('enters nested scopes and drops them at their exact end', () => {
  const names = (line: number) => scopeChain(symbols, line).map((s) => s.name);
  expect(names(1)).toEqual([]);
  expect(names(2)).toEqual([]);
  expect(names(5)).toEqual(['Panel']);
  expect(names(6)).toEqual(['Panel', 'render']);
  expect(names(10)).toEqual(['Panel', 'render']);
  expect(names(11)).toEqual(['Panel']);
  expect(names(13)).toEqual(['Panel', 'next']);
  expect(names(21)).toEqual([]);
});
