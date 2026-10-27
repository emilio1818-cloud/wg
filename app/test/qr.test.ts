/**
 * Tests for the QR generator. No QR library is available, so this file carries its own
 * minimal decoder for clean synthetic matrices. It deliberately uses its own reference
 * tables (ISO/IEC 18004 values for format info, version info, alignment positions,
 * block structure, capacities) and its own GF(256) / BCH arithmetic, so the generator is
 * checked against the standard rather than against itself.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { qrEncode, qrMatrix, qrSvg, qrSvgPath } from '../src/lib/qr.ts';
import type { QrEcc } from '../src/lib/qr.ts';

type Matrix = readonly (readonly boolean[])[];
type Pos = [row: number, col: number];

const LEVELS: readonly QrEcc[] = ['L', 'M', 'Q', 'H'];
const rank = (ecc: QrEcc): number => LEVELS.indexOf(ecc);

// ---------------------------------------------------------------------------
// Reference data (ISO/IEC 18004)
// ---------------------------------------------------------------------------

/** Format information after masking with 0x5412, bit 14 first (ISO 18004 Annex C). */
const FORMAT_TABLE: Record<QrEcc, readonly string[]> = {
  L: ['111011111000100', '111001011110011', '111110110101010', '111100010011101', '110011000101111', '110001100011000', '110110001000001', '110100101110110'],
  M: ['101010000010010', '101000100100101', '101111001111100', '101101101001011', '100010111111001', '100000011001110', '100111110010111', '100101010100000'],
  Q: ['011010101011111', '011000001101000', '011111100110001', '011101000000110', '010010010110100', '010000110000011', '010111011011010', '010101111101101'],
  H: ['001011010001001', '001001110111110', '001110011100111', '001100111010000', '000011101100010', '000001001010101', '000110100001100', '000100000111011'],
};

/** Version information for versions 7–40 (ISO 18004 Annex D). */
const VERSION_TABLE: readonly number[] = [
  0x07c94, 0x085bc, 0x09a99, 0x0a4d3, 0x0bbf6, 0x0c762, 0x0d847, 0x0e60d, 0x0f928, 0x10b78, 0x1145d, 0x12a17,
  0x13532, 0x149a6, 0x15683, 0x168c9, 0x177ec, 0x18ec4, 0x191e1, 0x1afab, 0x1b08e, 0x1cc1a, 0x1d33f, 0x1ed75,
  0x1f250, 0x209d5, 0x216f0, 0x228ba, 0x2379f, 0x24b0b, 0x2542e, 0x26a64, 0x27541, 0x28c69,
];

/** Alignment pattern centre coordinates per version (ISO 18004 Annex E). */
const ALIGNMENT_TABLE: readonly (readonly number[])[] = [
  [], [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50],
  [6, 30, 54], [6, 32, 58], [6, 34, 62], [6, 26, 46, 66], [6, 26, 48, 70], [6, 26, 50, 74], [6, 30, 54, 78],
  [6, 30, 56, 82], [6, 30, 58, 86], [6, 34, 62, 90], [6, 28, 50, 72, 94], [6, 26, 50, 74, 98],
  [6, 30, 54, 78, 102], [6, 28, 54, 80, 106], [6, 32, 58, 84, 110], [6, 30, 58, 86, 114], [6, 34, 62, 90, 118],
  [6, 26, 50, 74, 98, 122], [6, 30, 54, 78, 102, 126], [6, 26, 52, 78, 104, 130], [6, 30, 56, 82, 108, 134],
  [6, 34, 60, 86, 112, 138], [6, 30, 58, 86, 114, 142], [6, 34, 62, 90, 118, 146], [6, 30, 54, 78, 102, 126, 150],
  [6, 24, 50, 76, 102, 128, 154], [6, 28, 54, 80, 106, 132, 158], [6, 32, 58, 84, 110, 136, 162],
  [6, 26, 54, 82, 110, 138, 166], [6, 30, 58, 86, 114, 142, 170],
];

/** Total codewords (data + ECC) per version. */
const TOTAL_CODEWORDS: readonly number[] = [
  0, 26, 44, 70, 100, 134, 172, 196, 242, 292, 346, 404, 466, 532, 581, 655, 733, 815, 901, 991, 1085, 1156,
  1258, 1364, 1474, 1588, 1706, 1828, 1921, 2051, 2185, 2323, 2465, 2611, 2761, 2876, 3034, 3196, 3362, 3532, 3706,
];

/** Leftover modules after the last full codeword. */
const REMAINDER_BITS: readonly number[] = [
  0, 0, 7, 7, 7, 7, 7, 0, 0, 0, 0, 0, 0, 0, 3, 3, 3, 3, 3, 3, 3, 4, 4, 4, 4, 4, 4, 4, 3, 3, 3, 3, 3, 3, 3, 0, 0, 0, 0, 0, 0,
];

/** Error correction blocks: "<number of blocks>x<ECC codewords per block>" for L, M, Q, H. */
const EC_BLOCKS_TEXT = `
 1: 1x7    1x10   1x13   1x17
 2: 1x10   1x16   1x22   1x28
 3: 1x15   1x26   2x18   2x22
 4: 1x20   2x18   2x26   4x16
 5: 1x26   2x24   4x18   4x22
 6: 2x18   4x16   4x24   4x28
 7: 2x20   4x18   6x18   5x26
 8: 2x24   4x22   6x22   6x26
 9: 2x30   5x22   8x20   8x24
10: 4x18   5x26   8x24   8x28
11: 4x20   5x30   8x28   11x24
12: 4x24   8x22   10x26  11x28
13: 4x26   9x22   12x24  16x22
14: 4x30   9x24   16x20  16x24
15: 6x22   10x24  12x30  18x24
16: 6x24   10x28  17x24  16x30
17: 6x28   11x28  16x28  19x28
18: 6x30   13x26  18x28  21x28
19: 7x28   14x26  21x26  25x26
20: 8x28   16x26  20x30  25x28
21: 8x28   17x26  23x28  25x30
22: 9x28   17x28  23x30  34x24
23: 9x30   18x28  25x30  30x30
24: 10x30  20x28  27x30  32x30
25: 12x26  21x28  29x30  35x30
26: 12x28  23x28  34x28  37x30
27: 12x30  25x28  34x30  40x30
28: 13x30  26x28  35x30  42x30
29: 14x30  28x28  38x30  45x30
30: 15x30  29x28  40x30  48x30
31: 16x30  31x28  43x30  51x30
32: 17x30  33x28  45x30  54x30
33: 18x30  35x28  48x30  57x30
34: 19x30  37x28  51x30  60x30
35: 19x30  38x28  53x30  63x30
36: 20x30  40x28  56x30  66x30
37: 21x30  43x28  59x30  70x30
38: 22x30  45x28  62x30  74x30
39: 24x30  47x28  65x30  77x30
40: 25x30  49x28  68x30  81x30`;

interface BlockSpec {
  blocks: number;
  eccLen: number;
}

const EC_BLOCKS: Record<QrEcc, BlockSpec>[] = [];
for (const line of EC_BLOCKS_TEXT.trim().split('\n')) {
  const [version, cells] = line.split(':');
  const specs = cells.trim().split(/\s+/).map((cell): BlockSpec => {
    const [blocks, eccLen] = cell.split('x').map(Number);
    return { blocks, eccLen };
  });
  EC_BLOCKS[Number(version)] = { L: specs[0], M: specs[1], Q: specs[2], H: specs[3] };
}

/** Byte-mode capacity (characters) per version for L, M, Q, H (ISO 18004 Table 7). */
const BYTE_CAPACITY: Record<QrEcc, readonly number[]> = {
  L: [0, 17, 32, 53, 78, 106, 134, 154, 192, 230, 271, 321, 367, 425, 458, 520, 586, 644, 718, 792, 858, 929, 1003, 1091, 1171, 1273, 1367, 1465, 1528, 1628, 1732, 1840, 1952, 2068, 2188, 2303, 2431, 2563, 2699, 2809, 2953],
  M: [0, 14, 26, 42, 62, 84, 106, 122, 152, 180, 213, 251, 287, 331, 362, 412, 450, 504, 560, 624, 666, 711, 779, 857, 911, 997, 1059, 1125, 1190, 1264, 1370, 1452, 1538, 1628, 1722, 1809, 1911, 1989, 2099, 2213, 2331],
  Q: [0, 11, 20, 32, 46, 60, 74, 86, 108, 130, 151, 177, 203, 241, 258, 292, 322, 364, 394, 442, 482, 509, 565, 611, 661, 715, 751, 805, 868, 908, 982, 1030, 1112, 1168, 1228, 1283, 1351, 1423, 1499, 1579, 1663],
  H: [0, 7, 14, 24, 34, 44, 58, 64, 84, 98, 119, 137, 155, 177, 194, 220, 250, 280, 310, 338, 382, 403, 439, 461, 511, 535, 593, 625, 658, 698, 742, 790, 842, 898, 958, 983, 1051, 1093, 1139, 1219, 1273],
};

// ---------------------------------------------------------------------------
// Arithmetic: GF(256) without tables, and binary polynomial remainder for BCH
// ---------------------------------------------------------------------------

function gfMul(a: number, b: number): number {
  let product = 0;
  while (b !== 0) {
    if (b & 1) product ^= a;
    a <<= 1;
    if (a & 0x100) a ^= 0x11d;
    b >>>= 1;
  }
  return product;
}

function gfPow(base: number, exp: number): number {
  let result = 1;
  for (let i = 0; i < exp; i++) result = gfMul(result, base);
  return result;
}

/** Remainder of `value` divided by `generator`, both as GF(2) polynomials. */
function polyMod(value: number, generator: number): number {
  const degree = (x: number): number => 31 - Math.clz32(x);
  const g = degree(generator);
  while (value !== 0 && degree(value) >= g) value ^= generator << (degree(value) - g);
  return value;
}

// ---------------------------------------------------------------------------
// Minimal decoder for clean, axis-aligned synthetic matrices
// ---------------------------------------------------------------------------

/** Masks by ISO formula, i = row, j = column; true means "invert". */
const MASK_CONDITIONS: readonly ((i: number, j: number) => boolean)[] = [
  (i, j) => (i + j) % 2 === 0,
  (i) => i % 2 === 0,
  (_i, j) => j % 3 === 0,
  (i, j) => (i + j) % 3 === 0,
  (i, j) => (Math.floor(i / 2) + Math.floor(j / 3)) % 2 === 0,
  (i, j) => ((i * j) % 2) + ((i * j) % 3) === 0,
  (i, j) => (((i * j) % 2) + ((i * j) % 3)) % 2 === 0,
  (i, j) => (((i * j) % 3) + ((i + j) % 2)) % 2 === 0,
];

/** ECC level by the 2-bit indicator in the format information. */
const FORMAT_ECC: readonly QrEcc[] = ['M', 'L', 'H', 'Q'];

const ALPHANUMERIC = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';

/** Format info module positions, bit 14 first. */
function formatPositions(n: number): { copy1: Pos[]; copy2: Pos[] } {
  const copy1: Pos[] = [
    [8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5], [8, 7], [8, 8], [7, 8],
    [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8],
  ];
  const copy2: Pos[] = [];
  for (let i = 0; i < 7; i++) copy2.push([n - 1 - i, 8]); // bits 14…8 up the bottom-left
  for (let i = 0; i < 8; i++) copy2.push([8, n - 8 + i]); // bits 7…0 along the top-right
  return { copy1, copy2 };
}

/** Version info module positions, bit 17 first. */
function versionPositions(n: number): { topRight: Pos[]; bottomLeft: Pos[] } {
  const topRight: Pos[] = [];
  const bottomLeft: Pos[] = [];
  for (let i = 17; i >= 0; i--) {
    topRight.push([Math.floor(i / 3), n - 11 + (i % 3)]);
    bottomLeft.push([n - 11 + (i % 3), Math.floor(i / 3)]);
  }
  return { topRight, bottomLeft };
}

function readBits(m: Matrix, positions: readonly Pos[]): string {
  return positions.map(([r, c]) => (m[r][c] ? '1' : '0')).join('');
}

/** Map of modules that carry no data (finders, separators, timing, alignment, format, version). */
function functionModules(version: number): boolean[][] {
  const n = 17 + 4 * version;
  const fn = Array.from({ length: n }, () => new Array<boolean>(n).fill(false));
  const fill = (r0: number, c0: number, h: number, w: number): void => {
    for (let r = r0; r < r0 + h; r++) for (let c = c0; c < c0 + w; c++) fn[r][c] = true;
  };
  fill(0, 0, 9, 9); // top-left finder + separator + format info
  fill(0, n - 8, 9, 8); // top-right finder + separator + format info
  fill(n - 8, 0, 8, 9); // bottom-left finder + separator + format info + dark module
  fill(6, 0, 1, n); // horizontal timing
  fill(0, 6, n, 1); // vertical timing
  const centres = ALIGNMENT_TABLE[version];
  for (const r of centres) {
    for (const c of centres) {
      if ((r === 6 && c === 6) || (r === 6 && c === n - 7) || (r === n - 7 && c === 6)) continue;
      fill(r - 2, c - 2, 5, 5);
    }
  }
  if (version >= 7) {
    fill(0, n - 11, 6, 3);
    fill(n - 11, 0, 3, 6);
  }
  return fn;
}

interface Decoded {
  version: number;
  ecc: QrEcc;
  mask: number;
  text: string;
  modes: string[];
  /** Format info as read from each copy, bit 14 first. */
  format: [string, string];
  /** Version info from the top-right and bottom-left blocks, bit 17 first (versions ≥ 7). */
  versionInfo?: [string, string] | undefined;
}

function decode(m: Matrix): Decoded {
  const n = m.length;
  assert.ok(m.every((row) => row.length === n), 'matrix must be square');
  const version = (n - 17) / 4;
  assert.ok(Number.isInteger(version) && version >= 1 && version <= 40, `invalid size ${n}`);

  // 1. Format info: both copies equal, valid BCH(15,5) codeword after removing the 0x5412 mask.
  const fp = formatPositions(n);
  const format: [string, string] = [readBits(m, fp.copy1), readBits(m, fp.copy2)];
  assert.equal(format[0], format[1], 'format info copies differ');
  const fmt = parseInt(format[0], 2) ^ 0x5412;
  assert.equal(polyMod(fmt, 0x537), 0, 'format info fails BCH check');
  const ecc = FORMAT_ECC[fmt >>> 13];
  const mask = (fmt >>> 10) & 7;

  // 2. Version info (v ≥ 7): both blocks equal, valid BCH(18,6), matches the symbol size.
  let versionInfo: [string, string] | undefined;
  if (version >= 7) {
    const vp = versionPositions(n);
    versionInfo = [readBits(m, vp.topRight), readBits(m, vp.bottomLeft)];
    assert.equal(versionInfo[0], versionInfo[1], 'version info blocks differ');
    const bits = parseInt(versionInfo[0], 2);
    assert.equal(polyMod(bits, 0x1f25), 0, 'version info fails BCH check');
    assert.equal(bits >>> 12, version, 'version info does not match size');
  }

  // 3. Unmask and read data modules in zig-zag order: 2-column strips from the right,
  //    alternating upward/downward, skipping the vertical timing column.
  const fn = functionModules(version);
  const condition = MASK_CONDITIONS[mask];
  const bits: number[] = [];
  let upward = true;
  for (let right = n - 1; right > 0; right -= 2) {
    if (right === 6) right = 5;
    for (let k = 0; k < n; k++) {
      const row = upward ? n - 1 - k : k;
      for (const col of [right, right - 1]) {
        if (!fn[row][col]) bits.push(m[row][col] !== condition(row, col) ? 1 : 0);
      }
    }
    upward = !upward;
  }
  const total = TOTAL_CODEWORDS[version];
  assert.equal(bits.length, total * 8 + REMAINDER_BITS[version], 'unexpected number of data modules');
  assert.ok(bits.slice(total * 8).every((b) => b === 0), 'remainder bits must be 0');
  const codewords: number[] = [];
  for (let i = 0; i < total; i++) {
    let byte = 0;
    for (let k = 0; k < 8; k++) byte = (byte << 1) | bits[i * 8 + k];
    codewords.push(byte);
  }

  // 4. De-interleave: data codewords round-robin (long blocks last), then ECC codewords.
  const { blocks: numBlocks, eccLen } = EC_BLOCKS[version][ecc];
  const numLong = total % numBlocks;
  const shortLen = Math.floor(total / numBlocks);
  const dataLens = Array.from({ length: numBlocks }, (_, b) => shortLen - eccLen + (b >= numBlocks - numLong ? 1 : 0));
  const blocks: number[][] = dataLens.map(() => []);
  let k = 0;
  for (let i = 0; i < Math.max(...dataLens); i++) {
    for (let b = 0; b < numBlocks; b++) if (i < dataLens[b]) blocks[b].push(codewords[k++]);
  }
  for (let i = 0; i < eccLen; i++) {
    for (let b = 0; b < numBlocks; b++) blocks[b].push(codewords[k++]);
  }
  assert.equal(k, total);

  // 5. Reed–Solomon: every syndrome S_j = c(α^j), j = 0 … eccLen−1, must be zero.
  blocks.forEach((block, b) => {
    for (let j = 0; j < eccLen; j++) {
      const x = gfPow(2, j);
      let s = 0;
      for (const c of block) s = gfMul(s, x) ^ c;
      assert.equal(s, 0, `block ${b}: syndrome S${j} is not zero`);
    }
  });

  // 6. Parse segments from the concatenated data codewords.
  const data = blocks.flatMap((block, b) => block.slice(0, dataLens[b]));
  const totalBits = data.length * 8;
  let pos = 0;
  const read = (count: number): number => {
    assert.ok(pos + count <= totalBits, 'read past end of data');
    let v = 0;
    for (let i = 0; i < count; i++, pos++) v = (v << 1) | ((data[pos >>> 3] >>> (7 - (pos & 7))) & 1);
    return v;
  };
  const sizeClass = version <= 9 ? 0 : version <= 26 ? 1 : 2;
  const COUNT_BITS: Record<number, readonly number[]> = { 1: [10, 12, 14], 2: [9, 11, 13], 4: [8, 16, 16] };
  let text = '';
  const modes: string[] = [];
  for (;;) {
    if (totalBits - pos < 4) {
      assert.equal(read(totalBits - pos), 0, 'truncated terminator must be zero');
      break;
    }
    const mode = read(4);
    if (mode === 0) break; // terminator
    assert.ok(mode in COUNT_BITS, `unsupported mode indicator ${mode}`);
    let count = read(COUNT_BITS[mode][sizeClass]);
    if (mode === 1) {
      modes.push('numeric');
      for (; count >= 3; count -= 3) {
        const v = read(10);
        assert.ok(v < 1000);
        text += String(v).padStart(3, '0');
      }
      if (count > 0) {
        const v = read(count === 2 ? 7 : 4);
        assert.ok(v < 10 ** count);
        text += String(v).padStart(count, '0');
      }
    } else if (mode === 2) {
      modes.push('alphanumeric');
      for (; count >= 2; count -= 2) {
        const v = read(11);
        assert.ok(v < 45 * 45);
        text += ALPHANUMERIC[Math.floor(v / 45)] + ALPHANUMERIC[v % 45];
      }
      if (count > 0) text += ALPHANUMERIC[read(6)];
    } else {
      modes.push('byte');
      const bytes = new Uint8Array(count);
      for (let i = 0; i < count; i++) bytes[i] = read(8);
      text += new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    }
  }
  // 7. Padding: zero bits to the byte boundary, then alternating 0xEC / 0x11.
  while (pos % 8 !== 0) assert.equal(read(1), 0, 'bit padding must be zero');
  for (let i = 0; pos < totalBits; i++) assert.equal(read(8), i % 2 === 0 ? 0xec : 0x11, 'bad pad codeword');

  return { version, ecc, mask, text, modes, format, versionInfo };
}

// ---------------------------------------------------------------------------
// Structure checks and an independent penalty score
// ---------------------------------------------------------------------------

function checkStructure(m: Matrix, version: number): void {
  const n = 17 + 4 * version;
  assert.equal(m.length, n, 'size = 17 + 4·version');
  for (const row of m) assert.equal(row.length, n);

  // Finder patterns (7×7: dark ring, light ring, dark 3×3 core) with light separators.
  for (const [r0, c0] of [[0, 0], [0, n - 7], [n - 7, 0]]) {
    for (let dr = -1; dr <= 7; dr++) {
      for (let dc = -1; dc <= 7; dc++) {
        const r = r0 + dr;
        const c = c0 + dc;
        if (r < 0 || c < 0 || r >= n || c >= n) continue;
        const inFinder = dr >= 0 && dr <= 6 && dc >= 0 && dc <= 6;
        const ring = dr === 0 || dr === 6 || dc === 0 || dc === 6;
        const core = dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4;
        assert.equal(m[r][c], inFinder && (ring || core), `finder/separator module (${r}, ${c})`);
      }
    }
  }
  // Timing patterns alternate, starting and ending dark.
  for (let i = 8; i < n - 8; i++) {
    assert.equal(m[6][i], i % 2 === 0, `horizontal timing at column ${i}`);
    assert.equal(m[i][6], i % 2 === 0, `vertical timing at row ${i}`);
  }
  // Dark module.
  assert.equal(m[4 * version + 9][8], true, 'dark module at (4·version + 9, 8)');
  // Alignment patterns at the ISO positions.
  const centres = ALIGNMENT_TABLE[version];
  for (const r of centres) {
    for (const c of centres) {
      if ((r === 6 && c === 6) || (r === 6 && c === n - 7) || (r === n - 7 && c === 6)) continue;
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          const expected = Math.max(Math.abs(dr), Math.abs(dc)) !== 1;
          assert.equal(m[r + dr][c + dc], expected, `alignment pattern at (${r}, ${c})`);
        }
      }
    }
  }
}

/** Penalty rules N1–N4 written from the spec, with the quiet zone counted as light. */
function referencePenalty(m: Matrix): number {
  const n = m.length;
  let score = 0;
  const lines: (readonly boolean[])[] = [];
  for (let i = 0; i < n; i++) lines.push(m[i], m.map((row) => row[i]));
  for (const line of lines) {
    const runs: { dark: boolean; len: number }[] = [];
    for (const dark of line) {
      const last = runs[runs.length - 1];
      if (last && last.dark === dark) last.len++;
      else runs.push({ dark, len: 1 });
    }
    // N1: 3 + (length − 5) for each run of ≥ 5 same-coloured modules.
    for (const run of runs) if (run.len >= 5) score += 3 + run.len - 5;
    // N3: 1:1:3:1:1 dark/light pattern with ≥ 4 units of light on a side (quiet zone is light).
    const lens = runs.map((r) => r.len);
    if (runs[0].dark) lens.unshift(Infinity);
    else lens[0] = Infinity;
    if (runs[runs.length - 1].dark) lens.push(Infinity);
    else lens[lens.length - 1] = Infinity;
    for (let i = 1; i + 5 < lens.length; i += 2) {
      // lens alternate light, dark, light, …, so odd indices are dark runs.
      const u = lens[i];
      if (lens[i + 1] !== u || lens[i + 2] !== 3 * u || lens[i + 3] !== u || lens[i + 4] !== u) continue;
      const before = lens[i - 1];
      const after = lens[i + 5];
      if (before >= 4 * u && after >= u) score += 40;
      if (after >= 4 * u && before >= u) score += 40;
    }
  }
  // N2: 3 per 2×2 block of one colour (overlapping blocks count separately).
  for (let r = 0; r + 1 < n; r++) {
    for (let c = 0; c + 1 < n; c++) {
      const v = m[r][c];
      if (m[r][c + 1] === v && m[r + 1][c] === v && m[r + 1][c + 1] === v) score += 3;
    }
  }
  // N4: 10·k for the smallest k with |dark% − 50| ≤ 5(k + 1).
  const total = n * n;
  const dark = m.reduce((sum, row) => sum + row.filter(Boolean).length, 0);
  let k = 0;
  while (Math.abs(dark * 100 - total * 50) > 5 * (k + 1) * total) k++;
  return score + 10 * k;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

const INVITE_URL = 'https://nestly.app/#/join/K7Q9XM';
const WIFI = 'WIFI:T:WPA;S:WG Kastanienallee;P:p@ss;w0rd!;;';
const UMLAUTS = 'Grüße aus der WG 🏠';
const LONG_TEXT = (
  'Willkommen in der WG Kastanienallee! Putzplan: Küche Mo, Bad Mi, Flur Fr. ' +
  'Einkaufsliste: Hafermilch, Äpfel, Brötchen, Spülmittel. Fixkosten: Miete 1.840 €, Strom 96 €, Internet 39,99 €. ' +
  'Bitte tragt Ausgaben direkt in Nestly ein – danke! 🧹🛒💶 '
).repeat(2);

const SAMPLES: readonly [string, string][] = [
  ['short ASCII', 'Hello, WG!'],
  ['invite URL', INVITE_URL],
  ['Wi-Fi string', WIFI],
  ['umlauts + emoji', UMLAUTS],
  ['long text (version ≥ 7)', LONG_TEXT],
  ['empty string', ''],
  ['numeric', '004917612345678'],
  ['alphanumeric', 'NESTLY WG-K7Q9XM: 100% $5 *+./'],
];

describe('qrMatrix round-trips through the reference decoder', () => {
  for (const [label, text] of SAMPLES) {
    for (const ecc of LEVELS) {
      test(`${label} at ECC ${ecc}`, () => {
        const m = qrMatrix(text, ecc);
        const d = decode(m);
        assert.equal(d.text, text);
        assert.ok(rank(d.ecc) >= rank(ecc), `ECC ${d.ecc} is at least ${ecc}`);
        checkStructure(m, d.version);
      });
    }
  }

  test('long text needs version ≥ 7 and carries valid version info', () => {
    assert.ok(new TextEncoder().encode(LONG_TEXT).length > 300);
    for (const ecc of LEVELS) {
      const d = decode(qrMatrix(LONG_TEXT, ecc));
      assert.ok(d.version >= 7, `version ${d.version} at ${ecc}`);
      assert.ok(d.versionInfo);
      assert.equal(parseInt(d.versionInfo[0], 2), VERSION_TABLE[d.version - 7]);
    }
  });

  test('chooses the most compact mode for the whole string', () => {
    assert.deepEqual(decode(qrMatrix('0123456789')).modes, ['numeric']);
    assert.deepEqual(decode(qrMatrix('HELLO WORLD $%*+-./:')).modes, ['alphanumeric']);
    assert.deepEqual(decode(qrMatrix('Hello world')).modes, ['byte']);
    assert.deepEqual(decode(qrMatrix(INVITE_URL)).modes, ['byte']);
    assert.deepEqual(decode(qrMatrix(UMLAUTS)).modes, ['byte']);
  });

  test('numeric groups of 1, 2 and 3 digits keep leading zeros', () => {
    for (const text of ['0', '07', '007', '0070', '00700', '000000000000001']) {
      assert.equal(decode(qrMatrix(text, 'L')).text, text);
    }
  });

  test('UTF-8 multi-byte text is encoded in byte mode', () => {
    const d = decode(qrMatrix(UMLAUTS, 'M'));
    assert.equal(d.text, UMLAUTS);
    assert.equal(new TextEncoder().encode(UMLAUTS).length, 23); // ü, ß: 2 bytes; 🏠: 4 bytes
    assert.equal(d.version, 2);
  });

  test('a big payload with many interleaved blocks decodes', () => {
    const text = Array.from({ length: 2000 }, (_, i) => String.fromCharCode(33 + ((i * 7) % 94))).join('');
    const d = decode(qrMatrix(text, 'L'));
    assert.equal(d.text, text);
    assert.ok(d.version >= 30);
  });

  test('a single flipped data module is detected by the decoder', () => {
    const m = qrMatrix(INVITE_URL).map((row) => [...row]);
    const n = m.length;
    m[n - 1][n - 1] = !m[n - 1][n - 1]; // first data bit
    assert.throws(() => decode(m), /syndrome/);
  });
});

describe('version and ECC selection', () => {
  test('default ECC level is M', () => {
    assert.deepEqual(qrMatrix(WIFI), qrMatrix(WIFI, 'M'));
    assert.equal(qrEncode(WIFI, { boostEcc: false }).ecc, 'M');
  });

  test('ECC is boosted only while the data still fits the same version', () => {
    const invite = qrEncode(INVITE_URL); // 32 bytes: v3-M holds 42, v3-Q 32, v3-H 24
    assert.equal(invite.version, 3);
    assert.equal(invite.ecc, 'Q');
    assert.equal(invite.size, 29);
    assert.equal(qrEncode('Hello', { ecc: 'L' }).ecc, 'H');
    assert.equal(qrEncode('a'.repeat(17), { ecc: 'L' }).ecc, 'L'); // v1-L is full
    const unboosted = qrEncode(INVITE_URL, { boostEcc: false });
    assert.equal(unboosted.ecc, 'M');
    assert.equal(decode(unboosted.modules).ecc, 'M');
  });

  test('every byte capacity in ISO table 7 picks the smallest version and decodes when full', () => {
    // Masks are forced (cycling through all 8) to keep this exhaustive test fast;
    // automatic mask selection is covered elsewhere.
    for (const ecc of LEVELS) {
      for (let v = 1; v <= 40; v++) {
        const cap = BYTE_CAPACITY[ecc][v];
        const mask = (v + rank(ecc)) % 8;
        const text = Array.from({ length: cap }, (_, i) => String.fromCharCode(97 + ((i * 5 + v) % 26))).join('');
        const full = qrEncode(text, { ecc, mask, boostEcc: false });
        assert.equal(full.version, v, `${cap} bytes at ${ecc} → version ${v}`);
        const d = decode(full.modules);
        assert.deepEqual([d.version, d.ecc, d.mask, d.text], [v, ecc, mask, text]);
        if (v === 40) {
          assert.throws(() => qrEncode(text + 'a', { ecc, mask }), /too long/);
        } else {
          assert.equal(qrEncode(text + 'a', { ecc, mask, boostEcc: false }).version, v + 1);
        }
      }
    }
  });

  test('numeric and alphanumeric capacities at version 40', () => {
    const limits: Record<QrEcc, [number, number]> = { L: [7089, 4296], M: [5596, 3391], Q: [3993, 2420], H: [3057, 1852] };
    for (const ecc of LEVELS) {
      const [digits, alnum] = limits[ecc];
      assert.equal(qrEncode('7'.repeat(digits), { ecc }).version, 40);
      assert.throws(() => qrEncode('7'.repeat(digits + 1), { ecc }), /too long/);
      assert.equal(qrEncode('Z'.repeat(alnum), { ecc }).version, 40);
      assert.throws(() => qrEncode('Z'.repeat(alnum + 1), { ecc }), /too long/);
    }
  });

  test('too-long data throws a clear error', () => {
    assert.throws(
      () => qrMatrix('x'.repeat(2332), 'M'),
      (err: unknown) =>
        err instanceof Error && /too long/.test(err.message) && /2332 UTF-8 bytes/.test(err.message) && /level M/.test(err.message) && /max 2331/.test(err.message),
    );
    assert.throws(() => qrMatrix('ü'.repeat(1500), 'L'), /too long/); // 3000 bytes > 2953
  });

  test('invalid options are rejected', () => {
    assert.throws(() => qrMatrix('x', 'X' as QrEcc), RangeError);
    assert.throws(() => qrEncode('x', { mask: 8 }), RangeError);
    assert.throws(() => qrEncode('x', { mask: 1.5 }), RangeError);
    assert.throws(() => qrEncode('x', { minVersion: 0 }), RangeError);
    assert.throws(() => qrEncode('x', { maxVersion: 41 }), RangeError);
    assert.throws(() => qrEncode('x', { minVersion: 5, maxVersion: 4 }), RangeError);
    assert.throws(() => qrEncode('a'.repeat(20), { maxVersion: 1, ecc: 'L' }), /version 1 QR code/);
  });
});

describe('symbol structure', () => {
  test('every version 1–40 at every level: size, finders, timing, alignment, dark module', () => {
    for (let v = 1; v <= 40; v++) {
      for (const ecc of LEVELS) {
        const text = `wg${v}`; // byte mode, ≤ 4 bytes: fits even version 1-H
        const qr = qrEncode(text, { ecc, minVersion: v, maxVersion: v, boostEcc: false });
        assert.equal(qr.version, v);
        assert.equal(qr.size, 17 + 4 * v);
        checkStructure(qr.modules, v);
        const d = decode(qr.modules);
        assert.equal(d.text, text);
        assert.equal(d.ecc, ecc);
        assert.equal(d.mask, qr.mask);
      }
    }
  });

  test('format info matches the standard table for every (ECC, mask) pair', () => {
    for (const ecc of LEVELS) {
      for (let mask = 0; mask < 8; mask++) {
        const qr = qrEncode(INVITE_URL, { ecc, mask, boostEcc: false });
        const d = decode(qr.modules);
        assert.equal(qr.mask, mask);
        assert.equal(d.mask, mask);
        assert.equal(d.ecc, ecc);
        assert.equal(d.format[0], FORMAT_TABLE[ecc][mask], `format ${ecc}/${mask}`);
        assert.equal(d.format[0], d.format[1], 'both copies identical');
      }
    }
  });

  test('ECC M with mask 0 has format bits 101010000010010', () => {
    const m = qrEncode('Hello', { ecc: 'M', mask: 0, boostEcc: false }).modules;
    const fp = formatPositions(m.length);
    assert.equal(readBits(m, fp.copy1), '101010000010010');
    assert.equal(readBits(m, fp.copy2), '101010000010010');
  });

  test('version 7 info blocks are 000111110010010100', () => {
    const m = qrEncode('version seven', { minVersion: 7, maxVersion: 7 }).modules;
    assert.equal(m.length, 45);
    const vp = versionPositions(m.length);
    assert.equal(readBits(m, vp.topRight), '000111110010010100');
    assert.equal(readBits(m, vp.bottomLeft), '000111110010010100');
  });

  test('version info matches the standard table for versions 7–40', () => {
    for (let v = 7; v <= 40; v++) {
      const d = decode(qrEncode('v', { minVersion: v, maxVersion: v }).modules);
      assert.ok(d.versionInfo);
      const expected = VERSION_TABLE[v - 7].toString(2).padStart(18, '0');
      assert.deepEqual(d.versionInfo, [expected, expected], `version ${v}`);
    }
  });

  test('the module counts implied by the function patterns match the codeword table', () => {
    for (let v = 1; v <= 40; v++) {
      const fn = functionModules(v);
      const free = fn.flat().filter((x) => !x).length;
      assert.equal(Math.floor(free / 8), TOTAL_CODEWORDS[v], `version ${v}`);
      assert.equal(free % 8, REMAINDER_BITS[v]);
      for (const ecc of LEVELS) {
        const { blocks, eccLen } = EC_BLOCKS[v][ecc];
        assert.ok(TOTAL_CODEWORDS[v] - blocks * eccLen > 0);
      }
    }
  });
});

describe('mask selection', () => {
  const cases: [string, QrEcc][] = [
    [INVITE_URL, 'M'],
    [WIFI, 'Q'],
    [UMLAUTS, 'H'],
    [LONG_TEXT, 'L'],
    ['0123456789', 'M'],
  ];
  for (const [text, ecc] of cases) {
    test(`auto mask has the lowest penalty: ${JSON.stringify(text.slice(0, 24))} at ${ecc}`, () => {
      const auto = qrEncode(text, { ecc });
      const penalties = Array.from({ length: 8 }, (_, mask) => {
        const forced = qrEncode(text, { ecc, mask });
        assert.equal(decode(forced.modules).text, text, `mask ${mask} decodes`);
        return referencePenalty(forced.modules);
      });
      const best = penalties.indexOf(Math.min(...penalties));
      assert.equal(auto.mask, best, `penalties ${penalties.join(', ')}`);
      assert.deepEqual(auto.modules, qrEncode(text, { ecc, mask: best }).modules);
    });
  }

  test('reference penalty of an all-light 21×21 grid', () => {
    // N1: 42 lines × (3 + 16); N2: 400 blocks × 3; N4: 0 % dark → k = 9.
    const blank = Array.from({ length: 21 }, () => new Array<boolean>(21).fill(false));
    assert.equal(referencePenalty(blank), 42 * 19 + 400 * 3 + 90);
  });
});

describe('SVG output', () => {
  test('qrSvgPath merges horizontal runs and offsets by the border', () => {
    const m = [
      [true, true, false],
      [false, true, true],
      [true, false, true],
    ];
    assert.deepEqual(qrSvgPath(m, 1), { path: 'M1 1h2v1h-2zM2 2h2v1h-2zM1 3h1v1h-1zM3 3h1v1h-1z', size: 5 });
    assert.equal(qrSvgPath(m).size, 7); // default border 2
    assert.deepEqual(qrSvgPath([], 0), { path: '', size: 0 });
  });

  test('path rasterises back to the exact matrix inside an empty quiet zone', () => {
    for (const border of [0, 2, 4]) {
      const m = qrMatrix(INVITE_URL);
      const { path, size } = qrSvgPath(m, border);
      assert.equal(size, m.length + 2 * border);
      const grid = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
      let consumed = 0;
      for (const match of path.matchAll(/M(\d+) (\d+)h(\d+)v1h-(\d+)z/g)) {
        const [whole, x, y, w, back] = match;
        assert.equal(w, back);
        consumed += whole.length;
        for (let i = 0; i < Number(w); i++) {
          assert.equal(grid[Number(y)][Number(x) + i], false, 'no overlapping rectangles');
          grid[Number(y)][Number(x) + i] = true;
        }
      }
      assert.equal(consumed, path.length, 'path only contains run rectangles');
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const inside = y >= border && x >= border && y < border + m.length && x < border + m.length;
          assert.equal(grid[y][x], inside && m[y - border][x - border], `module (${y}, ${x})`);
        }
      }
    }
  });

  test('qrSvgPath validates its input', () => {
    assert.throws(() => qrSvgPath([[true]], -1), RangeError);
    assert.throws(() => qrSvgPath([[true]], 1.5), RangeError);
    assert.throws(() => qrSvgPath([[true, false]]), RangeError);
  });

  test('qrSvg returns a complete standalone document', () => {
    const svg = qrSvg(INVITE_URL, { ecc: 'H', border: 4, color: '#1d4ed8', background: '#fffbeb' });
    const { path, size } = qrSvgPath(qrMatrix(INVITE_URL, 'H'), 4);
    assert.equal(size, decode(qrMatrix(INVITE_URL, 'H')).version * 4 + 17 + 8);
    assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" /);
    assert.ok(svg.includes(`viewBox="0 0 ${size} ${size}"`));
    assert.ok(svg.includes(`<rect width="${size}" height="${size}" fill="#fffbeb"/>`));
    assert.ok(svg.includes(`<path d="${path}" fill="#1d4ed8"/>`));
    assert.ok(svg.endsWith('</svg>'));
  });

  test('qrSvg defaults and attribute escaping', () => {
    const svg = qrSvg('Hi');
    const { path, size } = qrSvgPath(qrMatrix('Hi'));
    assert.equal(size, 21 + 4);
    assert.ok(svg.includes(`fill="#fff"`));
    assert.ok(svg.includes(`<path d="${path}" fill="#000"/>`));
    const evil = qrSvg('Hi', { color: '"/><script>alert(1)</script>' });
    assert.ok(!evil.includes('<script>'));
    assert.ok(evil.includes('fill="&quot;/&gt;&lt;script&gt;alert(1)&lt;/script&gt;"'));
  });
});
