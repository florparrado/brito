# Monitor de alquileres Barcelona

Herramienta local para vigilar pisos de alquiler de larga estancia en Barcelona, con foco en finques, administradores de fincas e inmobiliarias pequeñas de Dreta de l'Eixample y Born/La Ribera.

Si no entiendes codigo, empieza por `GUIA-PARA-USARLO.md`. Ese archivo explica la version practica: Telegram + GitHub Actions + Upstash, para que el monitor funcione aunque tu computadora este apagada.

## Configuracion

1. Crea un bot de Telegram con BotFather.
2. Copia `.env.example` a `.env` o exporta estas variables:

```bash
export TELEGRAM_BOT_TOKEN="..."
export TELEGRAM_CHAT_ID="..."
```

3. Edita `config/sources.json` para agregar o pausar finques. Cada fuente tiene nombre, web, zona, tipo, URLs de alquiler, contacto y estado.

## Uso

Ejecutar una revision:

```bash
node src/monitor.js check
```

Ejecutar en continuo cada 15 minutos:

```bash
node src/monitor.js watch
```

Probar sin enviar Telegram:

```bash
node src/monitor.js check --dry-run
```

Simular un anuncio valido:

```bash
node src/monitor.js simulate --dry-run
```

Si tienes `npm` instalado, tambien puedes usar `npm run check`, `npm run watch` y `npm test`.

## Arranque automatico en macOS

Hay una plantilla en `scripts/launchd.plist.example` para ejecutarlo cada 15 minutos con `launchd`.
Antes de usarla, ajusta la ruta de `node` si en tu equipo no es `/usr/local/bin/node`.

## Nube recomendada gratis

El archivo `.github/workflows/rental-monitor.yml` deja preparado GitHub Actions para ejecutar el monitor cada 15 minutos.

En GitHub, agregalas como `Secrets` del repositorio:

```bash
TELEGRAM_BOT_TOKEN=...
TELEGRAM_CHAT_ID=...
UPSTASH_REDIS_REST_URL=...
UPSTASH_REDIS_REST_TOKEN=...
STATE_BACKEND=upstash
STATE_KEY=barcelona-rental-monitor:state
```

Railway tambien queda disponible con `railway.json`, pero es una alternativa paga/opcional.

## Criterios

- Alta prioridad: Dreta de l'Eixample o Born/La Ribera, 3+ habitaciones, 80+ m2, precio hasta 2100 EUR/mes y senales de larga estancia.
- Revisar: encaja en precio/tamano pero falta una senal clara, o la zona es cercana.
- Descartar: temporada, vacacional, 32 dias-11 meses, maximo 3/10/11 meses, habitaciones sueltas, locales, parkings, venta, duplicados o alquilados.

El estado de anuncios vistos se guarda en `data/seen.json`.
