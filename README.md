# Sistema de Monitoreo IoT vía Web — Sistemas de Comunicación II (2026-II)

Proyecto final completo para monitoreo en tiempo real de **Temperatura (°C)**, **Humedad Relativa (%)**, **Índice de Calor (°C)**, **Punto de Rocío (°C)** y **Potencia de Señal Wi-Fi RSSI (dBm)** enviados por un nodo sensor **ESP32/ESP8266 (DHT22/DHT11)** o el **Simulador Python** hacia un servidor en la nube con **Dirección IP Pública**.

---

## Estructura del Proyecto

* [`app.py`](./app.py): Servidor Web Backend en Python (Flask + SQLite3 + Server-Sent Events SSE + API REST).
* [`templates/index.html`](./templates/index.html): Dashboard Web interactivo en tiempo real con gráficas Chart.js, KPIs, Inspector de Protocolo HTTP/JSON y transmisor de prueba integrado.
* [`templates/reporte.html`](./templates/reporte.html): Reporte técnico formateado listo para editar nombres del grupo e imprimir/guardar como PDF desde el navegador (`http://localhost:5000/reporte`).
* [`REPORTE_PROYECTO_FINAL_SISCOM2.md`](./REPORTE_PROYECTO_FINAL_SISCOM2.md): Documento completo paso a paso para entregar en Moodle antes del 20 de noviembre a las 2:00 p. m.
* [`firmware/esp32_dht_monitor/esp32_dht_monitor.ino`](./firmware/esp32_dht_monitor/esp32_dht_monitor.ino): Código para Arduino IDE compatible con ESP32 y ESP8266 usando el sensor DHT22 o DHT11.
* [`simulator/sensor_simulator.py`](./simulator/sensor_simulator.py): Simulador de telemetría en Python para enviar tramas reales/simuladas hacia `localhost` o hacia la IP pública del VPS.
* [`deploy/setup_vps.sh`](./deploy/setup_vps.sh): Script automatizado que instala y configura Nginx (puerto 80 en IP pública), Gunicorn, Systemd y Firewall UFW en un servidor Ubuntu/Debian (DigitalOcean, Google Cloud, Azure, AWS).
* [`iniciar_local.bat`](./iniciar_local.bat): Ejecutable de un clic para iniciar el servidor en Windows.

---

## 1. Ejecución Rápida en Windows (Local)

Haz doble clic en [`iniciar_local.bat`](./iniciar_local.bat) o ejecuta en terminal:

```powershell
.\.venv\Scripts\python.exe app.py
```

* **Dashboard en vivo:** `http://127.0.0.1:5000`
* **Reporte Técnico (Imprimible a PDF para Moodle):** `http://127.0.0.1:5000/reporte`

Para ejecutar el simulador externo desde otra terminal:

```powershell
.\.venv\Scripts\python.exe simulator\sensor_simulator.py --url http://127.0.0.1:5000 --interval 2
```

---

## 2. Despliegue en Servidor Virtual en la Nube con IP Pública (Ubuntu / Debian)

1. Sube esta carpeta a tu servidor virtual (Droplet de DigitalOcean, VM de Google Cloud, Azure o AWS EC2):
   ```bash
   scp -r Proyectosiscom2 root@<IP_PUBLICA_VPS>:/opt/proyectosiscom2
   ```
2. Conéctate por SSH al servidor y ejecuta el instalador automático:
   ```bash
   ssh root@<IP_PUBLICA_VPS>
   cd /opt/proyectosiscom2
   sudo bash deploy/setup_vps.sh
   ```
3. Tu sistema quedará corriendo 24/7 directamente sobre `http://<IP_PUBLICA_VPS>/` (Puerto 80).
