/**
 * Pack DVD VM instruction bit fields into an 8-byte command.
 *
 * Bit numbering matches recompile/libdvdnav getbits():
 * - Bit 63 is the MSB of byte 0 (leftmost bit of the 64-bit instruction).
 * - getbits(instruction, start, count) reads `count` bits ending at bit
 *   `start` (inclusive high end): field occupies bits (start - count + 1) … start.
 */

export type BitField = {
  /** High bit index of the field (0–63), same as getbits `start`. */
  start: number;
  /** Width in bits (1–32). */
  count: number;
  value: number;
};

/** Zero-filled 8-byte command. */
export function emptyCommand(): number[] {
  return [0, 0, 0, 0, 0, 0, 0, 0];
}

/**
 * Convert 8 bytes to the 64-char binary string used by recompile getbits.
 */
export function bytesToBitString(bytes: number[]): string {
  if (bytes.length !== 8) {
    throw new Error(`Expected 8 bytes, got ${bytes.length}`);
  }
  return bytes
    .map((byte) => {
      if (!Number.isInteger(byte) || byte < 0 || byte > 255) {
        throw new Error(`Invalid byte: ${byte}`);
      }
      return byte.toString(2).padStart(8, '0');
    })
    .join('');
}

/**
 * Mirror of recompile getbits for packer round-trips and fixture checks.
 */
export function getbits(instruction: string, start: number, count: number): number {
  if (count === 0) {
    return 0;
  }
  if (start - count < -1 || count < 0 || start < 0 || count > 32 || start > 63) {
    throw new Error(`Bad getbits(${start}, ${count})`);
  }
  return Number.parseInt(instruction.substr(63 - start, count), 2);
}

export function getbitsFromBytes(bytes: number[], start: number, count: number): number {
  return getbits(bytesToBitString(bytes), start, count);
}

/**
 * Set a bit field into a mutable 8-byte array (in place).
 * Overwrites only the bits in the field; other bits are preserved.
 */
export function setBits(bytes: number[], start: number, count: number, value: number): void {
  if (count === 0) {
    return;
  }
  if (start - count < -1 || count < 0 || start < 0 || count > 32 || start > 63) {
    throw new Error(`Bad setBits(${start}, ${count})`);
  }
  const max = count === 32 ? 0xffffffff : (1 << count) - 1;
  if (value < 0 || value > max) {
    throw new Error(`Value ${value} out of range for ${count}-bit field`);
  }

  // Walk each bit of the field from high (start) down to (start - count + 1).
  for (let i = 0; i < count; i++) {
    const bitIndex = start - i;
    const bitVal = (value >> (count - 1 - i)) & 1;
    const byteIndex = Math.floor((63 - bitIndex) / 8);
    const bitInByte = 7 - ((63 - bitIndex) % 8);
    if (bitVal) {
      bytes[byteIndex]! |= 1 << bitInByte;
    } else {
      bytes[byteIndex]! &= ~(1 << bitInByte);
    }
  }
}

/**
 * Pack one or more bit fields into an 8-byte command (fresh array).
 */
export function packCommand(fields: BitField[], base: number[] = emptyCommand()): number[] {
  const bytes = base.slice();
  if (bytes.length !== 8) {
    throw new Error(`Expected 8-byte base, got ${bytes.length}`);
  }
  for (const field of fields) {
    setBits(bytes, field.start, field.count, field.value);
  }
  return bytes;
}

/** Convenience: command object shape used by recompile / IFO JSON. */
export function cmd(bytes: number[]): { bytes: number[] } {
  return { bytes };
}
