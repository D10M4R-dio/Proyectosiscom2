#!/usr/bin/env bash
# ==============================================================================
# HABILITAR DOMINIO + HTTPS (LET'S ENCRYPT) EN NGINX PARA ELIMINAR "SITIO NO SEGURO"
# Uso: sudo bash deploy/enable_https.sh tudominio.duckdns.org [correo@ejemplo.com]
# ==============================================================================

set -e

DOMAIN="${1:-}"
EMAIL="${2:-}"
SERVICE_NAME="siscom-monitor"
WEBROOT="/var/www/certbot"

if [ "$EUID" -ne 0 ]; then
  echo "[!] Ejecuta con sudo: sudo bash deploy/enable_https.sh <DOMINIO> [EMAIL]"
  exit 1
fi

if [ -z "$DOMAIN" ]; then
  echo "[!] Debes indicar un dominio en letras que apunte a la IP pública de este servidor."
  echo "    Ejemplo: sudo bash deploy/enable_https.sh siscom2.duckdns.org"
  exit 1
fi

echo "[1/5] Instalando Certbot para Nginx..."
apt-get update -y
apt-get install -y certbot python3-certbot-nginx

echo "[2/5] Abriendo puertos 80 y 443 en UFW..."
ufw allow 'Nginx Full' || { ufw allow 80/tcp || true; ufw allow 443/tcp || true; }

echo "[3/5] Preparando validación ACME HTTP-01 para ${DOMAIN}..."
mkdir -p "${WEBROOT}"
cat >/etc/nginx/sites-available/${SERVICE_NAME} <<EOF
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name ${DOMAIN};

    location ^~ /.well-known/acme-challenge/ {
        root ${WEBROOT};
    }

    location / {
        proxy_pass http://127.0.0.1:5000;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
EOF

nginx -t
systemctl reload nginx

echo "[4/5] Solicitando certificado TLS gratuito en Let's Encrypt..."
if [ -n "$EMAIL" ]; then
  certbot certonly --webroot -w "${WEBROOT}" -d "${DOMAIN}" --non-interactive --agree-tos -m "${EMAIL}" --deploy-hook "systemctl reload nginx"
else
  certbot certonly --webroot -w "${WEBROOT}" -d "${DOMAIN}" --non-interactive --agree-tos --register-unsafely-without-email --deploy-hook "systemctl reload nginx"
fi

echo "[5/5] Configurando Nginx HTTPS (puerto 443) y manteniendo /api/readings compatible con ESP32..."
cat >/etc/nginx/sites-available/${SERVICE_NAME} <<EOF
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name ${DOMAIN} _;

    location ^~ /.well-known/acme-challenge/ {
        root ${WEBROOT};
    }

    # Permite que el ESP32 siga enviando tramas por HTTP sin fallar en redirecciones 301
    location = /api/readings {
        proxy_pass http://127.0.0.1:5000/api/readings;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    # Redirige el resto del tráfico web a HTTPS seguro
    location / {
        return 301 https://${DOMAIN}\$request_uri;
    }
}

server {
    listen 443 ssl;
    listen [::]:443 ssl;
    server_name ${DOMAIN};

    ssl_certificate /etc/letsencrypt/live/${DOMAIN}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${DOMAIN}/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_prefer_server_ciphers on;

    client_max_body_size 5M;

    location / {
        proxy_pass http://127.0.0.1:5000;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
    }

    location /api/stream {
        proxy_pass http://127.0.0.1:5000/api/stream;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
        proxy_buffering off;
        proxy_cache off;
        chunked_transfer_encoding off;
        proxy_read_timeout 86400s;
    }
}
EOF

nginx -t
systemctl reload nginx

echo "=================================================================="
echo "  HTTPS ACTIVADO CORRECTAMENTE"
echo "=================================================================="
echo "  Dashboard seguro : https://${DOMAIN}/"
echo "  API para ESP32   : http://${DOMAIN}/api/readings"
echo "=================================================================="
