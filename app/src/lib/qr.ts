/**
 * Dependency-free QR Code generator (ISO/IEC 18004, Model 2, versions 1–40).
 *
 * Pipeline:
 *   text → one segment (numeric / alphanumeric / UTF-8 byte mode)
 *        → pick the smallest version that fits (optionally boost the ECC level)
 *        → bit stream + terminator + pad bytes
 *        → split into blocks, append Reed–Solomon ECC, interleave
 *        → draw function patterns, place codewords in zig-zag order
 *        → try all 8 masks, keep the one with the lowest penalty
 *        → write format (and version) information.
 *
 * Runs unchanged in browsers (via tsc) and under Node's type stripping: only
 * erasable TypeScript syntax, and the only platform API used is TextEncoder.
 * Matrices are indexed `[row][column]`, `true` = dark module.
 */

export type QrEcc = 'L' | 'M' | 'Q' | 'H';

export interface QrEncodeOptions {
  /** Minimum error correction level (default 'M'). */
  ecc?: QrEcc;
  /** Raise the ECC level when the data still fits the same version (default true). */
  boostEcc?: boolean;
  /** Force mask pattern 0–7 instead of choosing the lowest-penalty one. */
  mask?: number;
  /** Smallest version to consider (default 1). */
  minVersion?: number;
  /** Largest version to consider (default 40). */
  maxVersion?: number;
}

export interface QrCode {
  /** Symbol version, 1–40. */
  version: number;
  /** ECC level actually used (can be higher than requested when boosted). */
  ecc: QrEcc;
  /** Mask pattern used, 0–7. */
  mask: number;
  /** Modules per side: 17 + 4 · version. */
  size: number;
  /** Module matrix `[row][column]`, `true` = dark, without quiet zone. */
  modules: boolean[][];
}

export interface QrSvgOptions {
  ecc?: QrEcc;
  /** Quiet zone in modules (default 2; the spec recommends 4). */
  border?: number;
  /** Fill of dark modules (default '#000'). */
  color?: string;
  /** Fill of the background (default '#fff'; 'none' for transparent). */
  background?: string;
}

// ---------------------------------------------------------------------------
// Tables (indexed [eccOrdinal][version]; index 0 is unused)
// ---------------------------------------------------------------------------

const ECC_LEVELS: readonly QrEcc[] = ['L', 'M', 'Q', 'H'];

/** 2-bit ECC indicator stored in the format information (the order is not L,M,Q,H). */
const ECC_FORMAT_BITS: Readonly<Record<QrEcc, number>> = { L: 1, M: 0, Q: 3, H: 2 };

/** Reed–Solomon ECC codewords per block. */
const ECC_CODEWORDS_PER_BLOCK: readonly (readonly number[])[] = [
  // 0, 1   2   3   4   5   6   7   8   9  10  11  12  13  14  15  16  17  18  19  20  21  22  23  24  25  26  27  28  29  30  31  32  33  34  35  36  37  38  39  40
  [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30], // L
  [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28], // M
  [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30], // Q
  [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30], // H
];

/** Number of Reed–Solomon blocks the codewords are split into. */
const NUM_ECC_BLOCKS: readonly (readonly number[])[] = [
  // 0, 1, 2, 3, 4, 5, 6, 7, 8, 9,10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40
  [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25], // L
  [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49], // M
  [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68], // Q
  [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81], // H
];

// ---------------------------------------------------------------------------
// Capacity helpers
// ---------------------------------------------------------------------------

/** Modules available for data + ECC (everything except function patterns and format/version info). */
function numRawDataModules(version: number): number {
  let result = (16 * version + 128) * version + 64; // size² minus finders, separators, timing
  if (version >= 2) {
    const numAlign = Math.floor(version / 7) + 2;
    result -= (25 * numAlign - 10) * numAlign - 55; // alignment patterns (minus timing overlap)
    if (version >= 7) result -= 36; // two 6×3 version info blocks
  }
  return result;
}

/** Data codewords (excluding ECC) for a version and ECC level. */
function numDataCodewords(version: number, ecc: QrEcc): number {
  const e = ECC_LEVELS.indexOf(ecc);
  return Math.floor(numRawDataModules(version) / 8) - ECC_CODEWORDS_PER_BLOCK[e][version] * NUM_ECC_BLOCKS[e][version];
}

// ---------------------------------------------------------------------------
// Stage 1: segment encoding
// ---------------------------------------------------------------------------

interface Mode {
  name: 'numeric' | 'alphanumeric' | 'byte';
  indicator: number;
  /** Character count field width for versions 1–9, 10–26, 27–40. */
  countBits: readonly [number, number, number];
}

const NUMERIC: Mode = { name: 'numeric', indicator: 0x1, countBits: [10, 12, 14] };
const ALPHANUMERIC: Mode = { name: 'alphanumeric', indicator: 0x2, countBits: [9, 11, 13] };
const BYTE: Mode = { name: 'byte', indicator: 0x4, countBits: [8, 16, 16] };

const ALPHANUMERIC_CHARSET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';

interface Segment {
  mode: Mode;
  /** Characters (numeric/alphanumeric) or bytes (byte mode). */
  numChars: number;
  /** Payload bits (0/1), without mode indicator and count. */
  bits: number[];
}

function charCountBits(mode: Mode, version: number): number {
  return mode.countBits[version < 10 ? 0 : version < 27 ? 1 : 2];
}

/** Appends `length` bits of `value`, most significant first. */
function appendBits(bits: number[], value: number, length: number): void {
  for (let i = length - 1; i >= 0; i--) bits.push((value >>> i) & 1);
}

/** Encodes the whole text in the most compact single mode it fits. */
function makeSegment(text: string): Segment {
  const bits: number[] = [];
  if (/^[0-9]*$/.test(text)) {
    // Numeric: groups of 3 digits → 10 bits (2 digits → 7, 1 digit → 4).
    for (let i = 0; i < text.length; i += 3) {
      const group = text.slice(i, i + 3);
      appendBits(bits, Number(group), group.length * 3 + 1);
    }
    return { mode: NUMERIC, numChars: text.length, bits };
  }
  if (/^[0-9A-Z $%*+\-./:]*$/.test(text)) {
    // Alphanumeric: pairs → 45·a + b in 11 bits, a trailing single char → 6 bits.
    let i = 0;
    for (; i + 1 < text.length; i += 2) {
      const pair = ALPHANUMERIC_CHARSET.indexOf(text[i]) * 45 + ALPHANUMERIC_CHARSET.indexOf(text[i + 1]);
      appendBits(bits, pair, 11);
    }
    if (i < text.length) appendBits(bits, ALPHANUMERIC_CHARSET.indexOf(text[i]), 6);
    return { mode: ALPHANUMERIC, numChars: text.length, bits };
  }
  // Byte mode: raw UTF-8 bytes, 8 bits each.
  const bytes = new TextEncoder().encode(text);
  for (const b of bytes) appendBits(bits, b, 8);
  return { mode: BYTE, numChars: bytes.length, bits };
}

/** Total bits (header + payload) for a segment at a version, or Infinity if the count field overflows. */
function segmentBitLength(seg: Segment, version: number): number {
  const ccBits = charCountBits(seg.mode, version);
  if (seg.numChars >= 1 << ccBits) return Infinity;
  return 4 + ccBits + seg.bits.length;
}

/** Largest character count of `mode` that fits a version/ECC level (for error messages). */
function maxChars(mode: Mode, version: number, ecc: QrEcc): number {
  const ccBits = charCountBits(mode, version);
  const free = numDataCodewords(version, ecc) * 8 - 4 - ccBits;
  let chars: number;
  if (mode === NUMERIC) chars = Math.floor(free / 10) * 3 + [0, 0, 0, 0, 1, 1, 1, 2, 2, 2][free % 10];
  else if (mode === ALPHANUMERIC) chars = Math.floor(free / 11) * 2 + (free % 11 >= 6 ? 1 : 0);
  else chars = Math.floor(free / 8);
  return Math.min(chars, (1 << ccBits) - 1);
}

/** Header + payload + terminator + pad bytes, packed into data codewords. */
function buildDataCodewords(seg: Segment, version: number, ecc: QrEcc): number[] {
  const capacityBits = numDataCodewords(version, ecc) * 8;
  const bits: number[] = [];
  appendBits(bits, seg.mode.indicator, 4);
  appendBits(bits, seg.numChars, charCountBits(seg.mode, version));
  for (const bit of seg.bits) bits.push(bit);

  appendBits(bits, 0, Math.min(4, capacityBits - bits.length)); // terminator (up to 4 zero bits)
  appendBits(bits, 0, (8 - (bits.length % 8)) % 8); // zero-fill to a byte boundary
  for (let pad = 0xec; bits.length < capacityBits; pad ^= 0xec ^ 0x11) appendBits(bits, pad, 8); // 0xEC, 0x11, …

  const bytes = new Array<number>(capacityBits / 8).fill(0);
  bits.forEach((bit, i) => {
    bytes[i >>> 3] |= bit << (7 - (i & 7));
  });
  return bytes;
}

// ---------------------------------------------------------------------------
// Stage 2: Reed–Solomon error correction over GF(256), polynomial 0x11D
// ---------------------------------------------------------------------------

const GF_EXP = new Uint8Array(512); // α^i, doubled so exp[log a + log b] needs no modulo
const GF_LOG = new Uint8Array(256);
for (let i = 0, x = 1; i < 255; i++) {
  GF_EXP[i] = GF_EXP[i + 255] = x;
  GF_LOG[x] = i;
  x <<= 1;
  if (x & 0x100) x ^= 0x11d;
}

function gfMul(a: number, b: number): number {
  return a === 0 || b === 0 ? 0 : GF_EXP[GF_LOG[a] + GF_LOG[b]];
}

/** Generator polynomial ∏(x − α^i), i = 0 … degree−1, coefficients highest degree first. */
function rsGenerator(degree: number): number[] {
  let poly = [1];
  for (let i = 0; i < degree; i++) {
    const next = new Array<number>(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j]; // · x
      next[j + 1] ^= gfMul(poly[j], GF_EXP[i]); // · α^i  (− equals + in GF(2^8))
    }
    poly = next;
  }
  return poly;
}

/** ECC codewords: remainder of data(x) · x^degree divided by the generator. */
function rsRemainder(data: readonly number[], generator: readonly number[]): number[] {
  const degree = generator.length - 1;
  const rem = new Array<number>(degree).fill(0);
  for (const byte of data) {
    const factor = byte ^ (rem.shift() as number);
    rem.push(0);
    if (factor !== 0) for (let i = 0; i < degree; i++) rem[i] ^= gfMul(generator[i + 1], factor);
  }
  return rem;
}

/** Splits data into blocks, appends ECC to each, and interleaves them column by column. */
function addEccAndInterleave(data: readonly number[], version: number, ecc: QrEcc): number[] {
  const e = ECC_LEVELS.indexOf(ecc);
  const numBlocks = NUM_ECC_BLOCKS[e][version];
  const eccLen = ECC_CODEWORDS_PER_BLOCK[e][version];
  const totalCodewords = Math.floor(numRawDataModules(version) / 8);
  const numShortBlocks = numBlocks - (totalCodewords % numBlocks); // the rest carry one extra data codeword
  const shortDataLen = Math.floor(totalCodewords / numBlocks) - eccLen;
  const generator = rsGenerator(eccLen);

  const dataBlocks: number[][] = [];
  const eccBlocks: number[][] = [];
  for (let b = 0, offset = 0; b < numBlocks; b++) {
    const block = data.slice(offset, offset + shortDataLen + (b < numShortBlocks ? 0 : 1));
    offset += block.length;
    dataBlocks.push(block);
    eccBlocks.push(rsRemainder(block, generator));
  }

  const result: number[] = [];
  for (let i = 0; i <= shortDataLen; i++) {
    for (const block of dataBlocks) if (i < block.length) result.push(block[i]);
  }
  for (let i = 0; i < eccLen; i++) {
    for (const block of eccBlocks) result.push(block[i]);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Stage 3: matrix layout — function patterns and codeword placement
// ---------------------------------------------------------------------------

interface Grid {
  size: number;
  modules: boolean[][];
  /** Function modules (patterns, format/version info) that data and masks must not touch. */
  reserved: boolean[][];
}

function newGrid(size: number): Grid {
  const make = (): boolean[][] => Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  return { size, modules: make(), reserved: make() };
}

function setFunction(grid: Grid, row: number, col: number, dark: boolean): void {
  grid.modules[row][col] = dark;
  grid.reserved[row][col] = true;
}

/** Centre coordinates of alignment patterns (same list for rows and columns). */
function alignmentPositions(version: number): number[] {
  if (version === 1) return [];
  const count = Math.floor(version / 7) + 2;
  const step = Math.floor((version * 8 + count * 3 + 5) / (count * 4 - 4)) * 2;
  const result = [6];
  for (let pos = version * 4 + 10; result.length < count; pos -= step) result.splice(1, 0, pos);
  return result;
}

/** 15-bit format info: 2 ECC bits + 3 mask bits, BCH(15,5) with generator 0x537, XOR 0x5412. */
function formatBits(ecc: QrEcc, mask: number): number {
  const data = (ECC_FORMAT_BITS[ecc] << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  return ((data << 10) | rem) ^ 0x5412;
}

/** 18-bit version info: 6 version bits, BCH(18,6) with generator 0x1F25. */
function versionBits(version: number): number {
  let rem = version;
  for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
  return (version << 12) | rem;
}

/** Writes both copies of the format info, plus the always-dark module. */
function drawFormatBits(grid: Grid, ecc: QrEcc, mask: number): void {
  const bits = formatBits(ecc, mask);
  const bit = (i: number): boolean => ((bits >>> i) & 1) !== 0;
  const n = grid.size;
  // Copy 1 around the top-left finder: up column 8, then left along row 8.
  for (let i = 0; i <= 5; i++) setFunction(grid, i, 8, bit(i));
  setFunction(grid, 7, 8, bit(6));
  setFunction(grid, 8, 8, bit(7));
  setFunction(grid, 8, 7, bit(8));
  for (let i = 9; i < 15; i++) setFunction(grid, 8, 14 - i, bit(i));
  // Copy 2 split between the top-right (row 8) and bottom-left (column 8) finders.
  for (let i = 0; i < 8; i++) setFunction(grid, 8, n - 1 - i, bit(i));
  for (let i = 8; i < 15; i++) setFunction(grid, n - 15 + i, 8, bit(i));
  setFunction(grid, n - 8, 8, true); // dark module at (4·version + 9, 8)
}

/** Writes the two 6×3 version info blocks (versions ≥ 7 only). */
function drawVersionBits(grid: Grid, version: number): void {
  if (version < 7) return;
  const bits = versionBits(version);
  for (let i = 0; i < 18; i++) {
    const dark = ((bits >>> i) & 1) !== 0;
    const a = grid.size - 11 + (i % 3);
    const b = Math.floor(i / 3);
    setFunction(grid, b, a, dark); // top-right block
    setFunction(grid, a, b, dark); // bottom-left block
  }
}

function drawFunctionPatterns(grid: Grid, version: number): void {
  const n = grid.size;
  // Timing patterns along row 6 and column 6 (finders overwrite the ends).
  for (let i = 0; i < n; i++) {
    setFunction(grid, 6, i, i % 2 === 0);
    setFunction(grid, i, 6, i % 2 === 0);
  }
  // Finder patterns (7×7) with their 1-module light separators.
  for (const [cr, cc] of [[3, 3], [3, n - 4], [n - 4, 3]]) {
    for (let dr = -4; dr <= 4; dr++) {
      for (let dc = -4; dc <= 4; dc++) {
        const r = cr + dr;
        const c = cc + dc;
        if (r < 0 || r >= n || c < 0 || c >= n) continue;
        const dist = Math.max(Math.abs(dr), Math.abs(dc));
        setFunction(grid, r, c, dist !== 2 && dist !== 4);
      }
    }
  }
  // Alignment patterns (5×5), skipping the three that would overlap finders.
  const pos = alignmentPositions(version);
  const last = pos.length - 1;
  for (let i = 0; i <= last; i++) {
    for (let j = 0; j <= last; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) continue;
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          setFunction(grid, pos[i] + dr, pos[j] + dc, Math.max(Math.abs(dr), Math.abs(dc)) !== 1);
        }
      }
    }
  }
  // Reserve format areas now (real bits are written after masking) and draw version info.
  drawFormatBits(grid, 'M', 0);
  drawVersionBits(grid, version);
}

/** Places codeword bits in two-column strips from the right, zig-zagging up and down. */
function drawCodewords(grid: Grid, codewords: readonly number[]): void {
  const n = grid.size;
  const totalBits = codewords.length * 8;
  let i = 0;
  for (let right = n - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5; // skip the vertical timing column
    const upward = ((right + 1) & 2) === 0;
    for (let step = 0; step < n; step++) {
      const row = upward ? n - 1 - step : step;
      for (let j = 0; j < 2; j++) {
        const col = right - j;
        if (grid.reserved[row][col] || i >= totalBits) continue; // leftover "remainder bits" stay light
        grid.modules[row][col] = ((codewords[i >>> 3] >>> (7 - (i & 7))) & 1) !== 0;
        i++;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Stage 4: masking and penalty evaluation
// ---------------------------------------------------------------------------

/** Mask conditions (row r, column c); a module is inverted where the condition holds. */
const MASKS: readonly ((r: number, c: number) => boolean)[] = [
  (r, c) => (r + c) % 2 === 0,
  (r) => r % 2 === 0,
  (_r, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
];

/** XORs the mask over all non-function modules (applying it twice undoes it). */
function applyMask(grid: Grid, mask: number): void {
  const condition = MASKS[mask];
  for (let r = 0; r < grid.size; r++) {
    for (let c = 0; c < grid.size; c++) {
      if (!grid.reserved[r][c] && condition(r, c)) grid.modules[r][c] = !grid.modules[r][c];
    }
  }
}

const PENALTY_N1 = 3;
const PENALTY_N2 = 3;
const PENALTY_N3 = 40;
const PENALTY_N4 = 10;

/**
 * Penalty for finder-like runs dark:light:dark:light:dark = 1:1:3:1:1 with ≥ 4 light modules
 * on one side. `runs` holds the last 7 run lengths, newest first, ending with a light run.
 */
function finderLikeCount(runs: readonly number[]): number {
  const n = runs[1];
  const core = n > 0 && runs[2] === n && runs[3] === n * 3 && runs[4] === n && runs[5] === n;
  return (core && runs[0] >= n * 4 && runs[6] >= n ? 1 : 0) + (core && runs[6] >= n * 4 && runs[0] >= n ? 1 : 0);
}

/** Scores one row/column for rules 1 (long runs) and 3 (finder-like patterns). */
function linePenalty(line: readonly boolean[]): number {
  const n = line.length;
  let score = 0;
  const runs = [0, 0, 0, 0, 0, 0, 0];
  // Outside the symbol counts as light (quiet zone): the leading light run gets n extra modules.
  const pushRun = (length: number): void => {
    if (runs[0] === 0) length += n;
    for (let i = 6; i > 0; i--) runs[i] = runs[i - 1];
    runs[0] = length;
  };
  let color = false; // a virtual light run precedes the line
  let length = 0;
  for (const dark of line) {
    if (dark === color) {
      length++;
      if (length === 5) score += PENALTY_N1;
      else if (length > 5) score++;
    } else {
      pushRun(length);
      if (!color) score += finderLikeCount(runs) * PENALTY_N3; // a light run just ended
      color = dark;
      length = 1;
    }
  }
  // Close the line: end a dark run, then add the trailing light border.
  if (color) {
    pushRun(length);
    length = 0;
  }
  pushRun(length + n);
  return score + finderLikeCount(runs) * PENALTY_N3;
}

/** Standard penalty score (rules N1–N4) of a full matrix; lower is better. */
function penaltyScore(modules: readonly (readonly boolean[])[]): number {
  const n = modules.length;
  let score = 0;
  // Rules 1 and 3 on every row and column.
  for (let i = 0; i < n; i++) {
    score += linePenalty(modules[i]);
    score += linePenalty(modules.map((row) => row[i]));
  }
  // Rule 2: each 2×2 block of one color.
  for (let r = 0; r < n - 1; r++) {
    const row = modules[r];
    const below = modules[r + 1];
    for (let c = 0; c < n - 1; c++) {
      const v = row[c];
      if (v === row[c + 1] && v === below[c] && v === below[c + 1]) score += PENALTY_N2;
    }
  }
  // Rule 4: 10 points per full 5 % step the dark ratio deviates from 50 %.
  let dark = 0;
  for (const row of modules) for (const v of row) if (v) dark++;
  const total = n * n;
  const k = Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1;
  return score + k * PENALTY_N4;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

function checkVersion(v: number, name: string): void {
  if (!Number.isInteger(v) || v < 1 || v > 40) throw new RangeError(`qr: ${name} must be an integer 1–40, got ${v}`);
}

/** Encodes text and returns the symbol with its parameters. */
export function qrEncode(text: string, opts: QrEncodeOptions = {}): QrCode {
  const { boostEcc = true, minVersion = 1, maxVersion = 40, mask } = opts;
  let ecc: QrEcc = opts.ecc ?? 'M';
  if (typeof text !== 'string') throw new TypeError('qr: text must be a string');
  if (!ECC_LEVELS.includes(ecc)) throw new RangeError(`qr: unknown ECC level ${String(ecc)} (use L, M, Q or H)`);
  checkVersion(minVersion, 'minVersion');
  checkVersion(maxVersion, 'maxVersion');
  if (minVersion > maxVersion) throw new RangeError('qr: minVersion must not exceed maxVersion');
  if (mask !== undefined && !(Number.isInteger(mask) && mask >= 0 && mask <= 7)) {
    throw new RangeError(`qr: mask must be an integer 0–7, got ${mask}`);
  }

  // Pick the smallest version whose data capacity fits the segment.
  const seg = makeSegment(text);
  let version = minVersion;
  while (segmentBitLength(seg, version) > numDataCodewords(version, ecc) * 8) {
    if (version >= maxVersion) {
      const unit = seg.mode === BYTE ? 'UTF-8 bytes' : `${seg.mode.name} characters`;
      throw new Error(
        `qr: text too long: ${seg.numChars} ${unit} exceed the capacity of a version ${maxVersion} ` +
          `QR code at ECC level ${ecc} (max ${maxChars(seg.mode, maxVersion, ecc)} ${unit})`,
      );
    }
    version++;
  }
  // Use a stronger ECC level for free if the data still fits this version.
  if (boostEcc) {
    const used = segmentBitLength(seg, version);
    for (const higher of ECC_LEVELS.slice(ECC_LEVELS.indexOf(ecc) + 1)) {
      if (used <= numDataCodewords(version, higher) * 8) ecc = higher;
    }
  }

  // Codewords → matrix.
  const codewords = addEccAndInterleave(buildDataCodewords(seg, version, ecc), version, ecc);
  const grid = newGrid(17 + 4 * version);
  drawFunctionPatterns(grid, version);
  drawCodewords(grid, codewords);

  // Try every mask (with its format info drawn, since that affects the score) unless one is forced.
  let chosen = mask ?? -1;
  if (chosen < 0) {
    let best = Infinity;
    for (let m = 0; m < 8; m++) {
      applyMask(grid, m);
      drawFormatBits(grid, ecc, m);
      const penalty = penaltyScore(grid.modules);
      if (penalty < best) {
        best = penalty;
        chosen = m;
      }
      applyMask(grid, m); // undo
    }
  }
  applyMask(grid, chosen);
  drawFormatBits(grid, ecc, chosen);

  return { version, ecc, mask: chosen, size: grid.size, modules: grid.modules };
}

/**
 * Module matrix for `text` (true = dark, no quiet zone). Uses the smallest version that
 * fits at `ecc` (default 'M'); the ECC level is raised when that costs no extra size.
 * Throws if the text does not fit a version 40 symbol.
 */
export function qrMatrix(text: string, ecc: QrEcc = 'M'): boolean[][] {
  return qrEncode(text, { ecc }).modules;
}

/**
 * SVG path data for the dark modules, offset by `border` quiet-zone modules. Horizontal runs
 * are merged into one rectangle each. Render as `<svg viewBox="0 0 size size"><path d={path}/></svg>`.
 */
export function qrSvgPath(matrix: readonly (readonly boolean[])[], border = 2): { path: string; size: number } {
  if (!Number.isInteger(border) || border < 0) throw new RangeError(`qr: border must be a non-negative integer, got ${border}`);
  const n = matrix.length;
  const parts: string[] = [];
  for (let y = 0; y < n; y++) {
    const row = matrix[y];
    if (row.length !== n) throw new RangeError('qr: matrix must be square');
    for (let x = 0; x < n; ) {
      if (!row[x]) {
        x++;
        continue;
      }
      let end = x + 1;
      while (end < n && row[end]) end++;
      parts.push(`M${x + border} ${y + border}h${end - x}v1h-${end - x}z`);
      x = end;
    }
  }
  return { path: parts.join(''), size: n + 2 * border };
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Complete standalone SVG document for `text`. */
export function qrSvg(text: string, opts: QrSvgOptions = {}): string {
  const { path, size } = qrSvgPath(qrMatrix(text, opts.ecc ?? 'M'), opts.border ?? 2);
  const color = escapeAttr(opts.color ?? '#000');
  const background = escapeAttr(opts.background ?? '#fff');
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges">` +
    `<rect width="${size}" height="${size}" fill="${background}"/>` +
    `<path d="${path}" fill="${color}"/>` +
    `</svg>`
  );
}
