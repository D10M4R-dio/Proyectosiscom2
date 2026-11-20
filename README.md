# Sistema de Monitoreo IoT sobre IP Pública
### Sistemas de Comunicación II — Proyecto Final (2026-II)

Sistema telemático de extremo a extremo para la medición, transmisión, procesamiento y visualización en tiempo real de variables ambientales y radioeléctricas (**Temperatura**, **Humedad**, **Índice de Calor**, **Punto de Rocío** y **Nivel de Señal Wi-Fi RSSI**) mediante un nodo físico **ESP32** transmitiendo sobre una **Dirección IP Pública** en la nube.

---

## 1. ¿De qué se trata el proyecto? (Explicación simple)

El objetivo del proyecto es conectar el mundo físico con Internet:

1. **Un sensor en el mundo real:** Un microcontrolador pequeño (ESP32) conectado a un sensor (DHT22) mide qué tan caliente está el ambiente y cuánta humedad hay en el aire cada pocos segundos.
2. **Envío por Internet:** El ESP32 se conecta a una red Wi-Fi y manda estas lecturas empaquetadas en formato JSON a través de una petición HTTP (igual a cuando un navegador abre una página web) hacia un servidor en la nube con **dirección IP pública**.
3. **Servidor en la nube:** Un servidor virtual (desplegado en Microsoft Azure, Google Cloud o cualquier VPS Ubuntu) recibe el paquete, valida que los datos sean coherentes, calcula variables físicas adicionales (como la sensación térmica y el punto de rocío), y guarda el registro en una base de datos SQLite.
4. **Dashboard web en tiempo real:** Cualquier persona con una conexión a Internet puede abrir la página web desde su computador o teléfono móvil. La página recibe los datos al instante mediante un canal continuo (**Server-Sent Events / SSE**) y dibuja gráficas continuas y suaves sin necesidad de recargar la pantalla.

---

## 2. Arquitectura del Sistema

```
  +-----------------------------------------------------------+
  |                      NODO SENSOR FÍSICO                   |
  |  - Sensor DHT22 (GPIO 4): Temperatura y Humedad           |
  |  - ESP32 SoC: Medicion de RSSI Wi-Fi y empaquetado JSON   |
  +-----------------------------+-----------------------------+
                                |
                                | Enlace Wi-Fi (IEEE 802.11 b/g/n)
                                | Pila: IPv4 -> TCP:80 -> HTTP POST
                                v
  +-----------------------------------------------------------+
  |              INTERNET / DIRECCIÓN IP PÚBLICA              |
  |             http://<IP_PUBLICA_SERVIDOR>:80/              |
  +-----------------------------+-----------------------------+
                                |
                                v
  +-----------------------------------------------------------+
  |                 SERVIDOR EN LA NUBE (VPS)                 |
  |  - Nginx: Proxy inverso (Puerto 80 HTTP / 443 HTTPS)      |
  |  - Gunicorn + Flask (Python): API REST y canal SSE        |
  |  - SQLite (data/telemetry.db): Almacenamiento persistente |
  +-----------------------------+-----------------------------+
                                |
                                | Canal continuo SSE (/api/stream)
                                v
  +-----------------------------------------------------------+
  |                INTERFAZ WEB CLIENTE (DASHBOARD)           |
  |  - 4 Tarjetas KPI: Temp, Hum, Senal Wi-Fi, Estado         |
  |  - Grafica Chart.js: Curvas continuas suavizadas          |
  |  - Historial: Tabla responsiva adaptada a moviles         |
  +-----------------------------------------------------------+
```

---

## 3. Estructura Organizada de Carpetas

El proyecto está organizado de forma modular para separar claramente el firmware del dispositivo, el backend del servidor, la interfaz gráfica y los scripts de despliegue:

```
.
├── app.py                     # Servidor backend Flask, API REST y motor SSE
├── requirements.txt           # Dependencias minimas de Python (Flask, gunicorn)
├── iniciar_local.bat          # Script de ejecucion inmediata en Windows con 1 clic
├── simulador_esp32.py         # Simulador de telemetria para pruebas locales sin hardware
├── Dockerfile                 # Definicion de imagen Docker
├── docker-compose.yml         # Archivo de orquestacion Docker
├── .gitignore                 # Exclusion de entornos virtuales y temporales
├── README.md                  # Documentacion general del sistema
│
├── data/                      # Base de datos persistente
│   └── telemetry.db           # Base de datos SQLite (tabla sensor_readings)
│
├── deploy/                    # Scripts de infraestructura y despliegue en la nube
│   ├── setup_vps.sh           # Instalador automatizado para Ubuntu/Debian (Nginx + Systemd)
│   └── enable_https.sh        # Script para asignar dominio en letras y habilitar HTTPS
│
├── docs/                      # Especificaciones y documentos de referencia
│   └── Proyecto Final-2026-II.pdf
│
├── firmware/                  # Codigo fuente para el microcontrolador fisico
│   └── esp32_dht_monitor/
│       └── esp32_dht_monitor.ino  # Sketch de Arduino IDE para ESP32 / ESP8266
│
├── informe/                   # Carpeta reservada para la memoria/reporte academico
│   └── .gitkeep
│
├── static/                    # Archivos estaticos del cliente web
│   ├── css/
│   │   └── styles.css         # Diseno ultra-minimalista, paleta oscura y responsive movil
│   └── js/
│       └── dashboard.js       # Logica de recepcion SSE, Chart.js y filtro gaussiano
│
└── templates/                 # Vistas HTML
    └── index.html             # Dashboard web principal sin emojis y con botones de iconos
```

---

## 4. Variables Monitoreadas

| Variable | Sensor / Origen | Unidad | Descripcion |
| :--- | :--- | :---: | :--- |
| **Temperatura** | DHT22 (Pin D4) | °C | Temperatura ambiente del entorno |
| **Humedad Relativa** | DHT22 (Pin D4) | % HR | Contenido de vapor de agua en el aire |
| **Potencia de Senal (RSSI)** | Wi-Fi ESP32 | dBm | Nivel de potencia recibida del enlace inalambrico |
| **Sensacion Termica** | Calculo en Servidor | °C | Regresion multiple de Rothfusz (NOAA) |
| **Punto de Rocio** | Calculo en Servidor | °C | Aproximacion termodinamica de Magnus-Tetens |
| **Estado Operativo** | Servidor | Texto | Clasificacion automatica (`NORMAL`, `ALERTA`, `CRITICO`) |

---

## 5. Guia de Puesta en Marcha

### Opcion A: Ejecutar localmente en tu computador (Modo Prueba)

1. **Requisitos:** Tener instalado Python 3.9 o superior.
2. **Iniciar el servidor:**
   Haz doble clic sobre `iniciar_local.bat` o ejecuta en la terminal:
   ```bash
   python app.py
   ```
3. **Abrir en el navegador:**
   - En tu computador: `http://127.0.0.1:5000`
   - Desde tu celular (conectado al mismo Wi-Fi): `http://<TU_IP_LOCAL>:5000`

4. **Si no tienes el ESP32 fisico a mano (Simulacion):**
   Abre una segunda terminal y ejecuta el simulador incluido:
   ```bash
   python simulador_esp32.py --interval 4.0
   ```
   Veras como la pagina web empieza a recibir lecturas cada 4 segundos en tiempo real.

---

### Opcion B: Configurar el ESP32 Fisico (Arduino IDE)

1. Abre el archivo `firmware/esp32_dht_monitor/esp32_dht_monitor.ino` en **Arduino IDE**.
2. Instala desde el Gestor de Bibliotecas de Arduino:
   - **DHT sensor library** (por Adafruit)
   - **Adafruit Unified Sensor** (por Adafruit)
3. Conecta el circuito fisico:
   - `VCC` del DHT22 -> Pin `3.3V` del ESP32
   - `GND` del DHT22 -> Pin `GND` del ESP32
   - `DATA` del DHT22 -> Pin `GPIO 4` (D4) del ESP32
4. En el codigo, configura tus credenciales Wi-Fi y la URL de tu servidor:
   ```cpp
   const char* WIFI_SSID     = "NombreDeTuRedWiFi";
   const char* WIFI_PASSWORD = "ContrasenaDeTuWiFi";
   const char* SERVER_URL    = "http://<IP_PUBLICA_O_LOCAL>/api/readings";
   ```
5. Carga el programa en la placa y abre el Monitor Serie a `115200 baud`.

---

### Opcion C: Despliegue en Servidor Cloud con IP Publica (Ubuntu / Debian)

Compatible con **Microsoft Azure**, **Google Cloud Compute Engine**, **DigitalOcean** o **AWS EC2**:

1. Clona el repositorio directamente en tu servidor virtual:
   ```bash
   git clone https://github.com/Nocudo/Proyectosiscom2.git /opt/proyectosiscom2
   ```

2. Ejecuta el instalador automatico con permisos root:
   ```bash
   cd /opt/proyectosiscom2
   sudo bash deploy/setup_vps.sh
   ```
   *El script se encarga de todo: actualiza paquetes, crea el entorno virtual, instala dependencias, configura el servicio permanente Systemd (`siscom-monitor.service`) y prepara Nginx como proxy inverso en el puerto 80 sobre la IP publica.*

3. El servicio quedara activo y escuchando en `http://<IP_PUBLICA_DEL_SERVIDOR>/`.

---

## 6. Endpoints de la API REST

| Metodo | Ruta | Descripcion | Formato |
| :--- | :--- | :--- | :--- |
| `GET` | `/` | Carga el Dashboard Web interactivo | HTML / CSS / JS |
| `POST` | `/api/readings` | Endpoint receptor de telemetria del sensor | JSON |
| `GET` | `/api/readings` | Consulta historica con filtros (`limit`, `node`) | JSON |
| `GET` | `/api/stream` | Canal en tiempo real mediante Server-Sent Events | `text/event-stream` |
| `GET` | `/api/export/csv` | Descarga de la base de datos en archivo CSV | Archivo CSV |
| `DELETE` | `/api/readings` | Reinicio seguro del historial de lecturas | JSON |

### Formato de trama transmitida por el ESP32 (`POST /api/readings`):

```json
{
  "device_id": "ESP32-NODO-01",
  "location": "Laboratorio Comunicaciones II",
  "temperature": 24.35,
  "humidity": 61.20,
  "rssi": -65
}
```

---

## 7. Caracteristicas de Diseno e Interfaz

* **Diseno ultra-minimalista:** Interfaz limpia sin emojis, con tipografia de sistema rapida y modo oscuro de bajo consumo.
* **Acciones por iconos SVG:** Botones compactos sin texto visible redundante (Recargar, Exportar CSV, Limpiar historial).
* **Curvas suaves sin picos:** Filtro gaussiano simetrico de 5 puntos `[1, 3, 5, 3, 1]` que atenua el ruido de cuantizacion del DHT22 sin introducir desfase visible.
* **Escalado adaptativo:** Escala lineal en Chart.js con margen de tolerancia (`grace: 12%`) para evitar la magnificación exagerada de pequenas oscilaciones termicas.
* **Mobile-First:** La tabla de lecturas se reorganiza dinamicamente como tarjetas individuales en telefonos moviles para evitar desplazamientos horizontales.
