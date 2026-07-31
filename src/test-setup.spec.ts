import { describe, expect, it } from 'vitest';

/**
 * Guards the `Blob.prototype.arrayBuffer` back-fill installed by `test-setup.ts`.
 * The service under test (`pages/rentals/inspection-pdf.service.ts`) silently
 * falls back when image bytes are unusable, so a stub returning an empty buffer
 * would keep its specs green while hiding a broken read. These assertions fail
 * on any such complacent implementation.
 */
describe('Blob.prototype.arrayBuffer (test environment)', () => {
  it('is available', () => {
    expect(typeof Blob.prototype.arrayBuffer).toBe('function');
  });

  it('resolves with the Blob real bytes, not an empty buffer', async () => {
    const source = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
    const buffer = await new Blob([source], { type: 'image/jpeg' }).arrayBuffer();

    expect(buffer.byteLength).toBe(source.byteLength);
    expect(Array.from(new Uint8Array(buffer))).toEqual(Array.from(source));
  });

  it('concatenates multi-part Blobs in order', async () => {
    const blob = new Blob([new Uint8Array([1, 2]), new Uint8Array([3, 4])]);

    expect(Array.from(new Uint8Array(await blob.arrayBuffer()))).toEqual([1, 2, 3, 4]);
  });

  it('resolves with an empty buffer only for an empty Blob', async () => {
    expect((await new Blob([]).arrayBuffer()).byteLength).toBe(0);
  });
});
