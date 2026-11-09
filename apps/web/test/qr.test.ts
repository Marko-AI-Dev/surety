import { describe, expect, it } from "vitest";
import { QR_MAX_BYTES, dataCodewords, formatBits, interleave, qrMatrix, qrPath, reedSolomon, versionFor } from "../src/data/qr";

const bytes = (s: string) => new TextEncoder().encode(s);

describe("the QR encoder", () => {
  it("computes the published Reed-Solomon example (version 1-M, HELLO WORLD)", () => {
    const data = [32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236, 17, 236, 17];
    expect(reedSolomon(data, 10)).toEqual([196, 35, 39, 119, 235, 215, 231, 226, 93, 23]);
  });

  it("computes the published format bits for level M", () => {
    expect(formatBits(0)).toBe(0b101010000010010);
    expect(formatBits(5)).toBe(0b100000011001110);
  });

  it("picks the smallest version that holds the text and refuses one that is too long", () => {
    expect(versionFor(14)).toBe(1);
    expect(versionFor(15)).toBe(2);
    expect(versionFor(42)).toBe(3);
    expect(versionFor(QR_MAX_BYTES)).toBe(9);
    expect(() => versionFor(QR_MAX_BYTES + 1)).toThrow(RangeError);
  });

  it("writes mode, length, bytes, terminator and alternating pad bytes", () => {
    const cw = dataCodewords(bytes("hi"), 1);
    // 0100 00000010 01101000 01101001 0000, then pad bytes to 16 codewords.
    expect(cw.slice(0, 4)).toEqual([0x40, 0x26, 0x86, 0x90]);
    expect(cw).toHaveLength(16);
    expect(cw.slice(4, 8)).toEqual([0xec, 0x11, 0xec, 0x11]);
  });

  it("interleaves blocks of unequal length without losing a codeword (version 8: 2 x 38 and 2 x 39)", () => {
    const data = Array.from({ length: 154 }, (_, i) => i);
    const out = interleave(data, 8);
    expect(out).toHaveLength(154 + 4 * 22);
    expect(out.slice(0, 4)).toEqual([0, 38, 76, 115]);
    expect([...out.slice(0, 154)].sort((a, b) => a - b)).toEqual(data);
  });

  it("draws a square of the right size with the three finder patterns and the timing lines", () => {
    const text = "http://192.168.1.23:5173/#/supplier";
    const m = qrMatrix(text);
    const size = 17 + 4 * versionFor(bytes(text).length);
    expect(m).toHaveLength(size);
    expect(m.every((row) => row.length === size)).toBe(true);
    const finder = (y0: number, x0: number) =>
      [0, 1, 2, 3, 4, 5, 6].map((d) => m[y0 + 3]?.[x0 + d]).map((v) => (v ? "1" : "0")).join("") +
      [0, 1, 2, 3, 4, 5, 6].map((d) => m[y0 + d]?.[x0 + 3]).map((v) => (v ? "1" : "0")).join("");
    for (const [y, x] of [[0, 0], [0, size - 7], [size - 7, 0]] as const) expect(finder(y, x)).toBe("10111011011101");
    for (let i = 8; i < size - 8; i++) {
      expect(m[6]?.[i]).toBe(i % 2 === 0);
      expect(m[i]?.[6]).toBe(i % 2 === 0);
    }
    expect(m[size - 8]?.[8]).toBe(true);
  });

  it("is deterministic and different texts give different codes", () => {
    const a = qrMatrix("https://surety.example/#/supplier");
    expect(qrMatrix("https://surety.example/#/supplier")).toEqual(a);
    expect(qrMatrix("https://surety.example/#/supplies")).not.toEqual(a);
  });

  it("renders one path with a four-module quiet zone", () => {
    const m = qrMatrix("hi");
    const { d, size } = qrPath(m);
    expect(size).toBe(21 + 8);
    expect(d.startsWith("M4 4h7")).toBe(true);
  });
});
