const GRID = 5;
const HALF = Math.ceil(GRID / 2);

const hash = (s: string): number => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
};

export interface Identicon {
  hue: number;
  cells: boolean[];
}

export function identicon(seed: string): Identicon {
  const h = hash(seed);
  const cells: boolean[] = new Array(GRID * GRID).fill(false);
  let bits = h;
  for (let y = 0; y < GRID; y++) {
    for (let x = 0; x < HALF; x++) {
      bits = Math.imul(bits, 1103515245) + 12345;
      const on = ((bits >>> 16) & 1) === 1;
      cells[y * GRID + x] = on;
      cells[y * GRID + (GRID - 1 - x)] = on;
    }
  }
  return { hue: h % 360, cells };
}
