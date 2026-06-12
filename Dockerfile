# Imagen ligera de Node.js
FROM node:18-alpine

WORKDIR /app

# Copiamos primero los manifiestos para aprovechar la caché de capas
COPY backend/package*.json ./backend/

# Instalación reproducible desde el lockfile (omite devDependencies)
RUN cd backend && npm install --omit=dev

# Copiamos el resto del proyecto
COPY . .

# Ejecutamos como usuario sin privilegios (el de node:alpine)
RUN chown -R node:node /app
USER node

EXPOSE 3001

CMD ["node", "backend/server.js"]
