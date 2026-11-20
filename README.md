# Sistema de Monitoreo IoT vía Web — Sistemas de Comunicación II (2026-II)

Proyecto final para monitoreo en tiempo real de **Temperatura (°C)**, **Humedad Relativa (%)**, **Índice de Calor (°C)**, **Punto de Rocío (°C)** y **Potencia de Señal Wi-Fi RSSI (dBm)** enviados por un nodo sensor físico **ESP32/ESP8266 (DHT22/DHT11)** hacia un servidor virtual en la nube con **Dirección IP Pública**.

---

## Estructura del Proyecto

* [`app.py`](./app.py): Servidor Web Backend en Python (Flask + SQLite3 + Server-Sent Events SSE + API REST).
* [`templates/index.html`](./templates/index.html): Dashboard Web interactivo en tiempo real con gráficas Chart.js, KPIs, editor de umbrales de alerta e inspector de la última trama HTTP/JSON recibida del sensor.
* [`static/css/styles.css`](./static/css/styles.css) y [`static/js/dashboard.js`](./static/js/dashboard.js): Estilos y lógica en vivo del Dashboard mediante `EventSource` (SSE).
* [`firmware/esp32_dht_monitor/esp32_dht_monitor.ino`](./firmware/esp32_dht_monitor/esp32_dht_monitor.ino): Código para Arduino IDE compatible con ESP32 y ESP8266 usando el sensor DHT22 o DHT11.
* [`deploy/setup_vps.sh`](./deploy/setup_vps.sh): Script automatizado que instala y configura Nginx (puerto 80 en IP pública), Gunicorn, Systemd y Firewall UFW en un servidor Ubuntu/Debian (DigitalOcean, Google Cloud, Azure, AWS).
* [`deploy/enable_https.sh`](./deploy/enable_https.sh): Script para asociar un dominio en letras y activar certificado TLS/HTTPS gratuito con Let's Encrypt.
* [`Dockerfile`](./Dockerfile) y [`docker-compose.yml`](./docker-compose.yml): Alternativa de despliegue en contenedores Docker.
* [`iniciar_local.bat`](./iniciar_local.bat): Ejecutable de un clic para iniciar el servidor en Windows.

---

## 1. Ejecución en Windows (Local)

Haz doble clic en [`iniciar_local.bat`](./iniciar_local.bat) o ejecuta en terminal:

```powershell
python app.py
```

* **Dashboard en vivo:** `http://127.0.0.1:5000`
* **Endpoint de recepción de lecturas:** `POST http://127.0.0.1:5000/api/readings`

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
3. El sistema quedará corriendo 24/7 directamente sobre `http://<IP_PUBLICA_VPS>/` (Puerto 80).

---

## 3. Configuración del Dispositivo Sensor (ESP32 / ESP8266)

1. Abre [`firmware/esp32_dht_monitor/esp32_dht_monitor.ino`](./firmware/esp32_dht_monitor/esp32_dht_monitor.ino) en Arduino IDE.
2. Configura `WIFI_SSID`, `WIFI_PASSWORD` y la URL pública `SERVER_URL` (`http://<IP_PUBLICA_VPS>/api/readings`).
3. Conecta el sensor DHT22/DHT11 (`VCC -> 3.3V`, `GND -> GND`, `DATA -> GPIO 4`) y carga el firmware en la placa.
