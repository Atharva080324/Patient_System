/**
 * Zero-dependency QR Code generator producing SVG data URLs.
 * Implements ISO/IEC 18004 QR Code specification (Byte mode, Error Correction Level M).
 */

// Galois Field GF(256) math using primitive polynomial 0x11d (285)
const EXP_TABLE = new Uint8Array(512);
const LOG_TABLE = new Uint8Array(256);

(function initGaloisField() {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP_TABLE[i] = x;
    EXP_TABLE[i + 255] = x;
    LOG_TABLE[x] = i;
    x <<= 1;
    if (x & 0x100) {
      x ^= 0x11d;
    }
  }
})();

function gfMultiply(x: number, y: number): number {
  if (x === 0 || y === 0) return 0;
  return EXP_TABLE[LOG_TABLE[x] + LOG_TABLE[y]];
}

function polyMultiply(p1: number[], p2: number[]): number[] {
  const result = new Array(p1.length + p2.length - 1).fill(0);
  for (let i = 0; i < p1.length; i++) {
    for (let j = 0; j < p2.length; j++) {
      result[i + j] ^= gfMultiply(p1[i], p2[j]);
    }
  }
  return result;
}

function getGeneratorPoly(ecLength: number): number[] {
  let poly = [1];
  for (let i = 0; i < ecLength; i++) {
    poly = polyMultiply(poly, [1, EXP_TABLE[i]]);
  }
  return poly;
}

function calculateReedSolomon(data: number[], ecLength: number): number[] {
  const gen = getGeneratorPoly(ecLength);
  const result = [...data, ...new Array(ecLength).fill(0)];
  for (let i = 0; i < data.length; i++) {
    const lead = result[i];
    if (lead !== 0) {
      for (let j = 0; j < gen.length; j++) {
        result[i + j] ^= gfMultiply(gen[j], lead);
      }
    }
  }
  return result.slice(data.length);
}

// Version table for Level M: [version, totalCodewords, ecCodewords, dataCodewords]
const VERSION_INFO: Record<number, { size: number; total: number; ec: number; data: number; align: number[] }> = {
  1: { size: 21, total: 26, ec: 10, data: 16, align: [] },
  2: { size: 25, total: 44, ec: 16, data: 28, align: [6, 18] },
  3: { size: 29, total: 70, ec: 26, data: 44, align: [6, 22] },
  4: { size: 33, total: 100, ec: 36, data: 64, align: [6, 26] },
  5: { size: 37, total: 134, ec: 48, data: 86, align: [6, 30] },
  6: { size: 41, total: 172, ec: 64, data: 108, align: [6, 34] },
  7: { size: 45, total: 196, ec: 72, data: 124, align: [6, 22, 38] },
  8: { size: 49, total: 242, ec: 88, data: 154, align: [6, 24, 42] },
  9: { size: 53, total: 292, ec: 110, data: 182, align: [6, 26, 46] },
  10: { size: 57, total: 346, ec: 130, data: 216, align: [6, 28, 50] },
};

function selectVersion(dataLength: number): number {
  for (let v = 1; v <= 10; v++) {
    const countBits = v <= 9 ? 8 : 16;
    const overhead = Math.ceil((4 + countBits + dataLength * 8 + 4) / 8);
    if (VERSION_INFO[v].data >= overhead) {
      return v;
    }
  }
  return 10;
}

class BitBuffer {
  buffer: number[] = [];
  length = 0;

  put(num: number, length: number) {
    for (let i = 0; i < length; i++) {
      this.putBit(((num >>> (length - i - 1)) & 1) === 1);
    }
  }

  putBit(bit: boolean) {
    const bufIndex = Math.floor(this.length / 8);
    if (this.buffer.length <= bufIndex) {
      this.buffer.push(0);
    }
    if (bit) {
      this.buffer[bufIndex] |= 0x80 >>> (this.length % 8);
    }
    this.length++;
  }
}

export function generateQRCodeSVG(text: string): string {
  const utf8Bytes = new TextEncoder().encode(text);
  const version = selectVersion(utf8Bytes.length);
  const info = VERSION_INFO[version];

  const bb = new BitBuffer();
  bb.put(0b0100, 4); // Byte mode
  bb.put(utf8Bytes.length, version <= 9 ? 8 : 16);
  for (const b of utf8Bytes) {
    bb.put(b, 8);
  }

  // Terminator
  const maxDataBits = info.data * 8;
  const paddingNeeded = Math.min(4, maxDataBits - bb.length);
  if (paddingNeeded > 0) {
    bb.put(0, paddingNeeded);
  }
  // Byte align
  while (bb.length % 8 !== 0) {
    bb.putBit(false);
  }
  // Pad bytes
  const padPatterns = [0xec, 0x11];
  let padIdx = 0;
  while (bb.length < maxDataBits) {
    bb.put(padPatterns[padIdx % 2], 8);
    padIdx++;
  }

  const dataCodewords = bb.buffer.slice(0, info.data);
  const ecCodewords = calculateReedSolomon(dataCodewords, info.ec);
  const allCodewords = [...dataCodewords, ...ecCodewords];

  // Initialize matrix
  const size = info.size;
  const matrix: (boolean | null)[][] = Array.from({ length: size }, () => new Array(size).fill(null));

  // Finder pattern helper
  const placeFinder = (rStart: number, cStart: number) => {
    for (let r = 0; r < 7; r++) {
      for (let c = 0; c < 7; c++) {
        const isBorder = r === 0 || r === 6 || c === 0 || c === 6;
        const isCore = r >= 2 && r <= 4 && c >= 2 && c <= 4;
        matrix[rStart + r][cStart + c] = isBorder || isCore;
      }
    }
    // Separator ring
    for (let r = -1; r <= 7; r++) {
      for (let c = -1; c <= 7; c++) {
        const row = rStart + r;
        const col = cStart + c;
        if (row >= 0 && row < size && col >= 0 && col < size) {
          if (matrix[row][col] === null) {
            matrix[row][col] = false;
          }
        }
      }
    }
  };

  placeFinder(0, 0);
  placeFinder(0, size - 7);
  placeFinder(size - 7, 0);

  // Timing patterns
  for (let i = 8; i < size - 8; i++) {
    if (matrix[6][i] === null) matrix[6][i] = i % 2 === 0;
    if (matrix[i][6] === null) matrix[i][6] = i % 2 === 0;
  }

  // Dark module
  matrix[4 * version + 9][8] = true;

  // Alignment patterns
  if (info.align.length > 0) {
    for (const r of info.align) {
      for (const c of info.align) {
        if (matrix[r][c] !== null) continue;
        for (let dr = -2; dr <= 2; dr++) {
          for (let dc = -2; dc <= 2; dc++) {
            const isBorder = Math.abs(dr) === 2 || Math.abs(dc) === 2;
            const isCenter = dr === 0 && dc === 0;
            matrix[r + dr][c + dc] = isBorder || isCenter;
          }
        }
      }
    }
  }

  // Format info area reservation
  for (let i = 0; i < 9; i++) {
    if (matrix[8][i] === null) matrix[8][i] = false;
    if (matrix[i][8] === null) matrix[i][8] = false;
    if (matrix[8][size - 1 - i] === null) matrix[8][size - 1 - i] = false;
    if (matrix[size - 1 - i][8] === null) matrix[size - 1 - i][8] = false;
  }

  // Place codewords
  let codewordIdx = 0;
  let bitIdx = 7;
  let upwards = true;

  for (let c = size - 1; c > 0; c -= 2) {
    if (c === 6) c--; // Skip vertical timing line
    for (let count = 0; count < size; count++) {
      const r = upwards ? size - 1 - count : count;
      for (let col = c; col >= c - 1; col--) {
        if (matrix[r][col] === null) {
          let bit = false;
          if (codewordIdx < allCodewords.length) {
            bit = ((allCodewords[codewordIdx] >>> bitIdx) & 1) === 1;
            bitIdx--;
            if (bitIdx < 0) {
              bitIdx = 7;
              codewordIdx++;
            }
          }
          // Apply standard mask (pattern 0: (r + c) % 2 === 0)
          const mask = (r + col) % 2 === 0;
          matrix[r][col] = mask ? !bit : bit;
        }
      }
    }
    upwards = !upwards;
  }

  // Format info bits for Level M, Mask 0: 0x5412 XOR 0x5412 = 0x0000
  const formatBits = [1, 0, 1, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0];
  const formatCoordinates = [
    [8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5], [8, 7], [8, 8],
    [7, 8], [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8]
  ];
  for (let i = 0; i < 15; i++) {
    const val = formatBits[i] === 1;
    const [r, c] = formatCoordinates[i];
    matrix[r][c] = val;
    if (i < 8) {
      matrix[size - 1 - i][8] = val;
    } else {
      matrix[8][size - 15 + i] = val;
    }
  }

  // Generate SVG path
  let path = '';
  const scale = 8;
  const margin = 4;
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (matrix[r][c]) {
        path += `M${(c + margin) * scale},${(r + margin) * scale}h${scale}v${scale}h-${scale}z `;
      }
    }
  }

  const totalDimension = (size + margin * 2) * scale;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${totalDimension} ${totalDimension}"><rect width="100%" height="100%" fill="#ffffff"/><path d="${path}" fill="#000000"/></svg>`;
}

export function generateQRCodeDataURL(text: string): string {
  const svg = generateQRCodeSVG(text);
  const base64 = Buffer.from(svg).toString('base64');
  return `data:image/svg+xml;base64,${base64}`;
}
