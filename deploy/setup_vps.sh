#!/usr/bin/env bash
# ==============================================================================
# SCRIPT DE DESPLIEGUE AUTOMATIZADO EN SERVIDOR VIRTUAL EN LA NUBE (VPS)
# Proyecto Final - Sistemas de Comunicación II (Semestre 2026-II)
# Compatible con Ubuntu 20.04 / 22.04 / 24.04 LTS y Debian 11 / 12
# Proveedores: DigitalOcean, Google Cloud, Microsoft Azure, AWS EC2
# ==============================================================================

set -e

APP_DIR="/opt/proyectosiscom2"
SERVICE_NAME="siscom-monitor"
SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "=================================================================="
echo "  INSTALADOR AUTOMATIZADO DE SERVICIO WEB IoT SOBRE IP PÚBLICA"
echo "=================================================================="

if [ "$EUID" -ne 0 ]; then
  echo "[!] Por favor ejecuta este script con privilegios root: sudo bash deploy/setup_vps.sh"
  exit 1
fi

echo "[1/6] Actualizando paquetes del sistema e instalando Python, Nginx y UFW..."
apt-get update -y
apt-get install -y python3 python3-venv python3-pip nginx ufw curl

echo "[2/6] Preparando directorio de aplicación en ${APP_DIR}..."
mkdir -p "${APP_DIR}"
if [ "${SRC_DIR}" != "${APP_DIR}" ]; then
  cp -r "${SRC_DIR}/"* "${APP_DIR}/"
fi
mkdir -p "${APP_DIR}/data"

echo "[3/6] Creando entorno virtual Python e instalando Flask y Gunicorn..."
python3 -m venv "${APP_DIR}/.venv"
"${APP_DIR}/.venv/bin/pip" install --upgrade pip
"${APP_DIR}/.venv/bin/pip" install -r "${APP_DIR}/requirements.txt"

echo "[4/6] Configurando servicio Systemd (${SERVICE_NAME}.service) para ejecución 24/7..."
cat >/etc/systemd/system/${SERVICE_NAME}.service <<EOF
[Unit]
Description=Servidor Web de Monitoreo IoT - Sistemas de Comunicacion II
After=network.target

[Service]
User=root
WorkingDirectory=${APP_DIR}
Environment="PATH=${APP_DIR}/.venv/bin"
Environment="PORT=5000"
ExecStart=${APP_DIR}/.venv/bin/gunicorn --workers 1 --threads 8 --bind 127.0.0.1:5000 --timeout 120 app:app
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable ${SERVICE_NAME}
systemctl restart ${SERVICE_NAME}

echo "[5/6] Configurando Nginx como Proxy Inverso en Puerto 80 (IP Pública)..."
cat >/etc/nginx/sites-available/${SERVICE_NAME} <<'EOF'
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name _;

    client_max_body_size 5M;

    location / {
        proxy_pass http://127.0.0.1:5000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Configuración especial para Server-Sent Events (Tiempo Real sin buffering)
    location /api/stream {
        proxy_pass http://127.0.0.1:5000/api/stream;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_buffering off;
        proxy_cache off;
        chunked_transfer_encoding off;
        proxy_read_timeout 86400s;
    }
}
EOF

rm -f /etc/nginx/sites-enabled/default
ln -sf /etc/nginx/sites-available/${SERVICE_NAME} /etc/nginx/sites-enabled/${SERVICE_NAME}
nginx -t
systemctl enable nginx
systemctl restart nginx

echo "[6/6] Configurando Firewall (UFW) para permitir tráfico HTTP en IP Pública..."
ufw allow OpenSSH || true
ufw allow 'Nginx Full' || ufw allow 80/tcp || true

PUBLIC_IP=$(curl -s --max-time 4 ifconfig.me || hostname -I | awk '{print $1}')

echo "=================================================================="
echo "  DESPLIEGUE COMPLETADO EXITOSAMENTE"
echo "=================================================================="
echo "  Dashboard Web en IP Pública : http://${PUBLIC_IP}/"
echo "  Reporte Técnico Imprimible  : http://${PUBLIC_IP}/reporte"
echo "  Endpoint API para el ESP32  : http://${PUBLIC_IP}/api/readings"
echo "=================================================================="
