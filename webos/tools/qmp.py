#!/usr/bin/env python3
"""Envia um comando QMP à VM QEMU do emulador. Ex.: qmp.py screendump /tmp/x.png | qmp.py key ret | qmp.py raw '{...}'"""
import json, socket, sys, os, struct, zlib
SOCK = os.environ.get('WEBOS_QMP', os.path.expanduser('~/webos-tv-sdk/run/qmp.sock'))
def call(cmd):
    s = socket.socket(socket.AF_UNIX); s.connect(SOCK); f = s.makefile('rw')
    json.loads(f.readline())
    for c in ({"execute": "qmp_capabilities"}, cmd):
        f.write(json.dumps(c) + "\n"); f.flush()
        while True:
            r = json.loads(f.readline())
            if 'return' in r or 'error' in r: break
    s.close(); return r
def ppm_to_png(src, dst):
    """O PNG do screendump do QEMU sai com vermelho e azul trocados; o PPM sai certo, então converte aqui."""
    d = open(src, 'rb').read()
    pos, fields = 0, []
    while len(fields) < 4:  # P6 largura altura maxval
        while d[pos:pos + 1].isspace(): pos += 1
        end = pos
        while not d[end:end + 1].isspace(): end += 1
        fields.append(d[pos:end]); pos = end
    pos += 1
    assert fields[0] == b'P6' and fields[3] == b'255', 'PPM inesperado'
    w, h = int(fields[1]), int(fields[2])
    raw = b''.join(b'\0' + d[pos + y * w * 3: pos + (y + 1) * w * 3] for y in range(h))
    def chunk(t, b): return struct.pack('>I', len(b)) + t + b + struct.pack('>I', zlib.crc32(t + b))
    open(dst, 'wb').write(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0))
                          + chunk(b'IDAT', zlib.compress(raw, 6)) + chunk(b'IEND', b''))

args = sys.argv[1:]
if args[0] == 'screendump':
    out = os.path.abspath(args[1])
    tmp = out + '.ppm.tmp'
    r = call({"execute": "screendump", "arguments": {"filename": tmp, "format": "ppm"}})
    if 'return' in r:
        ppm_to_png(tmp, out); os.unlink(tmp)
    print(r)
elif args[0] == 'key':
    print(call({"execute": "send-key", "arguments": {"keys": [{"type": "qcode", "data": k} for k in args[1:]]}}))
elif args[0] == 'quit':
    print(call({"execute": "quit"}))
else:
    print(call(json.loads(args[1])))
