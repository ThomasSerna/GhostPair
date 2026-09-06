# Validación de GhostPair

## Entorno y ejecución

Las pruebas automáticas de navegador usan Windows, Node.js 24 y Playwright. Crean perfiles temporales dentro de `tests/browser/.artifacts`; no usan los perfiles personales instalados. Las ventanas se ejecutan en modo headless. Ningún argumento desactiva avisos de captura o del depurador.

```powershell
npm ci
npm run build
node tests/browser/api-probe.mjs
node tests/browser/capture-probe.mjs
npm run test:browser
```

Para ejecutar una sola combinación: `node tests/browser/smoke.mjs chrome:edge`. Las rutas de ejecutables se pueden configurar con `GHOSTPAIR_CHROME` y `GHOSTPAIR_EDGE`.

El navegador carga la extensión mediante la API de pruebas `Extensions.loadUnpacked`, habilitada exclusivamente en ese proceso con `--enable-unsafe-extension-debugging`. Chrome y Edge actuales retiraron las antiguas banderas de carga de extensiones. Véanse la [documentación de CDP](https://chromedevtools.github.io/devtools-protocol/tot/Extensions/#method-loadUnpacked) y la [documentación de Playwright](https://playwright.dev/docs/chrome-extensions).

## Evidencia obtenida

Validación automatizada del 6 de septiembre de 2026: **48 tests aprobados**, comprobación de tipos y compilación correctas. Incluye autenticación, límites de protocolo, reconstrucción de imágenes, autorización de ventana, portapapeles con adaptadores de memoria y cancelación durante el arranque.

La integración completa pasó en **Chrome→Chrome, Edge→Edge y Chrome→Edge**, con las versiones indicadas abajo. Se verificaron conexión directa, contraseña incorrecta, imagen, clic, liberación del ratón fuera de la imagen, Unicode, escritura con Enter, zoom, redimensionamiento, pausa, retirada del control, creación/cierre de pestañas y finalización. Al apagar el servidor de señalización, las tres combinaciones siguieron permitiendo clics por P2P.

La imagen Docker de señalización se construyó y su servidor respondió `200` con `{"status":"ok"}`. La configuración de Compose pasó la validación local. No se ha desplegado un dominio público.

La prueba del módulo de captura también pasó en ambos navegadores: rechazó comandos de una imagen anterior y el cierre de una pestaña situada fuera de la ventana autorizada. Los ZIP de desarrollo se abrieron y verificaron: contienen el manifiesto MV3 y sus recursos, sin código de pruebas ni permisos obligatorios añadidos por el smoke.

Prueba de primitivas ejecutada el 6 de septiembre de 2026:

| Caso | Chrome 152.0.7977.78 | Edge 152.0.4191.66 |
|---|---|---|
| Instalar extensión MV3 en perfil aislado | Aprobado | Aprobado |
| Capturar JPEG por `chrome.debugger` / `Page.startScreencast` | Aprobado | Aprobado |
| Clic mediante `Input.dispatchMouseEvent` | Aprobado | Aprobado |
| Insertar texto Unicode `á漢🙂` | Aprobado | Aprobado |
| Redimensionar a 820 × 600 y cambiar zoom a 125 % | Aprobado | Aprobado |
| Abrir y cerrar una pestaña dentro de la misma ventana | Aprobado | Aprobado |
| Crear documento offscreen con motivo `CLIPBOARD` | Aprobado | Aprobado |
| Copiar y pegar en el portapapeles real de Windows sin foco | Pendiente | Pendiente |

La prueba reveló que, con zoom de navegador al 125 %, el ancho de metadatos de captura puede ser 820 mientras el ancho CSS es 656. Los eventos de entrada necesitan coordenadas CSS. La integración comprueba ese caso con un objetivo pequeño para detectar errores de escala.

Los resultados completos, con versiones y geometría, se guardan en `tests/browser/.artifacts/api-probe-results.json`. El informe de integración se guarda en `smoke-results.json` en el mismo directorio, junto con capturas sintéticas del visor. Los artefactos no se incluyen en Git.

## Qué cubre la integración

El smoke conecta dos procesos y perfiles independientes usando el servidor real y el JavaScript compilado de la extensión. Redimensiona la ventana nativa para mantener coherencia entre captura y entrada, sin emular sus métricas. Tras cerrar la pestaña capturada, comprueba que la sesión continúe sobre la pestaña anterior. Al terminar, verifica que la extensión ya no pueda enviar comandos por `chrome.debugger`; la conexión CDP de Playwright es independiente.

El servidor de pruebas usa SQLite en memoria y puertos locales temporales. Se configura un respondedor STUN local limitado a Binding, sin soporte de TURN. Las ejecuciones aprobadas usaron candidatos de la misma máquina y no necesitaron solicitudes a ese respondedor. No se contactan servicios públicos por defecto; `GHOSTPAIR_TEST_STUN` permite elegir otro STUN explícitamente. Esto no prueba NAT, el STUN de producción ni conectividad entre dos equipos.

La copia de la extensión usada por el smoke conserva los archivos JavaScript de producción. Sólo su manifiesto temporal añade permiso obligatorio para `http://127.0.0.1/*`, porque el diálogo nativo de permiso opcional requiere interacción que el entorno headless no proporciona. La concesión y revocación de permisos nativos debe verificarse en la prueba manual.

El portapapeles permanece desactivado. Un perfil headless de Windows no garantiza aislamiento del portapapeles del sistema; por ello no se lee, registra ni modifica su contenido. La creación del documento offscreen acredita disponibilidad de la API, no el funcionamiento de copiar/pegar sin foco. Los tests con adaptadores de memoria cubren la lógica de sincronización por separado.

## Comprobaciones pendientes antes de publicar

- En dos PC autorizados, comprobar Chrome↔Chrome, Edge↔Edge y Chrome↔Edge en LAN y redes diferentes; incluir una red que impida la conexión directa y verificar el error después de 30 segundos.
- Verificar los avisos nativos y el distintivo de sesión en el icono, además de los permisos opcionales, su denegación y su revocación.
- Con datos sintéticos en dos portapapeles de prueba, verificar copia bidireccional sin foco, texto Unicode, límite de 256 KiB, cambios simultáneos y ausencia de lecturas después de pausar, desactivar o terminar.
- Verificar arrastre, doble clic, selección, desplazamiento, atajos y composición IME; probar formularios, editores enriquecidos e iframes de otro origen.
- Probar escalado de Windows, minimización, cambios de pantalla, apertura de DevTools, traslado de pestañas fuera de la ventana autorizada y páginas internas no admitidas.
- Ejecutar sesiones de 30 minutos y medir memoria, colas, frecuencia de imágenes y latencia. Objetivos: interacción inferior a 300 ms en LAN y texto sincronizado en hasta 1,5 s. Estos objetivos aún no constituyen mediciones obtenidas.
- Repetir en dos equipos la interrupción de señalización ya validada localmente; cortar el enlace entre equipos y confirmar que se requiere una sesión nueva.

`Page.startScreencast` sigue siendo una API experimental; la aceptación de la extensión y de su uso del depurador corresponde a las tiendas. La evidencia automática local no reemplaza esas pruebas ni la revisión de publicación.
