"""Independent, loopback-only RFB 3.8 fixture. Never exposes a real desktop.

Run: .venv/bin/python -m tests.vnc_fixture [--port 5909]
Implements raw framebuffer, keyboard, pointer and clipboard wire messages.
"""
import argparse
import json
import socketserver
import struct
import threading
import time
from pathlib import Path

WIDTH, HEIGHT = 640, 400
PIXEL_FORMAT = struct.pack('>BBBBHHHBBBxxx', 32, 24, 0, 1, 255, 255, 255, 16, 8, 0)


class VNCHandler(socketserver.BaseRequestHandler):
    def receive(self, size):
        data = b''
        while len(data) < size:
            chunk = self.request.recv(size - len(data))
            if not chunk:
                raise EOFError
            data += chunk
        return data

    def event(self, kind, **fields):
        value = {'type': kind, **fields}
        self.server.events.append(value)
        if self.server.event_file:
            with self.server.event_file.open('a') as handle:
                handle.write(json.dumps(value) + '\n')

    def handle(self):
        try:
            self.request.settimeout(15)
            self.request.sendall(b'RFB 003.008\n')
            if self.receive(12) != b'RFB 003.008\n':
                return
            self.request.sendall(b'\x01\x01')  # one security type: None
            if self.receive(1) != b'\x01':
                return
            self.request.sendall(b'\x00\x00\x00\x00')
            self.receive(1)  # shared flag
            name = b'Taildesk RFB test fixture (not a real desktop)'
            width, height = self.server.size
            self.request.sendall(struct.pack('>HH', width, height) + PIXEL_FORMAT + struct.pack('>I', len(name)) + name)
            self.event('connected')
            self.request.settimeout(None)
            pixel_format = PIXEL_FORMAT
            sent = False
            frame_number = 0
            next_frame = time.monotonic()
            encodings = []
            while True:
                kind = self.receive(1)[0]
                if kind == 0:
                    pixel_format = self.receive(19)[3:]
                elif kind == 2:
                    header = self.receive(3)
                    count = struct.unpack('>H', header[1:])[0]
                    encodings = struct.unpack('>' + 'i' * count, self.receive(count * 4))
                    self.event('encodings', values=list(encodings))
                elif kind == 3:
                    self.receive(9)
                    if not sent or self.server.animate:
                        if self.server.animate:
                            time.sleep(max(0, next_frame - time.monotonic()))
                            next_frame = time.monotonic() + 0.2
                        frame_number += 1
                        pixels = bytearray()
                        for y in range(height):
                            for x in range(width):
                                if y < 40:
                                    r, g, b = 48, 57, 80
                                elif 60 < x < 580 and 80 < y < 330:
                                    r, g, b = (99, 117, 212) if x < 320 else (92, 170, 147)
                                else:
                                    r, g, b = 232, 236, 247
                                if self.server.animate:
                                    r = (r + frame_number * 17) % 256
                                pixel = (r << pixel_format[10]) | (g << pixel_format[11]) | (b << pixel_format[12])
                                pixels.extend(pixel.to_bytes(4, 'big' if pixel_format[2] else 'little'))
                        layout = b''
                        if self.server.displays and -308 in encodings and not sent:
                            # Unequal sizes and vertical offset exercise both pointer axes.
                            layout = struct.pack('>HHHHi', 0, 0, width, height, -308)
                            layout += b'\x02\x00\x00\x00'
                            layout += struct.pack('>IHHHHI', 11, 0, 0, 240, 400, 0)
                            layout += struct.pack('>IHHHHI', 22, 240, 60, 400, 340, 0)
                        self.request.sendall(struct.pack('>BBH', 0, 0, 2 if layout else 1) + layout +
                                             struct.pack('>HHHHi', 0, 0, width, height, 0) + pixels)
                        sent = True
                        self.event('frame', width=width, height=height, number=frame_number)
                elif kind == 4:
                    data = self.receive(7)
                    self.event('key', down=bool(data[0]), keysym=struct.unpack('>I', data[3:])[0])
                elif kind == 5:
                    buttons, x, y = struct.unpack('>BHH', self.receive(5))
                    self.event('pointer', buttons=buttons, x=x, y=y)
                elif kind == 6:
                    header = self.receive(7)
                    length = struct.unpack('>I', header[3:])[0]
                    self.receive(length)
                    self.event('clipboard', length=length)
                else:
                    self.event('unsupported', code=kind)
                    return
        except (EOFError, OSError):
            pass
        finally:
            self.event('disconnected')


class VNCFixture(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True

    def __init__(self, port=5909, event_file=None, displays=False, animate=False, size=(WIDTH, HEIGHT)):
        self.animate = animate
        self.size = size
        self.displays = displays
        self.events = []
        self.event_file = Path(event_file) if event_file else None
        super().__init__(('127.0.0.1', port), VNCHandler)

    def start(self):
        threading.Thread(target=self.serve_forever, daemon=True).start()
        return self


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=5909)
    parser.add_argument('--events')
    parser.add_argument('--displays', action='store_true')
    parser.add_argument('--animate', action='store_true')
    parser.add_argument('--width', type=int, default=WIDTH)
    parser.add_argument('--height', type=int, default=HEIGHT)
    args = parser.parse_args()
    print(f'RFB test fixture only, listening on 127.0.0.1:{args.port}', flush=True)
    with VNCFixture(args.port, args.events, args.displays, args.animate, (args.width, args.height)) as server:
        server.serve_forever()
