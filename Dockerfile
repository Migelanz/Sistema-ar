# Usamos una versión ligera de Node.js
FROM node:18-alpine

# Creamos el directorio de trabajo dentro del contenedor
WORKDIR /app

# Copiamos primero los archivos de dependencias para optimizar la caché
COPY backend/package*.json ./backend/

# Instalamos las librerías necesarias del backend
RUN cd backend && npm install

# Copiamos TODO el proyecto (esto asegura que el Frontend entre al contenedor)
COPY . .

# Exponemos el puerto correcto donde vive nuestra API
EXPOSE 3001

# Comando para encender el servidor apuntando a la ruta correcta
CMD ["node", "backend/server.js"]