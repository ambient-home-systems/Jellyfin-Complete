// A video file's own title (ADR-044): the title in the container itself, which Jellyfin doesn't expose (it shows only
// the streams' title tags). This is the tag that gave "Bewitched (2005)" away inside a file labelled Black Panther:
// Wakanda Forever. Read straight from the file, from a read-only media mount, touching only the few kilobytes that
// hold it, so no ffprobe is needed:
// - Matroska and WebM: Segment → Info → Title (found directly, or through the SeekHead when Info isn't near the start).
// - MP4, M4V and MOV: moov → udta → ©nam (QuickTime), or moov → udta → meta → ilst → ©nam → data (iTunes-style).
// - AVI: RIFF → LIST INFO → INAM.
import { open, type FileHandle } from 'node:fs/promises';

const MKV = { EBML: 0x1a45dfa3, Segment: 0x18538067, SeekHead: 0x114d9b74, Seek: 0x4dbb, SeekID: 0x53ab, SeekPosition: 0x53ac, Info: 0x1549a966, Title: 0x7ba9, Cluster: 0x1f43b675 };
const HEAD = 256 * 1024;

async function read(fh: FileHandle, position: number, length: number): Promise<Buffer> {
  const buf = Buffer.alloc(length);
  const { bytesRead } = await fh.read(buf, 0, length, position);
  return buf.subarray(0, bytesRead);
}

/** An EBML variable-length number at `p`: its length, and its value (marker kept for IDs, removed for sizes). */
function vint(b: Buffer, p: number, keepMarker: boolean): { len: number; value: number; unknown: boolean } | null {
  const first = b[p];
  if (first === undefined || first === 0) return null;
  const len = Math.clz32(first) - 23; // leading zeros within the byte, plus one
  if (len > 8 || p + len > b.length) return null;
  let value = keepMarker ? first : first & (0xff >> len);
  let allOnes = value === (0xff >> len);
  for (let i = 1; i < len; i++) {
    value = value * 256 + b[p + i]!;
    if (b[p + i] !== 0xff) allOnes = false;
  }
  return { len, value, unknown: !keepMarker && allOnes };
}

type El = { id: number; dataStart: number; size: number; end: number };
function element(b: Buffer, p: number): El | null {
  const id = vint(b, p, true);
  if (!id) return null;
  const size = vint(b, p + id.len, false);
  if (!size) return null;
  const dataStart = p + id.len + size.len;
  return { id: id.value, dataStart, size: size.unknown ? Infinity : size.value, end: size.unknown ? Infinity : dataStart + size.value };
}

const clean = (s: string) => s.replace(/\0+$/, '').trim() || null;

/** The Title inside an Info element's data (in `b`, from `start` to `end`). */
function infoTitle(b: Buffer, start: number, end: number): string | null {
  let p = start;
  while (p < Math.min(end, b.length)) {
    const e = element(b, p);
    if (!e || e.end === Infinity) return null;
    if (e.id === MKV.Title) return e.end <= b.length ? clean(b.toString('utf8', e.dataStart, e.end)) : null; // never half a title
    p = e.end;
  }
  return null;
}

async function matroskaTitle(fh: FileHandle): Promise<string | null> {
  const b = await read(fh, 0, HEAD);
  const ebml = element(b, 0);
  if (!ebml || ebml.id !== MKV.EBML || ebml.end === Infinity) return null;
  const seg = element(b, ebml.end);
  if (!seg || seg.id !== MKV.Segment) return null;
  let p = seg.dataStart;
  let infoAt: number | null = null;
  while (p < b.length - 12) {
    const e = element(b, p);
    if (!e) break;
    if (e.id === MKV.Info) {
      if (e.end <= b.length) return infoTitle(b, e.dataStart, e.end);
      infoAt = p;
      break;
    }
    if (e.id === MKV.SeekHead && e.end <= b.length) {
      // Each Seek names an element by ID and its position from the start of the Segment's data.
      let q = e.dataStart;
      while (q < e.end) {
        const seek = element(b, q);
        if (!seek || seek.end === Infinity) break;
        if (seek.id === MKV.Seek) {
          let r = seek.dataStart, id: number | null = null, pos: number | null = null;
          while (r < seek.end) {
            const c = element(b, r);
            if (!c || c.end === Infinity) break;
            if (c.id === MKV.SeekID) id = vint(b, c.dataStart, true)?.value ?? null;
            if (c.id === MKV.SeekPosition) { pos = 0; for (let i = c.dataStart; i < c.end; i++) pos = pos * 256 + b[i]!; }
            r = c.end;
          }
          if (id === MKV.Info && pos !== null) infoAt = seg.dataStart + pos;
        }
        q = seek.end;
      }
    }
    if (e.id === MKV.Cluster || e.end === Infinity) break;
    p = e.end;
  }
  if (infoAt === null) return null;
  const at = await read(fh, infoAt, 64 * 1024);
  const info = element(at, 0);
  return info && info.id === MKV.Info ? infoTitle(at, info.dataStart, info.end) : null;
}

type Box = { type: string; start: number; data: number; end: number };
/** The boxes between `start` and `end`, reading only their 16-byte headers. */
async function* boxes(fh: FileHandle, start: number, end: number): AsyncGenerator<Box> {
  let p = start;
  for (let n = 0; p + 8 <= end && n < 10_000; n++) {
    const h = await read(fh, p, 16);
    if (h.length < 8) return;
    let size = h.readUInt32BE(0);
    let header = 8;
    if (size === 1) { if (h.length < 16) return; size = Number(h.readBigUInt64BE(8)); header = 16; }
    else if (size === 0) size = end - p;
    if (size < header) return;
    yield { type: h.toString('latin1', 4, 8), start: p, data: p + header, end: Math.min(p + size, end) };
    p += size;
  }
}
const child = async (fh: FileHandle, parent: { data: number; end: number }, type: string) => {
  for await (const b of boxes(fh, parent.data, parent.end)) if (b.type === type) return b;
  return null;
};

async function mp4Title(fh: FileHandle, size: number): Promise<string | null> {
  let moov: Box | null = null;
  for await (const b of boxes(fh, 0, size)) if (b.type === 'moov') { moov = b; break; }
  if (!moov) return null;
  const udta = await child(fh, moov, 'udta');
  if (!udta) return null;
  const NAM = '©nam';
  // QuickTime: udta → ©nam holds [length (2), language (2), text].
  const qt = await child(fh, udta, NAM);
  if (qt) {
    const b = await read(fh, qt.data, Math.min(qt.end - qt.data, 4096));
    const len = b.readUInt16BE(0);
    if (len && len + 4 <= b.length) return clean(b.toString('utf8', 4, 4 + len));
  }
  // iTunes-style: udta → meta (a full box: 4 bytes of version and flags, unless a QuickTime meta) → ilst → ©nam → data.
  const meta = await child(fh, udta, 'meta');
  if (!meta) return null;
  const peek = await read(fh, meta.data, 8);
  const inner = { data: meta.data + (peek.toString('latin1', 4, 8) === 'hdlr' ? 0 : 4), end: meta.end };
  const ilst = await child(fh, inner, 'ilst');
  const nam = ilst ? await child(fh, ilst, NAM) : null;
  const data = nam ? await child(fh, nam, 'data') : null;
  if (!data) return null;
  const b = await read(fh, data.data, Math.min(data.end - data.data, 4096));
  return b.length > 8 ? clean(b.toString('utf8', 8)) : null;
}

async function aviTitle(fh: FileHandle, size: number): Promise<string | null> {
  // RIFF chunks: [id (4), size (4, little-endian), data, padding to even].
  let p = 12;
  for (let n = 0; p + 12 <= size && n < 10_000; n++) {
    const h = await read(fh, p, 12);
    if (h.length < 8) return null;
    const id = h.toString('latin1', 0, 4), len = h.readUInt32LE(4);
    if (id === 'LIST' && h.toString('latin1', 8, 12) === 'INFO') {
      const b = await read(fh, p + 12, Math.min(len - 4, 64 * 1024));
      let q = 0;
      while (q + 8 <= b.length) {
        const sid = b.toString('latin1', q, q + 4), slen = b.readUInt32LE(q + 4);
        if (sid === 'INAM') return clean(b.toString('utf8', q + 8, Math.min(q + 8 + slen, b.length)));
        q += 8 + slen + (slen % 2);
      }
      return null;
    }
    p += 8 + len + (len % 2);
  }
  return null;
}

/**
 * The title stored in a video file's container, or null if it has none (or the format isn't one of the above). Reads
 * a few kilobytes; never throws for a bad or unknown file, only when the file can't be opened.
 */
export async function containerTitle(path: string): Promise<string | null> {
  const fh = await open(path, 'r');
  try {
    const size = (await fh.stat()).size;
    const head = await read(fh, 0, 12);
    try {
      if (head.readUInt32BE(0) === MKV.EBML) return await matroskaTitle(fh);
      if (head.toString('latin1', 0, 4) === 'RIFF' && head.toString('latin1', 8, 12) === 'AVI ') return await aviTitle(fh, size);
      if (['ftyp', 'moov', 'wide', 'mdat', 'free', 'skip'].includes(head.toString('latin1', 4, 8))) return await mp4Title(fh, size);
    } catch {
      return null; // a truncated or odd file: no title rather than a failed check
    }
    return null;
  } finally {
    await fh.close();
  }
}
