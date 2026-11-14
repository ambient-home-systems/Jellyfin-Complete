// Reading a video file's own title from its container (ADR-044), without ffprobe: Matroska/WebM, MP4/MOV and AVI.
import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { containerTitle } from '../src/library/container.js';

const dir = mkdtempSync(join(tmpdir(), 'mc-container-'));
const file = (name: string, bytes: Buffer) => { const p = join(dir, name); writeFileSync(p, bytes); return p; };

// --- Matroska: EBML elements are [ID][size as a variable-length number][data].
const size = (n: number) => {
  if (n < 0x7f) return Buffer.from([0x80 | n]);
  if (n < 0x3fff) return Buffer.from([0x40 | (n >> 8), n & 0xff]);
  return Buffer.from([0x10 | ((n >> 24) & 0x0f), (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff]);
};
const ebml = (id: number[], ...data: Buffer[]) => { const d = Buffer.concat(data); return Buffer.concat([Buffer.from(id), size(d.length), d]); };
const header = ebml([0x1a, 0x45, 0xdf, 0xa3], ebml([0x42, 0x82], Buffer.from('matroska')));
const info = (title: string) => ebml([0x15, 0x49, 0xa9, 0x66], ebml([0x2a, 0xd7, 0xb1], Buffer.from([0x0f, 0x42, 0x40])), ebml([0x7b, 0xa9], Buffer.from(title)), ebml([0x4d, 0x80], Buffer.from('libebml')));
const UNKNOWN = Buffer.from([0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]);
const segment = (...children: Buffer[]) => Buffer.concat([Buffer.from([0x18, 0x53, 0x80, 0x67]), UNKNOWN, ...children]);
const cluster = ebml([0x1f, 0x43, 0xb6, 0x75], Buffer.alloc(64));

// --- MP4: boxes are [size (4)][type (4)][data].
const box = (type: string, ...data: Buffer[]) => { const d = Buffer.concat(data); const h = Buffer.alloc(8); h.writeUInt32BE(d.length + 8); h.write(type, 4, 'latin1'); return Buffer.concat([h, d]); };
const NAM = '©nam';

describe('a video file’s own title', () => {
  it('reads it from a Matroska file’s Info', async () => {
    expect(await containerTitle(file('a.mkv', Buffer.concat([header, segment(info('Bewitched (2005) 2160p'), cluster)])))).toBe('Bewitched (2005) 2160p');
  });

  it('finds Info through the SeekHead when it sits far into the file', async () => {
    // SeekHead → Info at a position past the first 256 KB (after a large Void element).
    const voidEl = ebml([0xec], Buffer.alloc(300 * 1024));
    const infoEl = info('The Lucky One (2012)');
    const seekHeadFor = (pos: number) => ebml([0x11, 0x4d, 0x9b, 0x74], ebml([0x4d, 0xbb], ebml([0x53, 0xab], Buffer.from([0x15, 0x49, 0xa9, 0x66])), ebml([0x53, 0xac], Buffer.from([(pos >> 24) & 0xff, (pos >> 16) & 0xff, (pos >> 8) & 0xff, pos & 0xff]))));
    const placeholder = seekHeadFor(0);
    const pos = placeholder.length + voidEl.length; // from the start of the Segment's data
    expect(await containerTitle(file('b.mkv', Buffer.concat([header, segment(seekHeadFor(pos), voidEl, infoEl, cluster)])))).toBe('The Lucky One (2012)');
  });

  it('reads an iTunes-style MP4 title and a QuickTime MOV title', async () => {
    const ftyp = box('ftyp', Buffer.from('isom\0\0\0\0isomiso2'));
    const dataBox = box('data', Buffer.from([0, 0, 0, 1, 0, 0, 0, 0]), Buffer.from('Trans-Siberian Orchestra - The Ghosts of Christmas Eve (1999)'));
    const itunes = box('meta', Buffer.alloc(4), box('hdlr', Buffer.alloc(25)), box('ilst', box(NAM, dataBox)));
    const mp4 = Buffer.concat([ftyp, box('mdat', Buffer.alloc(1000)), box('moov', box('mvhd', Buffer.alloc(100)), box('udta', itunes))]); // moov at the end
    expect(await containerTitle(file('c.mp4', mp4))).toBe('Trans-Siberian Orchestra - The Ghosts of Christmas Eve (1999)');
    const qtText = Buffer.from('Home Movie (1999)');
    const qt = Buffer.alloc(4); qt.writeUInt16BE(qtText.length, 0); qt.writeUInt16BE(0x55c4, 2);
    const mov = Buffer.concat([box('ftyp', Buffer.from('qt  \0\0\0\0qt  ')), box('moov', box('udta', box(NAM, qt, qtText)))]);
    expect(await containerTitle(file('d.mov', mov))).toBe('Home Movie (1999)');
  });

  it('reads an AVI’s INAM', async () => {
    const chunk = (id: string, data: Buffer) => { const h = Buffer.alloc(8); h.write(id, 0, 'latin1'); h.writeUInt32LE(data.length, 4); return Buffer.concat([h, data, data.length % 2 ? Buffer.alloc(1) : Buffer.alloc(0)]); };
    const list = (type: string, ...c: Buffer[]) => chunk('LIST', Buffer.concat([Buffer.from(type, 'latin1'), ...c]));
    const body = Buffer.concat([Buffer.from('AVI ', 'latin1'), list('hdrl', chunk('avih', Buffer.alloc(56))), list('INFO', chunk('ISFT', Buffer.from('Lavf\0')), chunk('INAM', Buffer.from('Something Else (1999)\0'))), list('movi', Buffer.alloc(32))]);
    expect(await containerTitle(file('e.avi', chunk('RIFF', body).subarray(0)))).toBe('Something Else (1999)');
  });

  it('says none for a file without one, an unknown format or a truncated file', async () => {
    expect(await containerTitle(file('f.mkv', Buffer.concat([header, segment(ebml([0x15, 0x49, 0xa9, 0x66], ebml([0x4d, 0x80], Buffer.from('x'))), cluster)])))).toBeNull();
    expect(await containerTitle(file('g.bin', Buffer.from('not a video at all')))).toBeNull();
    expect(await containerTitle(file('h.mkv', Buffer.concat([header, segment(info('Cut Short (2001)')).subarray(0, 30)])))).toBeNull();
    await expect(containerTitle(join(dir, 'missing.mkv'))).rejects.toThrow();
  });
});
