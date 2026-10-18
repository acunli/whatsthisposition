#!/usr/bin/env python3
"""Bakes the home page's 3D knight into public/models/knight/.

Source: the "Chess Set" model by Riley Queen on Poly Haven (CC0,
https://polyhaven.com/a/chess_set). Only the white knight's mesh is used (both colours
share it); its textures are the set's marble atlases with everything that isn't the
knight blanked, so they compress to a few kilobytes.

Output:
  knight.bin                        geometry, quantized: "WTPK", version, vertex count,
                                    index count, bounding box (lo xyz, size xyz, float32),
                                    then uint16 positions, int16 normals, uint16 uvs,
                                    uint16 indices (read by src/components/home/HeroKnight.tsx)
  knight-{white,black}-color.webp   base colour (sRGB)
  knight-{white,black}-normal.webp  OpenGL normal map
  knight-{white,black}-arm.webp     ambient occlusion, roughness, metalness

Usage (needs Pillow; downloads go to a folder of your choice, outside the repo):
  D=/tmp/chess-set; mkdir -p $D/textures; cd $D
  B=https://dl.polyhaven.org/file/ph-assets/Models
  curl -O $B/gltf/1k/chess_set/chess_set_1k.gltf -O $B/gltf/1k/chess_set/chess_set.bin
  for c in white black; do for k in diff nor_gl arm; do
    curl -o textures/chess_set_pieces_${c}_${k}_2k.jpg $B/jpg/2k/chess_set/chess_set_pieces_${c}_${k}_2k.jpg
  done; done
  python3 scripts/bake-knight.py $D public/models/knight 1024
"""
import json, struct, sys, os
from PIL import Image, ImageDraw, ImageFilter, ImageStat
D, OUT = sys.argv[1], sys.argv[2]
g = json.load(open(D + '/chess_set_1k.gltf')); b = open(D + '/chess_set.bin', 'rb').read()
def acc(i):
    a = g['accessors'][i]; bv = g['bufferViews'][a['bufferView']]
    off = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
    n = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}[a['type']]
    fmt = {5126: 'f', 5123: 'H', 5125: 'I'}[a['componentType']]
    sz = struct.calcsize(fmt); stride = bv.get('byteStride', sz * n)
    return [struct.unpack_from('<' + fmt * n, b, off + k * stride) for k in range(a['count'])]
p = g['meshes'][5]['primitives'][0]
pos = acc(p['attributes']['POSITION']); nor = acc(p['attributes']['NORMAL']); uv = acc(p['attributes']['TEXCOORD_0'])
idx = [i[0] for i in acc(p['indices'])]
n, m = len(pos), len(idx)
mn = [min(v[k] for v in pos) for k in range(3)]; mx = [max(v[k] for v in pos) for k in range(3)]
# Model units: centred on x/z, standing on y = 0, 1.45 tall (the hero's scale).
H = 1.45; s = H / (mx[1] - mn[1])
cx, cz = (mn[0] + mx[0]) / 2, (mn[2] + mx[2]) / 2
P = [((x - cx) * s, (y - mn[1]) * s, (z - cz) * s) for x, y, z in pos]
lo = [min(v[k] for v in P) for k in range(3)]; size = [max(v[k] for v in P) - lo[k] for k in range(3)]
q = lambda v, k: max(0, min(65535, round((v - lo[k]) / size[k] * 65535)))
def nq(x): return max(-32767, min(32767, round(x * 32767)))
buf = bytearray()
buf += b'WTPK' + struct.pack('<III', 1, n, m) + struct.pack('<6f', *lo, *size)
for v in P: buf += struct.pack('<3H', q(v[0], 0), q(v[1], 1), q(v[2], 2))
for v in nor:
    l = (v[0]**2 + v[1]**2 + v[2]**2) ** 0.5 or 1
    buf += struct.pack('<3h', nq(v[0] / l), nq(v[1] / l), nq(v[2] / l))
for u, w in uv: buf += struct.pack('<2H', round(min(1, max(0, u)) * 65535), round(min(1, max(0, w)) * 65535))
buf += struct.pack('<%dH' % m, *idx)
open(OUT + '/knight.bin', 'wb').write(buf)
print('geometry', n, 'verts', m // 3, 'tris', len(buf), 'bytes; size', [round(x, 3) for x in size], 'lo', [round(x, 3) for x in lo])

# Texture mask: the knight's UV triangles, grown a little so mipmaps don't bleed in the fill.
RES = int(sys.argv[3]) if len(sys.argv) > 3 else 1024
mask = Image.new('L', (RES, RES), 0); dm = ImageDraw.Draw(mask)
for t in range(0, m, 3):
    dm.polygon([(uv[idx[t + k]][0] * RES, uv[idx[t + k]][1] * RES) for k in range(3)], fill=255)
mask = mask.filter(ImageFilter.MaxFilter(9))
for colour in ('white', 'black'):
    for kind, fill, q in (('diff', None, 82), ('nor_gl', (128, 128, 255), 86), ('arm', None, 80)):
        src = Image.open(f'{D}/textures/chess_set_pieces_{colour}_{kind}_2k.jpg').convert('RGB').resize((RES, RES), Image.LANCZOS)
        if fill is None: fill = tuple(int(c) for c in ImageStat.Stat(src, mask).mean)
        out = Image.composite(src, Image.new('RGB', (RES, RES), fill), mask)
        name = {'diff': 'color', 'nor_gl': 'normal', 'arm': 'arm'}[kind]
        path = f'{OUT}/knight-{colour}-{name}.webp'
        out.save(path, 'WEBP', quality=q, method=6)
        print(path.split('/')[-1], os.path.getsize(path))
