#!/usr/bin/env bash
# Endurecimiento del servidor Ubuntu (ejecutar con sudo). Idempotente.
set -euo pipefail

echo "==> Firewall (UFW): denegar entrante, permitir SSH; NO abrimos 80/443 (usamos túnel Cloudflare)"
apt-get update -y
apt-get install -y ufw fail2ban unattended-upgrades
ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw --force enable

echo "==> fail2ban para SSH (banea IPs con fuerza bruta)"
cat > /etc/fail2ban/jail.local <<'JAIL'
[sshd]
enabled  = true
maxretry = 5
bantime  = 1h
findtime = 10m
JAIL
systemctl enable --now fail2ban
systemctl restart fail2ban

echo "==> Actualizaciones de seguridad automáticas"
dpkg-reconfigure -f noninteractive unattended-upgrades || true

echo "==> Límites de red (kernel) para más conexiones concurrentes"
cat > /etc/sysctl.d/99-ar-dashboard.conf <<'SYS'
net.core.somaxconn = 1024
net.ipv4.tcp_max_syn_backlog = 2048
net.ipv4.ip_local_port_range = 1024 65535
SYS
sysctl --system

echo "==> Listo. Estado UFW:"; ufw status verbose
