import type { CodeSymbol } from '@/shared/protocol.js';

/** Only enclosing declarations that have scrolled out of view are sticky. */
export function scopeChain(symbols: CodeSymbol[], line: number): CodeSymbol[] {
  const byId = new Map(symbols.map((symbol) => [symbol.id, symbol]));
  const current = symbols
    .filter((s) => s.startLine < line && s.endLine >= line)
    .sort((a, b) => b.startLine - a.startLine || a.endLine - b.endLine)[0];
  const chain: CodeSymbol[] = [];
  let symbol = current;
  while (symbol) {
    if (symbol.startLine < line && symbol.endLine >= line)
      chain.unshift(symbol);
    symbol = symbol.parentId ? byId.get(symbol.parentId) : undefined;
  }
  // Leave room for code even in deeply nested files.
  return chain.length > 3 ? [chain[0]!, ...chain.slice(-2)] : chain;
}
