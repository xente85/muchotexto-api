# Usa la imagen oficial de Node.js como base
FROM node:18

# Establece el directorio de trabajo en el contenedor
WORKDIR /app

# Copia los archivos package.json y package-lock.json (si existe)
COPY package*.json ./

# Instala las dependencias del proyecto
RUN npm install

# Copia el resto del código de la aplicación
COPY . .

# Expone el puerto en el que la aplicación estará escuchando
EXPOSE 3000

# Define el comando para correr la aplicación
CMD ["npm", "start"]
