#!/usr/bin/env python3
"""Envia um comando QMP à VM QEMU do emulador. Ex.: qmp.py screendump /tmp/x.png | qmp.py key ret | qmp.py raw '{...}'"""
import json, socket, sys, os
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
args = sys.argv[1:]
if args[0] == 'screendump':
    print(call({"execute": "screendump", "arguments": {"filename": os.path.abspath(args[1]), "format": "png"}}))
elif args[0] == 'key':
    print(call({"execute": "send-key", "arguments": {"keys": [{"type": "qcode", "data": k} for k in args[1:]]}}))
elif args[0] == 'quit':
    print(call({"execute": "quit"}))
else:
    print(call(json.loads(args[1])))
