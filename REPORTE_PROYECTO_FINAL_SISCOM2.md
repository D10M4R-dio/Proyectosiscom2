# Proyecto Final — Sistemas de Comunicación II (Semestre 2026-II)
## Sistema de Monitoreo vía Página Web de Variables Enviadas por un Dispositivo Sensor sobre Dirección IP Pública

---

### Información del Grupo (Para entrega en Moodle antes del 20 de Noviembre de 2026, 2:00 PM)

* **Asignatura:** Sistemas de Comunicación II — Semestre 2026-II
* **Integrantes del Grupo:**
  * **Integrante 1:** `[Nombre Completo]` — Código: `[Código]`
  * **Integrante 2:** `[Nombre Completo]` — Código: `[Código]`
  * **Integrante 3:** `[Nombre Completo]` — Código: `[Código]`
* **Dirección IP Pública del Servidor Web (Microsoft Azure):** `http://4.205.51.40/`
* **Repositorio GitHub del Proyecto:** `https://github.com/D10M4R-dio/Proyectosiscom2`
* **Fecha de Entrega del Reporte (Moodle):** Viernes 20 de noviembre de 2026 (antes de las 2:00 p. m.)
* **Fecha de Sustentación y Demostración:** Sábado 21 de noviembre de 2026

---

## 1. Introducción y Objetivo del Proyecto

El presente proyecto implementa un **sistema completo de telemetría y monitoreo ambiental en tiempo real vía página Web**, diseñado bajo una arquitectura cliente-servidor sobre Internet. Un nodo sensor físico basado en **ESP32 / ESP8266** con sensor digital **DHT22 (o DHT11)** —acompañado de un simulador de telemetría en Python— adquiere lecturas de:

1. **Temperatura Ambiente (°C)**
2. **Humedad Relativa (%)**
3. **Potencia de Señal Inalámbrica Recibida — RSSI (dBm)**
4. **Variables Termodinámicas Derivadas en el Servidor:**
   * **Índice de Calor / Sensación Térmica (°C):** Calculado mediante la ecuación de regresión múltiple de Rothfusz (NOAA).
   * **Punto de Rocío (°C):** Calculado mediante la fórmula de Magnus-Tetens.

Las lecturas se empaquetan en tramas **JSON** y se transmiten mediante el protocolo **HTTP/1.1 (`POST /api/readings`)** a través de una red TCP/IP hacia un **Servidor Virtual en la Nube (VPS)** accesible a través de una **dirección IP pública**.

---

## 2. Arquitectura del Sistema de Comunicación

```
+------------------------------------+
|   NODO SENSOR IoT (Periferia)      |
|  - Microcontrolador ESP32/ESP8266  |
|  - Sensor DHT22 (Temp + Humedad)   |
|  - Medición de enlace Wi-Fi (RSSI) |
|  - (O Simulador Python de pruebas) |
+-----------------+------------------+
                  |
                  |  Enlace Wi-Fi (IEEE 802.11 b/g/n)
                  |  Pila: IPv4 -> TCP (Puerto 80) -> HTTP POST (JSON)
                  v
+------------------------------------+
|     INTERNET / IPv4 PÚBLICA        |
|     http://<IP_PUBLICA_VPS>:80     |
+-----------------+------------------+
                  |
                  v
+------------------------------------+
|   SERVIDOR VIRTUAL EN LA NUBE      |
|  - Proveedor: DigitalOcean / GCP / |
|    Azure / AWS (Ubuntu LTS)        |
|  - Firewall UFW: Puerto 80 abierto |
|  - Nginx: Proxy Inverso (Puerto 80)|
|  - Gunicorn + Flask (WSGI App)     |
|  - Base de Datos SQLite3           |
+-----------------+------------------+
                  |
                  |  Server-Sent Events (SSE /api/stream) + REST API
                  v
+------------------------------------+
|   CLIENTE WEB (Dashboard en Vivo)  |
|  - Gráficas en tiempo real Chart.js|
|  - Indicadores KPI y Alertas       |
|  - Inspector de tramas HTTP/JSON   |
|  - Exportación de historial a CSV  |
+------------------------------------+
```

---

## 3. Paso a Paso Ejecutado para la Implementación

### Paso 1: Despliegue del Servidor Virtual en la Nube — Microsoft Azure (Requerimiento 1 y 4)

1. Se ingresó al portal de **Microsoft Azure** bajo la suscripción **Azure for Students**.
2. Se creó una máquina virtual llamada **`vm-siscom2`** dentro del grupo de recursos `rg-siscom2` con las siguientes características:
   * **Imagen de Sistema Operativo:** Ubuntu Server 24.04 LTS (x64 Gen2).
   * **Tamaño de la Instancia:** `Standard_B2ats_v2` (2 vCPUs, 1 GiB RAM).
   * **Red e IP Pública:** Asignación de **Dirección IPv4 Pública `4.205.51.40`** (`vm-siscom2-ip`).
   * **Grupo de Seguridad de Red (NSG / Firewall de Azure):** Se habilitaron las reglas de entrada (*Inbound security rules*) para:
     * `TCP 22` (Administración remota por SSH).
     * `TCP 80` (Tráfico Web HTTP sobre la IP pública `4.205.51.40`).
3. Se verificó la administración remota del servidor virtual mediante **SSH** (`ssh azureuser@4.205.51.40`) y mediante **Azure Run Command (`RunShellScript`)**.

---

### Paso 2: Instalación y Configuración del Software para Servicio Web (Requerimiento 2 y 4)

Una vez dentro del servidor virtual en la nube, se transfirieron los archivos del proyecto a `/opt/proyectosiscom2` y se ejecutó el aprovisionamiento del servidor Web:

#### 2.1. Instalación de paquetes base (Python 3, Nginx, Firewall UFW)
```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y python3 python3-venv python3-pip nginx ufw curl
```

#### 2.2. Creación del entorno virtual e instalación de dependencias WSGI
```bash
cd /opt/proyectosiscom2
python3 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt
```

#### 2.3. Ejecución del script automatizado de despliegue (`deploy/setup_vps.sh`)
El proyecto incluye el script `deploy/setup_vps.sh`, el cual automatiza en un solo comando la creación del servicio `systemd` y la configuración de `Nginx`:
```bash
sudo bash deploy/setup_vps.sh
```

Este script realiza tres configuraciones críticas para que el servicio corra permanentemente sobre la **IP Pública**:

1. **Servicio Systemd (`/etc/systemd/system/siscom-monitor.service`):**
   Mantiene el servidor de aplicaciones **Gunicorn + Flask** ejecutándose en segundo plano 24/7 y lo reinicia automáticamente si el servidor virtual se reinicia.
2. **Proxy Inverso Nginx (`/etc/nginx/sites-available/siscom-monitor`):**
   Escucha en el **puerto 80 de la dirección IP pública** (`listen 80 default_server;`) y redirige las peticiones hacia Gunicorn (`127.0.0.1:5000`), deshabilitando el buffering en `/api/stream` (`proxy_buffering off;`) para permitir **Server-Sent Events (SSE)** en tiempo real.
3. **Firewall UFW:**
   Habilita el tráfico entrante en el puerto 80 (`ufw allow 'Nginx Full'`).

#### 2.4. Verificación del estado de los servicios en el VPS
```bash
sudo systemctl status siscom-monitor
sudo systemctl status nginx
```

---

### Paso 3: Estructura de la Trama de Comunicación y Endpoints de la API Web

El servidor Web expone los siguientes endpoints sobre la dirección IP pública:

| Método | Ruta | Descripción |
| :--- | :--- | :--- |
| `GET` | `/` | Dashboard Web interactivo con gráficas en tiempo real y KPIs. |
| `GET` | `/reporte` | Versión imprimible de este reporte técnico directamente en el navegador. |
| `POST` | `/api/readings` | Endpoint receptor de lecturas enviadas por el ESP32 o el Simulador. |
| `GET` | `/api/readings` | Consulta histórica de lecturas almacenadas en SQLite. |
| `GET` | `/api/stats` | Estadísticas agregadas (mínimo, máximo, promedio, conteo de tramas). |
| `GET` | `/api/stream` | Canal de transmisión en vivo *Server-Sent Events (SSE)*. |
| `GET` | `/api/export/csv` | Descarga de la base de datos de telemetría en formato CSV. |

#### Ejemplo de trama enviada por el sensor (`POST /api/readings`):
```json
{
  "device_id": "ESP32-NODO-01",
  "location": "Laboratorio Comunicaciones II",
  "temperature": 25.8,
  "humidity": 59.2,
  "rssi": -56,
  "battery_v": 3.32
}
```

#### Respuesta del servidor procesada:
```json
{
  "ok": true,
  "reading": {
    "id": 26,
    "device_id": "ESP32-NODO-01",
    "location": "Laboratorio Comunicaciones II",
    "temperature": 25.8,
    "humidity": 59.2,
    "heat_index": 26.14,
    "dew_point": 17.21,
    "rssi": -56,
    "battery_v": 3.32,
    "status": "NORMAL",
    "status_detail": "Variables dentro del rango nominal",
    "client_ip": "181.50.XX.XX",
    "created_at": "2026-11-12 19:40:00"
  }
}
```

---

### Paso 4: Configuración del Dispositivo Sensor (ESP32 y Simulador)

1. **Con Microcontrolador Físico (`firmware/esp32_dht_monitor/esp32_dht_monitor.ino`):**
   * Conectar el pin `VCC` del sensor DHT22/DHT11 a `3.3V`, `GND` a `GND` y `DATA` al `GPIO 4` del ESP32.
   * Abrir el archivo `.ino` en Arduino IDE, configurar `WIFI_SSID`, `WIFI_PASSWORD` y colocar la dirección IP pública del servidor en:
     ```cpp
     const char* SERVER_URL = "http://IP_PUBLICA_DEL_SERVIDOR/api/readings";
     ```
   * Compilar y cargar en la placa ESP32.

2. **Con el Simulador de Telemetría en Python (`simulator/sensor_simulator.py`):**
   * Para enviar datos en tiempo real hacia la IP pública desde cualquier computador:
     ```bash
     python simulator/sensor_simulator.py --url http://IP_PUBLICA_DEL_SERVIDOR --interval 3
     ```

---

## 4. Guía Rápida para la Sustentación (21 de Noviembre de 2026)

1. **Mostrar el servidor corriendo sobre IP Pública:** Abrir en el navegador `http://<IP_PUBLICA_VPS>/` y mostrar que carga el Dashboard en tiempo real desde cualquier red (incluso desde los datos móviles del celular del profesor o de los integrantes).
2. **Demostrar el envío de datos en vivo:**
   * Encender el ESP32 o ejecutar `python simulator/sensor_simulator.py --url http://<IP_PUBLICA_VPS>` (o activar el botón **"▶ Auto-Simulador Web (3s)"** en la barra superior del Dashboard).
   * Observar cómo las gráficas de Temperatura, Humedad, Índice de Calor y la tabla de registros se actualizan instantáneamente sin recargar la página gracias al canal **SSE (`/api/stream`)**.
3. **Explicar el protocolo de comunicación:** Señalar en el panel **"Inspector de Trama de Comunicación (HTTP POST / JSON)"** del Dashboard la cabecera HTTP, el cuerpo JSON transmitido, el código de respuesta `HTTP 201 Created` y la latencia en milisegundos.
4. **Demostrar el sistema de alertas:** Presionar el botón **"🔥 Escenario Crítico (37.6°C)"** o aplicar calor al sensor DHT22 para evidenciar el cambio de estado a `CRITICO` y la activación del banner de alarma en tiempo real.
