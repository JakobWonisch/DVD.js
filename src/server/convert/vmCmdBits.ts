/**
 * Bit helpers for DVD VM 8-byte commands (PCI btnit / PGC command_tbl).
 * Bit numbering matches libdvdnav / src/vm/recompile.ts getbits().
 */

'use strict';

/** Convert 8 command bytes to the 64-bit binary string used by getbits(). */
export function vmCmdBitString(bytes: number[] | null | undefined): string | null {
  if (!bytes || bytes.length < 8) {
    return null;
  }
  var out = '';
  for (var i = 0; i < 8; i++) {
    out += (bytes[i] & 0xff).toString(2).padStart(8, '0');
  }
  return out;
}

/**
 * Extract `count` bits ending at bit `start` (MSB of the field), from a
 * 64-bit command bit string (bit 63 = first bit of byte 0).
 */
export function vmGetbits(
  instruction: string,
  start: number,
  count: number,
): number {
  if (count === 0) {
    return 0;
  }
  if (
    start - count < -1 ||
    count < 0 ||
    start < 0 ||
    count > 32 ||
    start > 63
  ) {
    return 0;
  }
  return parseInt(instruction.substr(63 - start, count), 2) || 0;
}

export type VmCmdBytes =
  | number[]
  | { bytes?: number[] | null }
  | null
  | undefined;

/** Normalize command_tbl / btnit cmd shapes to an 8-byte array. */
export function vmCmdBytesOf(cmd: VmCmdBytes): number[] | null {
  if (!cmd) {
    return null;
  }
  if (Array.isArray(cmd)) {
    return cmd.length >= 8 ? cmd : null;
  }
  if (Array.isArray(cmd.bytes) && cmd.bytes.length >= 8) {
    return cmd.bytes;
  }
  return null;
}
