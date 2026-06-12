# AR Dashboard — Notas de despliegue y correcciones

## ⚠️ Acción urgente de seguridad (hacer primero)
El archivo `.env` con credenciales reales quedó en el historial de git
(commit `d18c3ec`) y las ramas `main`/`develop` tienen secretos hardcodeados.

1. **Rota** las 4 credenciales (token Grafana, SECRET_KEY, ADMIN_PASS y revisa el usuario):
   - SECRET_KEY nueva: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`
2. **Purga `.env` del historial** (requiere git-filter-repo o BFG):
   ```bash
   git filter-repo --path .env --invert-paths
   git push origin --force --all
   ```
3. Mergea el hardening a `main` y `develop` para que ya no tengan secretos en el código.

## Configuración
1. Copia la plantilla y rellena tus valores:
   ```bash
   cp .env.example .env
   nano .env
   ```
2. Regenera el lockfile (cambió package.json: +helmet, axios corregido, -cors):
   ```bash
   cd backend && npm install && cd ..
   ```

## Ejecución con Docker
```bash
docker compose up -d --build
```
- Producción (rama `main`): puerto **3001** (expuesto por Ngrok).
- Staging  (rama `develop`): mapea `3002:3001` en su propio compose.

## Cambios aplicados en esta revisión
- **server.js**: eliminada la línea con `...` que impedía arrancar; `GRUPOS_GLPI`
  movido a nivel de módulo (corrige el ReferenceError/TDZ en `/api/kpis`);
  ruta de la DB anclada con `path.join(__dirname,...)`; validación de variables
  de entorno al inicio (fail-fast); manejador de errores de Multer; helmet;
  validación de área/campos obligatorios; cierre ordenado de la DB.
- **docker-compose.yml**: `build: .` en vez de imagen placeholder; volumen de la
  DB corregido a `./backend/personal.sqlite`; healthcheck.
- **Dockerfile**: instalación con caché de capas, usuario no-root.
- **default.png**: creado el avatar placeholder que faltaba.
- **.gitignore / .dockerignore**: corregidos los saltos de línea.
- **package.json**: axios a una versión válida (`^1.7.9`), +helmet, -cors (no se usaba).
- **ngrok.exe**: debe sacarse del repo (binario Windows de 31 MB innecesario).

## nginx.conf
El `nginx.conf` original apuntaba a `backend:3000` (puerto y nombre de servicio
inexistentes) y no estaba referenciado por el compose. Si NO usas nginx como
reverse proxy interno, puedes borrarlo. Si sí, se incluye una versión corregida
que apunta al servicio `ar-dashboard:3001`.
