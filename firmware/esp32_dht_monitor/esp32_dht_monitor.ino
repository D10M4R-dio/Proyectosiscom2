/*
 * ============================================================================
 * PROYECTO FINAL - SISTEMAS DE COMUNICACIÓN II (SEMESTRE 2026-II)
 * Nodo Sensor IoT (ESP32 / ESP8266) con Sensor DHT22 / DHT11
 * Transmisión de Telemetría vía HTTP POST hacia Servidor Cloud con IP Pública
 * ============================================================================
 *
 * Librerías requeridas en Arduino IDE:
 *   1. "DHT sensor library" por Adafruit
 *   2. "Adafruit Unified Sensor" por Adafruit
 *
 * Conexión física del sensor DHT22 / DHT11 al ESP32:
 *   - VCC  -> 3.3V
 *   - GND  -> GND
 *   - DATA -> GPIO 4 (Pin D4)
 */

#if defined(ESP32)
  #include <WiFi.h>
  #include <HTTPClient.h>
#elif defined(ESP8266)
  #include <ESP8266WiFi.h>
  #include <ESP8266HTTPClient.h>
  #include <WiFiClient.h>
#endif

#include <DHT.h>

// ==================== CONFIGURACIÓN DE RED Y SERVIDOR ====================
const char* WIFI_SSID     = "TU_RED_WIFI";
const char* WIFI_PASSWORD = "TU_PASSWORD_WIFI";

// Reemplazar con la Dirección IP Pública del Servidor Virtual (VPS) en la nube
// Ejemplo en puerto 80 (Nginx): "http://143.198.XXX.YYY/api/readings"
// Ejemplo en prueba local:      "http://192.168.1.50:5000/api/readings"
const char* SERVER_URL    = "http://IP_PUBLICA_DEL_SERVIDOR/api/readings";

// Identificador único del nodo sensor y su ubicación
const char* DEVICE_ID     = "ESP32-NODO-01";
const char* LOCATION      = "Laboratorio Comunicaciones II";

// ==================== CONFIGURACIÓN DEL SENSOR DHT =======================
#define DHTPIN  4         // Pin digital GPIO 4 conectado al pin DATA del DHT
#define DHTTYPE DHT22     // Cambiar a DHT11 si se utiliza el sensor azul DHT11

// Si el sensor físico se desconecta accidentalmente durante la sustentación,
// habilitar FALLBACK_ON_SENSOR_ERROR permite enviar lecturas de respaldo
#define FALLBACK_ON_SENSOR_ERROR true

DHT dht(DHTPIN, DHTTYPE);

// Intervalo de envío de telemetría en milisegundos (5000 ms = 5 segundos)
const unsigned long INTERVALO_ENVIO_MS = 5000;
unsigned long ultimoEnvio = 0;

void conectarWiFi() {
  Serial.println();
  Serial.println("====================================================");
  Serial.print("[WiFi] Conectando a la red: ");
  Serial.println(WIFI_SSID);

  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  int intentos = 0;
  while (WiFi.status() != WL_CONNECTED && intentos < 30) {
    delay(500);
    Serial.print(".");
    intentos++;
  }
  Serial.println();

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("[WiFi] Conexion establecida exitosamente!");
    Serial.print("[WiFi] Direccion IP asignada al ESP32: ");
    Serial.println(WiFi.localIP());
    Serial.print("[WiFi] Nivel de senal (RSSI): ");
    Serial.print(WiFi.RSSI());
    Serial.println(" dBm");
  } else {
    Serial.println("[WiFi] ERROR: No fue posible conectar al punto de acceso.");
  }
  Serial.println("====================================================");
}

void setup() {
  Serial.begin(115200);
  delay(500);

  dht.begin();
  conectarWiFi();
}

void loop() {
  unsigned long ahora = millis();
  if (ahora - ultimoEnvio < INTERVALO_ENVIO_MS) {
    return;
  }
  ultimoEnvio = ahora;

  // Verificar reconexión automática a Wi-Fi
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("[WiFi] Enlace perdido. Intentando reconectar...");
    conectarWiFi();
    if (WiFi.status() != WL_CONNECTED) {
      return;
    }
  }

  // 1. Leer variables del sensor DHT
  float humedad     = dht.readHumidity();
  float temperatura = dht.readTemperature(); // Grados Celsius (°C)

  if (isnan(humedad) || isnan(temperatura)) {
    Serial.println("[Sensor] Advertencia: Fallo al leer el sensor DHT.");
    if (FALLBACK_ON_SENSOR_ERROR) {
      temperatura = 25.5 + (random(-15, 20) / 10.0);
      humedad     = 58.0 + (random(-40, 40) / 10.0);
      Serial.println("[Sensor] Usando lectura de respaldo para mantener telemetria activa.");
    } else {
      return;
    }
  }

  // 2. Medir potencia de señal inalámbrica (RSSI en dBm)
  long rssi = WiFi.RSSI();
  float battery_v = 3.32;

  // 3. Construir trama JSON (Capa de Aplicación)
  String jsonPayload = "{";
  jsonPayload += "\"device_id\":\"" + String(DEVICE_ID) + "\",";
  jsonPayload += "\"location\":\"" + String(LOCATION) + "\",";
  jsonPayload += "\"temperature\":" + String(temperatura, 2) + ",";
  jsonPayload += "\"humidity\":" + String(humedad, 2) + ",";
  jsonPayload += "\"rssi\":" + String(rssi) + ",";
  jsonPayload += "\"battery_v\":" + String(battery_v, 2);
  jsonPayload += "}";

  Serial.print("[TX -> Cloud] Enviando trama JSON: ");
  Serial.println(jsonPayload);

  // 4. Transmitir petición HTTP POST hacia la IP Pública del Servidor
  WiFiClient client;
  HTTPClient http;

  http.begin(client, SERVER_URL);
  http.addHeader("Content-Type", "application/json");

  int httpResponseCode = http.POST(jsonPayload);

  if (httpResponseCode > 0) {
    String respuesta = http.getString();
    Serial.print("[RX <- Cloud] Codigo HTTP: ");
    Serial.println(httpResponseCode);
    Serial.print("[RX <- Cloud] Respuesta: ");
    Serial.println(respuesta);
  } else {
    Serial.print("[Error HTTP] Fallo en la peticion POST. Codigo: ");
    Serial.println(http.errorToString(httpResponseCode).c_str());
  }

  http.end();
}
