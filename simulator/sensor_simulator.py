#!/usr/bin/env python3
"""
Simulador de Nodo Sensor IoT (ESP32 / DHT22) - Sistemas de Comunicación II (2026-II)
Envía tramas de telemetría vía HTTP POST (JSON) hacia el servidor local o IP Pública en la nube.
No requiere librerías externas (utiliza urllib de la biblioteca estándar de Python).
"""

import argparse
import json
import math
import random
import time
import urllib.error
import urllib.request
from datetime import datetime


def send_telemetry(url: str, payload: dict, timeout: float = 5.0) -> tuple[int, dict, float]:
    endpoint = url.rstrip("/")
    if not endpoint.endswith("/api/readings"):
        endpoint = f"{endpoint}/api/readings"

    body = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        endpoint,
        data=body,
        headers={
            "Content-Type": "application/json",
            "User-Agent": "ESP32-Simulator-SisCom2/2026.2",
        },
        method="POST",
    )

    t0 = time.perf_counter()
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        elapsed_ms = (time.perf_counter() - t0) * 1000.0
        raw = resp.read().decode("utf-8")
        return resp.status, json.loads(raw), elapsed_ms


def main():
    parser = argparse.ArgumentParser(
        description="Simulador de Nodo Sensor ESP32/DHT22 para Sistemas de Comunicación II"
    )
    parser.add_argument(
        "--url",
        default="http://127.0.0.1:5000",
        help="URL base o IP pública del servidor (ej. http://143.198.10.25 o http://127.0.0.1:5000)",
    )
    parser.add_argument(
        "--device",
        default="ESP32-NODO-01",
        help="Identificador del nodo sensor (default: ESP32-NODO-01)",
    )
    parser.add_argument(
        "--location",
        default="Laboratorio Comunicaciones II - Bloque Ingenierías",
        help="Ubicación física del nodo sensor",
    )
    parser.add_argument(
        "--interval",
        type=float,
        default=3.0,
        help="Intervalo entre envíos en segundos (default: 3.0)",
    )
    parser.add_argument(
        "--count",
        type=int,
        default=0,
        help="Cantidad de tramas a enviar (0 = continuo hasta Ctrl+C)",
    )
    parser.add_argument(
        "--anomaly-every",
        type=int,
        default=8,
        help="Inyectar un pico térmico de prueba cada N tramas (0 = desactivar)",
    )
    args = parser.parse_args()

    print("=" * 72)
    print("  SIMULADOR DE TELEMETRÍA IoT - SISTEMAS DE COMUNICACIÓN II (2026-II)")
    print("=" * 72)
    print(f"  Servidor Destino : {args.url}")
    print(f"  Nodo Sensor ID   : {args.device}")
    print(f"  Intervalo TX     : {args.interval} s")
    print("=" * 72)

    seq = 0
    phase = random.uniform(0, 3.14)

    try:
        while True:
            seq += 1
            phase += 0.35

            # Variación ambiental realista (onda suave + ruido térmico)
            temp = 25.6 + math.sin(phase) * 2.4 + random.uniform(-0.35, 0.35)
            hum = 58.5 - math.sin(phase) * 6.0 + random.uniform(-1.0, 1.0)
            rssi = random.randint(-64, -51)

            # Inyección periódica de alerta/evento térmico para demostración
            if args.anomaly_every > 0 and seq % args.anomaly_every == 0:
                temp = random.uniform(32.5, 36.8)
                hum = random.uniform(76.0, 87.0)
                print(f"\n[!] Generando pico térmico de prueba en trama #{seq}...")

            payload = {
                "device_id": args.device,
                "location": args.location,
                "temperature": round(temp, 2),
                "humidity": round(hum, 2),
                "rssi": rssi,
                "battery_v": round(3.30 + random.uniform(-0.03, 0.04), 2),
            }

            now_str = datetime.now().strftime("%H:%M:%S")
            try:
                status_code, resp_data, latency_ms = send_telemetry(args.url, payload)
                reading = resp_data.get("reading", {})
                estado = reading.get("status", "OK")
                hi = reading.get("heat_index", "--")
                print(
                    f"[{now_str}] TX #{seq:03d} | Temp: {payload['temperature']:5.2f}°C | "
                    f"Hum: {payload['humidity']:5.2f}% | HI: {hi}°C | RSSI: {rssi} dBm | "
                    f"Estado: {estado:7s} | HTTP {status_code} ({latency_ms:.0f} ms)"
                )
            except urllib.error.URLError as e:
                print(f"[{now_str}] ERROR de conexión hacia {args.url}: {e}")
            except Exception as e:
                print(f"[{now_str}] ERROR inesperado: {e}")

            if args.count > 0 and seq >= args.count:
                print(f"\n[Fin] Se completó el envío de {seq} tramas.")
                break

            time.sleep(args.interval)

    except KeyboardInterrupt:
        print("\n[Simulador detenido por el usuario]")


if __name__ == "__main__":
    main()
