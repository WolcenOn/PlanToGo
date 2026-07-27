# PlanToGo

PlanToGo es una aplicación web mobile-first para organizar planes, fechas, tareas y ubicaciones entre grupos, reduciendo el caos de coordinación en chats.

## Stack del MVP

- Backend: Go, API REST y WebSockets
- Frontend: HTML5, CSS3 y JavaScript ES6+ sin frameworks
- Base de datos: PostgreSQL
- Mapas: Leaflet.js y Nominatim/OpenStreetMap
- PWA: manifest y Service Worker
- Despliegue: Railway mediante Docker

## Arranque local

1. Copia `.env.example` a `.env`.
2. Levanta PostgreSQL con `docker compose up -d db`.
3. Ejecuta la migración `migrations/000001_init.up.sql`.
4. Inicia la API con `go run ./cmd/api`.
5. Abre `http://localhost:8080`.

## Estructura

```text
/cmd/api
/internal/config
/internal/database
/internal/handlers
/internal/models
/internal/services
/internal/ws
/migrations
/web/static
/web/templates
```

## Seguridad de enlaces públicos

Los identificadores internos de planes y grupos no actúan como credenciales. El backend genera tokens aleatorios, almacena únicamente su hash SHA-256 y permite caducarlos o revocarlos.

## Estado

Bootstrap inicial del MVP en desarrollo.
