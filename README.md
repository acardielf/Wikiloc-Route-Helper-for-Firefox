# Wikiloc Route Helper

Extensión de Firefox que, al activarla mediante el botón de la barra de
herramientas, aplica una serie de modificaciones locales (JavaScript y CSS)
sobre las páginas de [wikiloc.com](https://www.wikiloc.com) para facilitar el
visionado de rutas.

**Este proyecto no está afiliado a, ni respaldado por, Wikiloc.** "Wikiloc" es
una marca de sus respectivos titulares y se menciona únicamente para describir
la compatibilidad de la extensión.

## Funcionalidades

En la página de búsqueda de rutas con mapa (`/wikiloc/map.do`), la extensión
añade un pequeño panel «Trazados» con tres modos:

- **Al pasar el ratón**: al posar el cursor sobre una ficha de ruta se
  muestra su trazado en el mapa, y desaparece al salir (equivale a pulsar y
  despulsar «Muestra en el mapa» automáticamente). Las rutas que ya hubieras
  fijado a mano no se tocan.
- **Al marcar**: tú vas mostrando rutas a demanda con el botón nativo
  «Muestra en el mapa», y cada trazado que se acumula recibe un color
  distinto, con las mismas ventajas que «Todos en color» (franja de color
  en la ficha, resaltado bidireccional, ocultación de waypoints) pero solo
  para las rutas que tú elijas. Al desactivar el modo, los trazados que
  mostraste siguen en el mapa con su color original.
- **Todos en color**: muestra a la vez el trazado de todas las rutas
  filtradas, asignando a cada una un color distinto para distinguirlas
  cuando se solapan. Cada ficha se marca con una franja del color de su
  trazado, que se conserva aunque se oculte y se vuelva a mostrar. Al pasar
  el ratón por una ficha se engorda su trazado en el mapa, y al pasar por un
  trazado se enmarca su ficha y la lista se desplaza hasta ella. Las rutas
  que ya tuvieras fijadas a mano también reciben color y franja. Incluye
  una opción para ocultar los marcadores de waypoint, que con muchos
  trazados a la vez estorban. Al desactivar el modo se ocultan los trazados
  que activó y se restaura el estado original de los demás.

### Uso respetuoso de los servidores de Wikiloc

Los tres modos funcionan pulsando los botones «Muestra en el mapa» que ya
ofrece la propia web, por lo que no se hacen peticiones distintas de las que
haría un usuario a mano. Además:

- Las geometrías se piden estrictamente de una en una (nunca en paralelo),
  con una pausa de cortesía aleatoria de 200–500 ms entre peticiones.
- «Todos en color» **solo se ejecuta con una pulsación explícita del
  usuario**: al recargar o cambiar de página no se relanza automáticamente
  (se recuerda como modo «Al marcar», que no hace nada por sí solo).
- Si el servidor deja de responder dos veces seguidas, el barrido de
  «Todos en color» se aborta en lugar de insistir.

## Cómo funciona

- La extensión solo actúa en `*.wikiloc.com` y está **desactivada por
  defecto**: hay que pulsar el botón de la barra de herramientas para
  activarla (badge «ON») o desactivarla.
- Todas las modificaciones se aplican en el navegador del usuario, sobre la
  página ya cargada. La extensión **no recopila, almacena ni transmite ningún
  dato**: el único permiso que solicita es `storage`, para recordar si está
  activada, el modo elegido y la preferencia de ocultar waypoints.

## Estructura

```
manifest.json            Manifiesto WebExtension (Manifest V3)
src/background.js        Gestiona el botón de activar/desactivar
src/content/wikiloc.js   Modificaciones del DOM en las páginas de Wikiloc
src/content/wikiloc.css  Estilos aplicados cuando la extensión está activa
icons/icon.svg           Icono genérico (sin marcas de terceros)
```

Los estilos solo se aplican bajo la clase `wlx-enabled`, que el content
script añade a `<html>` cuando la extensión está activada.

## Desarrollo

Requisitos: [Node.js](https://nodejs.org) y
[web-ext](https://extensionworkshop.com/documentation/develop/getting-started-with-web-ext/),
la herramienta oficial de Mozilla:

```sh
npm install --global web-ext
```

Lanzar un Firefox temporal con la extensión cargada y recarga automática:

```sh
web-ext run
```

Validar el manifiesto y el código:

```sh
web-ext lint
```

### Carga temporal sin web-ext

También puedes abrir `about:debugging#/runtime/this-firefox` en Firefox,
pulsar «Cargar complemento temporal…» y seleccionar el `manifest.json`. La
extensión desaparecerá al cerrar el navegador.

## Compilar el .xpi

Un `.xpi` es un ZIP con el `manifest.json` en la raíz. Con web-ext:

```sh
web-ext build
```

El paquete se genera en `web-ext-artifacts/`. Equivalente con `zip`:

```sh
zip -r -FS wikiloc-route-helper.xpi manifest.json src/ icons/ LICENSE
```

### Firma (necesaria para instalación permanente)

Las versiones normales de Firefox solo instalan de forma permanente
extensiones **firmadas por Mozilla**. Opciones:

1. **Firma self-hosted** con las credenciales de la
   [API de addons.mozilla.org](https://addons.mozilla.org/developers/addon/api/key/):

   ```sh
   web-ext sign --channel unlisted \
     --api-key "TU_JWT_ISSUER" --api-secret "TU_JWT_SECRET"
   ```

   Genera un `.xpi` firmado e instalable en cualquier Firefox.

2. **Publicación en addons.mozilla.org** (canal *listed*), subiendo el
   paquete desde el [Developer Hub](https://addons.mozilla.org/developers/).

3. Para uso propio sin firmar: Firefox
   [Developer Edition](https://www.firefox.com/channel/desktop/developer/) o
   Nightly permiten desactivar la comprobación con
   `xpinstall.signatures.required = false` en `about:config`.

> El id de la extensión (`browser_specific_settings.gecko.id`) es
> `wikiloc-route-helper@acardielf.github.io` y **no debe cambiarse**: AMO lo
> usa como identidad permanente, y las futuras versiones deben mantenerlo
> para que Firefox las instale como actualización. Pasa las credenciales de
> firma mediante las variables de entorno `WEB_EXT_API_KEY` y
> `WEB_EXT_API_SECRET`, nunca como argumentos en la línea de comandos.

## Consideraciones legales

- La extensión modifica únicamente la **presentación local** de la página en
  el navegador del usuario, algo que este puede hacer legítimamente en su
  propio equipo. No elude medidas de acceso, no automatiza descargas masivas
  y no extrae, almacena ni redistribuye contenido de Wikiloc.
- Toda petición al servidor se origina en las funciones nativas de la web y
  bajo el control del usuario: los modos «Al pasar el ratón» y «Al marcar»
  responden a acciones individuales, y «Todos en color» requiere una
  pulsación explícita en cada página, limitado a los resultados visibles y
  con las cautelas de ritmo descritas más arriba.
- No desbloquea ni imita ninguna funcionalidad de pago (Premium).
- No incluye logotipos, marcas ni recursos propiedad de Wikiloc.
- Si añades funcionalidades nuevas, revisa que sigan respetando los
  [términos de uso de Wikiloc](https://es.wikiloc.com/wikiloc/terms.do) y las
  [políticas para desarrolladores de Mozilla](https://extensionworkshop.com/documentation/publish/add-on-policies/)
  (en particular: no recopilar datos sin consentimiento y declarar cualquier
  permiso adicional).

## Licencia

Este programa es software libre distribuido bajo los términos de la
**GNU General Public License, versión 3 o posterior** (GPL-3.0-or-later).
Consulta el archivo [LICENSE](LICENSE) para el texto completo.

    Copyright (C) 2026  Ángel Cardiel

    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU General Public License for more details.
