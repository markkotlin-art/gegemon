#!/usr/bin/env python3
"""Локальный сервер ГЕГЕМОНА: раздаёт игру и хранит сохранения файлами в папке saves/.

Запуск: двойной клик по «Играть.command». Тогда сохранения не зависят от браузера
и общие для компьютера и телефона (если они в одной Wi-Fi сети).
"""
import http.server
import json
import os
import sys
import urllib.parse

ROOT = os.path.dirname(os.path.abspath(__file__))
SAVES = os.path.join(ROOT, 'saves')
SLOTS = ('save', 'prev')
MAX_BODY = 30 * 1024 * 1024
os.makedirs(SAVES, exist_ok=True)


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def end_headers(self):
        # без кэша, чтобы после правок кода браузер/телефон брали свежие файлы
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def log_message(self, fmt, *args):
        if '/api/save' not in (args[0] if args else ''):
            super().log_message(fmt, *args)

    def _slot(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path != '/api/save':
            return None
        slot = urllib.parse.parse_qs(parsed.query).get('slot', ['save'])[0]
        return slot if slot in SLOTS else ''

    def _reply(self, code, body=b'', ctype='application/json'):
        self.send_response(code)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        slot = self._slot()
        if slot is None:
            return super().do_GET()
        if slot == '':
            return self._reply(400)
        path = os.path.join(SAVES, slot + '.json')
        if not os.path.exists(path):
            return self._reply(204)           # слот пуст (204, чтобы в консоли браузера не было ошибок)
        with open(path, 'rb') as f:
            self._reply(200, f.read())

    def do_POST(self):
        slot = self._slot()
        if not slot:
            return self._reply(400)
        length = int(self.headers.get('Content-Length') or 0)
        if length > MAX_BODY:
            return self._reply(413)
        raw = self.rfile.read(length)
        path = os.path.join(SAVES, slot + '.json')
        try:
            data = json.loads(raw.decode('utf-8'))
        except Exception:
            return self._reply(400)
        if data is None:                      # null = удалить слот
            if os.path.exists(path):
                os.remove(path)
            return self._reply(200, b'{}')
        tmp = path + '.tmp'
        with open(tmp, 'wb') as f:
            f.write(raw)
        os.replace(tmp, path)                 # запись целиком или никак
        self._reply(200, b'{}')


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
    server = http.server.ThreadingHTTPServer(('0.0.0.0', port), Handler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
