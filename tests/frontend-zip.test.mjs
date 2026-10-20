import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

const source = await readFile(new URL('../sites-zip.js', import.meta.url), 'utf8');
const moduleUrl = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const { createZip } = await import(moduleUrl);

function u16(bytes, offset) { return bytes[offset] | (bytes[offset + 1] << 8); }
function u32(bytes, offset) { return (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0; }

test('createZip writes local and central records with intact UTF-8 names and bytes', () => {
  const input = [{ name: 'index.html', data: new TextEncoder().encode('<h1>Hi</h1>') }, { name: 'assets/雪.txt', data: new Uint8Array([0, 1, 255]) }];
  const zip = createZip(input);
  assert.equal(u32(zip, 0), 0x04034b50);
  assert.equal(u16(zip, 6) & 0x0800, 0x0800, 'UTF-8 flag set');
  const nameLength = u16(zip, 26), dataLength = u32(zip, 18);
  assert.equal(new TextDecoder().decode(zip.slice(30, 30 + nameLength)), 'index.html');
  assert.deepEqual([...zip.slice(30 + nameLength, 30 + nameLength + dataLength)], [...input[0].data]);
  const central = zip.findIndex((_, i) => i + 4 <= zip.length && u32(zip, i) === 0x02014b50);
  assert.ok(central > 0);
  assert.equal(u16(zip, central + 8) & 0x0800, 0x0800);
  assert.equal(u32(zip, zip.length - 22), 0x06054b50);
  assert.equal(u16(zip, zip.length - 12), 2);
});

test('generated ZIP is readable by Python zipfile with paths preserved', () => {
  const zip = createZip([{ name: 'index.html', data: new TextEncoder().encode('hello') }, { name: 'nested/file.txt', data: new TextEncoder().encode('world') }]);
  const script = 'import io,sys,zipfile; z=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read())); assert z.namelist()==["index.html","nested/file.txt"]; assert z.read("nested/file.txt")==b"world"; print("ok")';
  const result = spawnSync('python3', ['-c', script], { input: Buffer.from(zip), encoding: 'utf8' });
  if (result.error?.code === 'ENOENT') return t.skip('Python is unavailable');
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /ok/);
});

test('createZip rejects unsupported ZIP entry counts and oversized paths', () => {
  assert.throws(() => createZip(Array(65536).fill({ name: 'a', data: new Uint8Array() })), /65,535/);
  assert.throws(() => createZip([{ name: 'x'.repeat(65536), data: new Uint8Array() }]), /path is too long/);
});
