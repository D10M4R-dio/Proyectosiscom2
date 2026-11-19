import csv
import io
import json
import math
import os
import queue
import socket
import sqlite3
import threading
from datetime import datetime
from flask import Flask, Response, jsonify, render_template, request

BASE_DIR = os.path.abspath(os.path.dirname(__file__))
DATA_DIR = os.path.join(BASE_DIR, "data")
os.makedirs(DATA_DIR, exist_ok=True)
DB_PATH = os.path.join(DATA_DIR, "telemetry.db")

app = Flask(__name__)

# Clave API opcional (si se define SISCOM_API_KEY, se valida mediante cabecera X-API-Key o campo api_key)
EXPECTED_API_KEY = os.environ.get("SISCOM_API_KEY", "")

# Suscriptores de Server-Sent Events (SSE) para tiempo real
sse_clients = []
sse_lock = threading.Lock()

# Umbrales configurables en memoria y persistidos en SQLite
DEFAULT_THRESHOLDS = {
    "temp_max_warn": 30.0,
    "temp_max_crit": 35.0,
    "temp_min_warn": 15.0,
    "hum_max_warn": 75.0,
    "hum_max_crit": 85.0,
    "hum_min_warn": 30.0,
}


def get_db_connection():
    conn = sqlite3.connect(DB_PATH, timeout=10)
    conn.row_factory = sqlite3.Row
    return conn


def compute_heat_index(temp_c: float, humidity: float) -> float:
    """Calcula el Índice de Calor (Sensación Térmica) en °C a partir de Temperatura (°C) y Humedad Relativa (%)."""
    t_f = (temp_c * 9.0 / 5.0) + 32.0
    rh = max(0.0, min(100.0, humidity))
    # Fórmula de Steadman para temperaturas moderadas
    hi_f = 0.5 * (t_f + 61.0 + ((t_f - 68.0) * 1.2) + (rh * 0.094))
    if ((hi_f + t_f) / 2.0) >= 80.0:
        # Regresión completa de Rothfusz (NOAA)
        hi_f = (
            -42.379
            + 2.04901523 * t_f
            + 10.14333127 * rh
            - 0.22475541 * t_f * rh
            - 0.00683783 * t_f * t_f
            - 0.05481717 * rh * rh
            + 0.00122874 * t_f * t_f * rh
            + 0.00085282 * t_f * rh * rh
            - 0.00000199 * t_f * t_f * rh * rh
        )
        if rh < 13.0 and 80.0 <= t_f <= 112.0:
            hi_f -= ((13.0 - rh) / 4.0) * math.sqrt((17.0 - abs(t_f - 95.0)) / 17.0)
        elif rh > 85.0 and 80.0 <= t_f <= 87.0:
            hi_f += ((rh - 85.0) / 10.0) * ((87.0 - t_f) / 5.0)
    hi_c = (hi_f - 32.0) * 5.0 / 9.0
    return round(hi_c, 2)


def compute_dew_point(temp_c: float, humidity: float) -> float:
    """Calcula el Punto de Rocío (°C) usando la aproximación de Magnus-Tetens."""
    rh = max(1.0, min(100.0, humidity))
    a = 17.27
    b = 237.7
    alpha = ((a * temp_c) / (b + temp_c)) + math.log(rh / 100.0)
    dew_c = (b * alpha) / (a - alpha)
    return round(dew_c, 2)


def evaluate_status(temp_c: float, humidity: float, thresholds: dict) -> tuple[str, str]:
    """Evalúa el estado operativo de la lectura según los umbrales configurados."""
    reasons = []
    level = "NORMAL"

    if temp_c >= thresholds["temp_max_crit"]:
        level = "CRITICO"
        reasons.append(f"Temp crítica alta ({temp_c:.1f} °C >= {thresholds['temp_max_crit']} °C)")
    elif temp_c >= thresholds["temp_max_warn"]:
        level = "ALERTA"
        reasons.append(f"Temp elevada ({temp_c:.1f} °C >= {thresholds['temp_max_warn']} °C)")
    elif temp_c <= thresholds["temp_min_warn"]:
        level = "ALERTA"
        reasons.append(f"Temp baja ({temp_c:.1f} °C <= {thresholds['temp_min_warn']} °C)")

    if humidity >= thresholds["hum_max_crit"]:
        level = "CRITICO"
        reasons.append(f"Humedad crítica ({humidity:.1f}% >= {thresholds['hum_max_crit']}%)")
    elif humidity >= thresholds["hum_max_warn"]:
        if level != "CRITICO":
            level = "ALERTA"
        reasons.append(f"Humedad alta ({humidity:.1f}% >= {thresholds['hum_max_warn']}%)")
    elif humidity <= thresholds["hum_min_warn"]:
        if level != "CRITICO":
            level = "ALERTA"
        reasons.append(f"Humedad baja ({humidity:.1f}% <= {thresholds['hum_min_warn']}%)")

    if not reasons:
        reasons.append("Variables dentro del rango nominal")

    return level, "; ".join(reasons)


def init_db():
    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS sensor_readings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            device_id TEXT NOT NULL,
            location TEXT NOT NULL DEFAULT 'No especificada',
            temperature REAL NOT NULL,
            humidity REAL NOT NULL,
            heat_index REAL NOT NULL,
            dew_point REAL NOT NULL,
            rssi INTEGER,
            battery_v REAL,
            status TEXT NOT NULL DEFAULT 'NORMAL',
            status_detail TEXT NOT NULL DEFAULT '',
            client_ip TEXT NOT NULL DEFAULT '127.0.0.1',
            created_at TEXT NOT NULL
        )
        """
    )
    cur.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_readings_created_at
        ON sensor_readings(created_at DESC)
        """
    )
    cur.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_readings_device
        ON sensor_readings(device_id)
        """
    )
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS system_config (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        )
        """
    )
    cur.execute("SELECT value FROM system_config WHERE key = 'thresholds'")
    if not cur.fetchone():
        cur.execute(
            "INSERT INTO system_config (key, value) VALUES ('thresholds', ?)",
            (json.dumps(DEFAULT_THRESHOLDS),),
        )
    conn.commit()
    conn.close()


def get_thresholds() -> dict:
    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute("SELECT value FROM system_config WHERE key = 'thresholds'")
    row = cur.fetchone()
    conn.close()
    if row:
        try:
            data = json.loads(row["value"])
            return {**DEFAULT_THRESHOLDS, **data}
        except Exception:
            return DEFAULT_THRESHOLDS.copy()
    return DEFAULT_THRESHOLDS.copy()


def save_thresholds(new_thresholds: dict) -> dict:
    merged = get_thresholds()
    for k in DEFAULT_THRESHOLDS:
        if k in new_thresholds:
            val = float(new_thresholds[k])
            if not math.isfinite(val):
                raise ValueError(f"El umbral '{k}' debe ser un número finito.")
            merged[k] = round(val, 2)

    if not (-50.0 <= merged["temp_min_warn"] < merged["temp_max_warn"] < merged["temp_max_crit"] <= 100.0):
        raise ValueError(
            "Los umbrales de temperatura deben cumplir: mín. advertencia < máx. advertencia < máx. crítico (entre -50 y 100 °C)."
        )
    if not (0.0 <= merged["hum_min_warn"] < merged["hum_max_warn"] < merged["hum_max_crit"] <= 100.0):
        raise ValueError(
            "Los umbrales de humedad deben cumplir: mín. advertencia < máx. advertencia < máx. crítico (entre 0 y 100 %)."
        )

    conn = get_db_connection()
    conn.execute(
        "INSERT OR REPLACE INTO system_config (key, value) VALUES ('thresholds', ?)",
        (json.dumps(merged),),
    )
    conn.commit()
    conn.close()
    return merged


def broadcast_sse(event_type: str, payload: dict):
    message = f"event: {event_type}\ndata: {json.dumps(payload)}\n\n"
    with sse_lock:
        dead_clients = []
        for q in sse_clients:
            try:
                q.put_nowait(message)
            except queue.Full:
                dead_clients.append(q)
        for q in dead_clients:
            sse_clients.remove(q)


def insert_reading(
    device_id: str,
    location: str,
    temperature: float,
    humidity: float,
    rssi: int | None = None,
    battery_v: float | None = None,
    client_ip: str = "127.0.0.1",
    timestamp_iso: str | None = None,
) -> dict:
    thresholds = get_thresholds()
    heat_index = compute_heat_index(temperature, humidity)
    dew_point = compute_dew_point(temperature, humidity)
    status, status_detail = evaluate_status(temperature, humidity, thresholds)
    created_at = timestamp_iso or datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    rssi_val = int(rssi) if rssi is not None else None
    batt_val = round(battery_v, 2) if battery_v is not None else None

    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute(
        """
        INSERT INTO sensor_readings (
            device_id, location, temperature, humidity, heat_index, dew_point,
            rssi, battery_v, status, status_detail, client_ip, created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            device_id,
            location,
            round(temperature, 2),
            round(humidity, 2),
            heat_index,
            dew_point,
            rssi_val,
            batt_val,
            status,
            status_detail,
            client_ip,
            created_at,
        ),
    )
    reading_id = cur.lastrowid
    conn.commit()
    conn.close()

    record = {
        "id": reading_id,
        "device_id": device_id,
        "location": location,
        "temperature": round(temperature, 2),
        "humidity": round(humidity, 2),
        "heat_index": heat_index,
        "dew_point": dew_point,
        "rssi": rssi_val,
        "battery_v": batt_val,
        "status": status,
        "status_detail": status_detail,
        "client_ip": client_ip,
        "created_at": created_at,
    }
    broadcast_sse("new_reading", record)
    return record


def get_server_network_info() -> dict:
    hostname = socket.gethostname()
    local_ip = "127.0.0.1"
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.settimeout(0.2)
        s.connect(("8.8.8.8", 80))
        local_ip = s.getsockname()[0]
        s.close()
    except Exception:
        pass
    return {
        "hostname": hostname,
        "local_ip": local_ip,
        "server_time": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
    }


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/readings", methods=["POST"])
def receive_reading():
    data = request.get_json(silent=True)
    if not data:
        # También soportar application/x-www-form-urlencoded por si un microcontrolador envía form data
        data = request.form.to_dict()

    if not data:
        return jsonify({"ok": False, "error": "Payload JSON vacío o inválido"}), 400

    if EXPECTED_API_KEY:
        provided_key = request.headers.get("X-API-Key") or data.get("api_key", "")
        if provided_key != EXPECTED_API_KEY:
            return jsonify({"ok": False, "error": "Clave API no autorizada"}), 401

    try:
        temperature = float(data.get("temperature", data.get("temp")))
        humidity = float(data.get("humidity", data.get("hum")))
    except (TypeError, ValueError):
        return (
            jsonify(
                {
                    "ok": False,
                    "error": "Los campos 'temperature' y 'humidity' son obligatorios y deben ser numéricos.",
                }
            ),
            400,
        )

    if not (-50.0 <= temperature <= 100.0) or not (0.0 <= humidity <= 100.0):
        return (
            jsonify(
                {
                    "ok": False,
                    "error": "Valores fuera de rango físico válido (Temp: -50..100 °C, Humedad: 0..100%).",
                }
            ),
            400,
        )

    rssi = None
    raw_rssi = data.get("rssi")
    if raw_rssi is not None and str(raw_rssi).strip() != "":
        try:
            rssi = int(float(raw_rssi))
        except (TypeError, ValueError):
            return jsonify({"ok": False, "error": "El campo 'rssi' debe ser numérico."}), 400
        if not (-120 <= rssi <= 0):
            return jsonify({"ok": False, "error": "Valor 'rssi' fuera de rango válido (-120..0 dBm)."}), 400

    battery_v = None
    raw_batt = data.get("battery_v")
    if raw_batt is not None and str(raw_batt).strip() != "":
        try:
            battery_v = float(raw_batt)
        except (TypeError, ValueError):
            return jsonify({"ok": False, "error": "El campo 'battery_v' debe ser numérico."}), 400
        if not (0.0 <= battery_v <= 24.0):
            return jsonify({"ok": False, "error": "Valor 'battery_v' fuera de rango válido (0..24 V)."}), 400

    device_id = str(data.get("device_id") or "ESP32-NODO-01").strip()[:64] or "ESP32-NODO-01"
    location = str(data.get("location") or "No especificada").strip()[:120] or "No especificada"

    client_ip = request.headers.get("X-Forwarded-For", request.remote_addr or "127.0.0.1")
    if "," in client_ip:
        client_ip = client_ip.split(",")[0].strip()

    record = insert_reading(
        device_id=device_id,
        location=location,
        temperature=temperature,
        humidity=humidity,
        rssi=rssi,
        battery_v=battery_v,
        client_ip=client_ip,
    )
    return jsonify({"ok": True, "reading": record}), 201


@app.route("/api/readings", methods=["GET"])
def list_readings():
    try:
        limit = min(max(int(request.args.get("limit", 60)), 1), 500)
    except (TypeError, ValueError):
        limit = 60
    device_id = request.args.get("device_id", "").strip()

    conn = get_db_connection()
    cur = conn.cursor()
    if device_id and device_id != "ALL":
        cur.execute(
            """
            SELECT * FROM sensor_readings
            WHERE device_id = ?
            ORDER BY id DESC
            LIMIT ?
            """,
            (device_id, limit),
        )
    else:
        cur.execute(
            """
            SELECT * FROM sensor_readings
            ORDER BY id DESC
            LIMIT ?
            """,
            (limit,),
        )
    rows = [dict(r) for r in cur.fetchall()]
    conn.close()

    return jsonify(
        {
            "ok": True,
            "count": len(rows),
            "readings": rows,
        }
    )


@app.route("/api/stats", methods=["GET"])
def get_stats():
    device_id = request.args.get("device_id", "").strip()
    conn = get_db_connection()
    cur = conn.cursor()

    where_clause = ""
    params = []
    if device_id and device_id != "ALL":
        where_clause = "WHERE device_id = ?"
        params.append(device_id)

    cur.execute(
        f"""
        SELECT
            COUNT(*) as total_packets,
            ROUND(AVG(temperature), 2) as avg_temp,
            ROUND(MIN(temperature), 2) as min_temp,
            ROUND(MAX(temperature), 2) as max_temp,
            ROUND(AVG(humidity), 2) as avg_hum,
            ROUND(MIN(humidity), 2) as min_hum,
            ROUND(MAX(humidity), 2) as max_hum,
            ROUND(AVG(heat_index), 2) as avg_hi,
            ROUND(AVG(dew_point), 2) as avg_dp,
            ROUND(AVG(rssi), 1) as avg_rssi,
            SUM(CASE WHEN status != 'NORMAL' THEN 1 ELSE 0 END) as alert_count
        FROM sensor_readings
        {where_clause}
        """,
        params,
    )
    summary = dict(cur.fetchone())

    cur.execute(
        f"""
        SELECT * FROM sensor_readings
        {where_clause}
        ORDER BY id DESC
        LIMIT 1
        """,
        params,
    )
    latest_row = cur.fetchone()
    latest = dict(latest_row) if latest_row else None

    cur.execute(
        """
        SELECT
            device_id,
            location,
            COUNT(*) as packets,
            MAX(created_at) as last_seen,
            ROUND(AVG(temperature), 2) as avg_temp,
            ROUND(AVG(humidity), 2) as avg_hum
        FROM sensor_readings
        GROUP BY device_id
        ORDER BY last_seen DESC
        """
    )
    devices = [dict(r) for r in cur.fetchall()]
    conn.close()

    return jsonify(
        {
            "ok": True,
            "summary": summary,
            "latest": latest,
            "devices": devices,
            "thresholds": get_thresholds(),
            "server": get_server_network_info(),
        }
    )


@app.route("/api/thresholds", methods=["GET", "POST"])
def manage_thresholds():
    if request.method == "GET":
        return jsonify({"ok": True, "thresholds": get_thresholds()})
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return jsonify({"ok": False, "error": "Payload JSON inválido."}), 400
    try:
        updated = save_thresholds(data)
    except (TypeError, ValueError) as exc:
        return jsonify({"ok": False, "error": str(exc)}), 400
    broadcast_sse("thresholds_updated", updated)
    return jsonify({"ok": True, "thresholds": updated})


@app.route("/api/readings", methods=["DELETE"])
def clear_readings():
    conn = get_db_connection()
    conn.execute("DELETE FROM sensor_readings")
    conn.commit()
    conn.close()
    broadcast_sse("cleared", {"timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S")})
    return jsonify({"ok": True, "message": "Historial de lecturas reiniciado."})


@app.route("/api/export/csv", methods=["GET"])
def export_csv():
    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute("SELECT * FROM sensor_readings ORDER BY id DESC LIMIT 1000")
    rows = cur.fetchall()
    conn.close()

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(
        [
            "ID",
            "Dispositivo",
            "Ubicacion",
            "Temperatura_C",
            "Humedad_Pct",
            "Indice_Calor_C",
            "Punto_Rocio_C",
            "RSSI_dBm",
            "Bateria_V",
            "Estado",
            "Detalle_Estado",
            "IP_Origen",
            "Fecha_Hora",
        ]
    )
    for r in rows:
        writer.writerow(
            [
                r["id"],
                r["device_id"],
                r["location"],
                r["temperature"],
                r["humidity"],
                r["heat_index"],
                r["dew_point"],
                r["rssi"] if r["rssi"] is not None else "",
                r["battery_v"] if r["battery_v"] is not None else "",
                r["status"],
                r["status_detail"],
                r["client_ip"],
                r["created_at"],
            ]
        )

    csv_content = output.getvalue()
    return Response(
        csv_content,
        mimetype="text/csv; charset=utf-8",
        headers={
            "Content-Disposition": "attachment; filename=telemetria_siscom2.csv"
        },
    )


@app.route("/api/stream")
def stream():
    def event_generator():
        q = queue.Queue(maxsize=50)
        with sse_lock:
            sse_clients.append(q)
        try:
            yield f"event: connected\ndata: {json.dumps({'status': 'connected', 'time': datetime.now().strftime('%H:%M:%S')})}\n\n"
            while True:
                try:
                    msg = q.get(timeout=15)
                    yield msg
                except queue.Empty:
                    yield ": keep-alive\n\n"
        except GeneratorExit:
            pass
        finally:
            with sse_lock:
                if q in sse_clients:
                    sse_clients.remove(q)

    return Response(
        event_generator(),
        mimetype="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )


init_db()

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    print(f"[SisCom II] Servidor Web de Monitoreo IoT iniciado en http://0.0.0.0:{port}")
    app.run(host="0.0.0.0", port=port, debug=False, threaded=True)
