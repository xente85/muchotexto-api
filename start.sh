#!/bin/bash

# Variables
IMAGE_NAME="article-extractor-api"
CONTAINER_NAME="article-extractor-api-container"
PORT=3000

# Construir la imagen Docker
echo "Building Docker image..."
docker build -t $IMAGE_NAME .

# Verificar si hay un contenedor en ejecución con el mismo nombre y eliminarlo
if [ $(docker ps --all -q -f name=$CONTAINER_NAME) ]; then
    echo "Stopping and removing existing container..."
    docker stop $CONTAINER_NAME
    docker rm $CONTAINER_NAME
fi

# Ejecutar el contenedor Docker en primer plano para ver los logs
echo "Running Docker container..."
docker run -p $PORT:$PORT --name $CONTAINER_NAME $IMAGE_NAME

echo "Docker container is running on port $PORT"
