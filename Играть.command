#!/bin/bash
# Играть: запускает локальный сервер игры и открывает её в браузере.
# Сохранения лежат файлами в папке saves/ — не зависят от браузера.
# Телефон в той же Wi-Fi сети открывает адрес, который напечатан ниже; сохранения у него общие.
cd "$(dirname "$0")"
PORT=8080
IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null)
echo ""
echo "  ГЕГЕМОН запущен."
echo "  На компьютере:  http://localhost:$PORT"
if [ -n "$IP" ]; then
  echo "  На телефоне:    http://$IP:$PORT   (та же Wi-Fi сеть)"
fi
echo ""
echo "  Не закрывайте это окно, пока играете. Остановить: закрыть окно или Ctrl+C."
echo ""
( sleep 1; open "http://localhost:$PORT" ) &
python3 server.py $PORT
