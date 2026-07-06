# AR Dashboard — Playbook de Ingeniería Senior
### Cómo un solo desarrollador compite (y gana) contra un equipo de 8

Un equipo grande tiende a competir con **más features**. Un ingeniero senior gana con lo que de verdad importa en producción y casi nadie ve hasta que falla: **fiabilidad, seguridad, rendimiento y pulido**. Menos piezas, mejor hechas. Este documento es tu plan por fases; cada una es independiente y suma "puntos senior".

Prioridad recomendada: **Fase 0 → 1 → 3 → 2 → 4** (primero lo que se ve y lo que protege).

---

## Fase 0 — Eliminar Ngrok con dominio propio y seguridad de borde (Cloudflare Tunnel)

**El problema del aviso de Ngrok** no se quita en el plan gratuito. La solución profesional —y que además respeta tu firewall corporativo (túnel saliente, sin abrir puertos)— es **Cloudflare Tunnel** con tu propio dominio. Gratis, HTTPS real, sin página intermedia, y de paso te da WAF, rate-limiting y protección DDoS en el borde. Eso es más de lo que muchos equipos montan a mano.

Pasos (una sola vez):

1. En el panel de Cloudflare, añade tu dominio y crea un **túnel con nombre** (Zero Trust → Networks → Tunnels → Create). Copia el **token** del túnel.
2. Configura la ruta pública del túnel apuntando a `http://ar-dashboard:3001` (o `http://localhost:3001`) con el hostname `dashboard.tudominio.com`.
3. En el servidor, pon el token en `.env`:
   ```
   CLOUDFLARE_TUNNEL_TOKEN=eyJ...tu_token...
   ```
4. Levanta con el compose de producción (incluye el servicio `cloudflared`):
   ```bash
   docker compose -f docker-compose.prod.yml up -d --build
   ```
5. En Cloudflare, activa: **Always Use HTTPS**, **Bot Fight Mode**, una **Rate Limiting Rule** (p. ej. 100 req/min por IP a `/api/*`) y **WAF Managed Rules**. Con esto tienes defensa contra inyecciones y DDoS a nivel de borde.

Resultado: los usuarios entran a `https://dashboard.tudominio.com` sin avisos, con la cámara AR funcionando (HTTPS real), y el servidor deja de exponer puertos a internet.

> Puedes retirar el servicio systemd de Ngrok cuando el túnel Cloudflare esté estable: `sudo systemctl disable --now ngrok-dashboard.service`.

---

## Fase 1 — Endurecer el servidor (script incluido)

Ejecuta `sudo ./server-hardening.sh`. Aplica, de forma idempotente:

- **UFW**: deniega todo lo entrante, permite solo SSH. No abrimos 80/443 porque el tráfico entra por el túnel Cloudflare (saliente).
- **fail2ban**: banea IPs que intentan fuerza bruta por SSH.
- **unattended-upgrades**: parches de seguridad automáticos.
- **sysctl**: sube límites de conexiones concurrentes del kernel (`somaxconn`, backlog).

Complementos manuales recomendados: deshabilitar login SSH por contraseña (solo llaves), y `PermitRootLogin no` en `/etc/ssh/sshd_config`.

---

## Fase 2 — App endurecida y lista para alta carga (`server.js` v2)

El nuevo backend ya incluye:

- **Caché de KPIs (TTL 45s) + dedup de peticiones en vuelo.** Este es el mayor salto de rendimiento: aunque lleguen 500 usuarios a la vez, Grafana/MySQL reciben **una sola** consulta por combinación área/tiempo cada 45s. Sin esto, cada visita golpea la base de GLPI. Cabecera `X-Cache: HIT/MISS/STALE` para verificarlo.
- **Degradación elegante:** si Grafana falla, se sirve la última caché válida en vez de ceros.
- **compression (gzip)** y **caché de estáticos** (`Cache-Control`).
- **SQLite en modo WAL** + `busy_timeout`: muchas lecturas concurrentes sin bloquear.
- **Rate-limit global** por IP (600/15min) además del de login (5/15min).
- **Helmet** (cabeceras de seguridad) y **`trust proxy`** para IPs reales tras Cloudflare.
- **Logging de accesos** (morgan) con IP, método, estado y latencia.
- **bcrypt** para la contraseña admin (ver migración abajo).
- **Consultas parametrizadas** en todo el CRUD → sin inyección SQL. El área se valida contra una lista blanca antes de tocar el SQL de Grafana.
- **/health** para monitoreo y **cierre ordenado** (SIGTERM/SIGINT).

### Migrar la contraseña admin a hash (bcrypt)
1. Genera el hash (no expone la contraseña en el código ni en logs):
   ```bash
   cd backend && node -e "require('bcryptjs').hash('TU_PASSWORD', 12).then(console.log)"
   ```
2. En `.env`, reemplaza `ADMIN_PASS` por:
   ```
   ADMIN_PASS_HASH=$2a$12$....el_hash....
   ```
   (Si dejas `ADMIN_PASS` en texto, sigue funcionando por compatibilidad, pero el hash es lo correcto.)

### Probar la carga (antes de la presentación)
```bash
# 500 peticiones, 50 concurrentes al endpoint de KPIs
ab -n 500 -c 50 "https://dashboard.tudominio.com/api/kpis?area=helpdesk&tiempo=mes_actual"
```
Con la caché activa, la latencia media debe ser baja y estable.

---

## Fase 3 — Monitoreo y alarmas (Uptime Kuma)

El compose levanta **Uptime Kuma** (UI en `http://localhost:3005`, accesible por túnel SSH: `ssh -L 3005:localhost:3005 miguel@servidor`). Configura:

- Un monitor HTTP a `https://dashboard.tudominio.com/health` cada 60s.
- Un monitor al contenedor / puerto 3001.
- **Notificaciones**: Telegram (crea un bot con @BotFather), email o webhook. Recibes alerta al instante si el dashboard se cae.
- Una **status page** pública opcional (se ve muy profesional).

Extra (opcional, ya tienes Grafana): añade `node-exporter` + `cAdvisor` y un dashboard de Grafana para CPU/RAM/red del servidor y de los contenedores. Así monitoreas el host con la misma herramienta que ya usas.

Docker ya reinicia solo (`restart: unless-stopped`) y tiene **healthcheck**: si el proceso muere, se levanta.

---

## Fase 4 — Estructura y calidad de código (lo que revisa un senior)

Roadmap para cuando pase la urgencia (no bloquea la presentación):

- **Modularizar** `server.js` en `config/`, `db/`, `middleware/`, `routes/`, `services/grafana.js`. Un archivo por responsabilidad.
- **Variables de entorno**: mover el `MYSQL_UID` y `GRAFANA_URL` a `.env` (ya soportado por defaults).
- **ESLint + Prettier** con un `npm run lint` — consistencia automática.
- **Tests** con Vitest/Jest para el CRUD y el parseo de KPIs; y un smoke test de `/health`.
- **CI en GitHub Actions**: en cada push a `develop`, corre lint + tests + build de la imagen.
- **Sacar `personal.sqlite` del control de versiones** (`git rm --cached backend/personal.sqlite`) para que los despliegues dejen de arriesgar tus datos.
- **Rotar y purgar del historial** los secretos que estuvieron expuestos (`git filter-repo`).

---

## Resumen ejecutivo (qué decir en la presentación)

> "El dashboard corre en Docker detrás de un túnel Cloudflare con HTTPS y WAF, sin exponer puertos. El backend cachea las métricas y deduplica consultas, así soporta picos de tráfico sin sobrecargar GLPI. Hay firewall, fail2ban, rate-limiting, cabeceras de seguridad y contraseñas hasheadas. El uptime se monitorea con alarmas a Telegram, y Docker se autorrecupera. Todo versionado en Git con ramas de producción y pruebas."

Eso es una arquitectura de nivel senior — y la sostiene una sola persona.
