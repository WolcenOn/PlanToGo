# Activación gradual de autenticación

La autenticación está desactivada por defecto. Mientras `AUTH_ENABLED` no sea `true`, PlanToGo mantiene el comportamiento actual basado en el perfil local y `actor_email`.

## Prueba segura en Railway

Añade estas variables al servicio de Railway:

```text
AUTH_ENABLED=true
PUBLIC_URL=https://TU-DOMINIO-DE-RAILWAY
AUTH_COOKIE_SECURE=true
AUTH_DEV_LOG_LINKS=true
```

No añadas todavía variables SMTP. Con `AUTH_DEV_LOG_LINKS=true`, el enlace de acceso se escribe en los logs del servicio y no se envía por correo.

Este modo no debe utilizarse con `APP_ENV=production`. Para probarlo temporalmente, utiliza un entorno de staging o establece `APP_ENV=staging`.

Después del despliegue:

1. Envía una petición `POST /api/v1/auth/request` con JSON `{"email":"tu@email.com"}`.
2. Abre los logs de Railway.
3. Busca el mensaje `development magic link`.
4. Copia el campo `link` y ábrelo en el navegador.
5. Comprueba `GET /api/v1/auth/me`; debe devolver el usuario autenticado.
6. Ejecuta `POST /api/v1/auth/logout` para cerrar la sesión.

## Activación con correo real

Cuando la prueba anterior funcione, cambia a:

```text
AUTH_ENABLED=true
PUBLIC_URL=https://TU-DOMINIO
AUTH_COOKIE_SECURE=true
AUTH_DEV_LOG_LINKS=false
SMTP_HOST=smtp.tu-proveedor.com
SMTP_PORT=587
SMTP_USERNAME=usuario-smtp
SMTP_PASSWORD=secreto-smtp
SMTP_FROM=PlanToGo <acceso@tu-dominio.com>
```

El dominio remitente debe estar verificado en el proveedor de correo. No guardes `SMTP_PASSWORD` en el repositorio.

## Desactivación inmediata

Para volver al comportamiento anterior, cambia:

```text
AUTH_ENABLED=false
```

Las tablas y sesiones existentes permanecerán en PostgreSQL, pero las rutas de autenticación dejarán de estar registradas y el resto de la aplicación seguirá funcionando como antes.
