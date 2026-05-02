# Guia simple para dejar el monitor funcionando

Esta herramienta revisa paginas de inmobiliarias y finques cada 15 minutos. Si encuentra un piso que puede encajar, te manda un mensaje por Telegram.

## Lo importante

- No hace falta que tu computadora este prendida si lo subimos a Railway.
- Telegram es solo para recibir avisos.
- Upstash es la memoria del monitor: guarda que anuncios ya fueron vistos para no repetirlos.
- La lista de inmobiliarias esta en `config/sources.json`. Se puede ampliar sin rehacer todo.

## Opcion recomendada: nube gratis

Usaria:

- GitHub Actions para ejecutar el monitor cada 15 minutos.
- Upstash Redis para guardar anuncios ya vistos.
- Telegram Bot para enviarte avisos.

GitHub Actions puede ejecutar tareas programadas cada 15 minutos. Es gratis en repositorios publicos; en repositorios privados usa la cuota gratuita mensual de tu cuenta. Upstash tiene plan gratuito con 256 MB y 500K comandos mensuales, suficiente para este uso.

Nota importante: si el repositorio es publico y no tiene actividad durante 60 dias, GitHub puede desactivar los horarios automaticos. Se puede reactivar manualmente o hacer un pequeno cambio cada tanto.

## Pasos humanos

1. Crear un bot de Telegram con BotFather.
2. Enviarle un mensaje al bot, aunque sea “hola”.
3. Obtener tu `TELEGRAM_CHAT_ID`.
4. Crear una base Redis en Upstash.
5. Copiar de Upstash dos datos: `UPSTASH_REDIS_REST_URL` y `UPSTASH_REDIS_REST_TOKEN`.
6. Subir esta carpeta a un repositorio de GitHub.
7. En GitHub, entrar al repositorio y abrir `Settings` -> `Secrets and variables` -> `Actions`.
8. Crear estos secretos:

```text
TELEGRAM_BOT_TOKEN=...
TELEGRAM_CHAT_ID=...
UPSTASH_REDIS_REST_URL=...
UPSTASH_REDIS_REST_TOKEN=...
STATE_BACKEND=upstash
STATE_KEY=barcelona-rental-monitor:state
```

9. Ir a la pestaña `Actions`, abrir `Rental monitor` y ejecutar `Run workflow` una vez para probar.

El archivo `.github/workflows/rental-monitor.yml` ya deja configurado el chequeo cada 15 minutos.

## Como probar antes de dejarlo andando

Primero se puede correr una prueba sin enviar mensajes reales:

```bash
node src/monitor.js simulate --dry-run
```

Luego, cuando Telegram este configurado:

```bash
node src/monitor.js simulate
```

Si llega el mensaje, ya se puede dejar activo en GitHub Actions.

## Alternativa paga

Railway tambien sirve, pero no lo recomiendo como primera opcion si buscamos coste cero. Dejé el archivo `railway.json` solo como alternativa.

## Que mensaje manda

Cuando detecta un piso, incluye datos basicos y este texto:

```text
Hola [nombre]! Escribo para programar una visita al piso de alquiler xxx.
Somos una familia de 4, y nos encajaría perfecto.
```

Si no encuentra nombre, usa “Hola!”. Si no encuentra referencia, usa el titulo o enlace del piso.

## Fuentes

El monitor prioriza finques y administradores locales, por ejemplo Finques Bou, Basmi Finques, Grup Solfinc, FINOR BCN, ZonaPisos/Zona Finques, Forcadell y otras.

Tambien revisa algunos portales como respaldo, pero con filtros mas estrictos para evitar ruido.
