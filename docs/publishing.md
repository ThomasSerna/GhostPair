# Publicación en Chrome y Edge

## Estado de entrega

El repositorio genera paquetes separados para Chrome Web Store y Edge Add-ons. Generar un ZIP no significa que la extensión se haya publicado o haya sido aprobada. Antes del envío deben completarse las pruebas reales indicadas en `validation.md`, el despliegue y los datos del publicador.

## Preparación

1. Disponer de cuentas de desarrollador de Google y Microsoft, dominio HTTPS y un correo de soporte atendido.
2. Desplegar señalización y STUN. Configurar sus direcciones en `apps/extension/.env.local` antes de `npm run package`.
3. Sustituir los campos del publicador en `docs/privacy.html`. Caddy servirá esa página en `https://DOMINIO/privacy`.
4. Ejecutar `npm ci`, `npm run typecheck`, `npm test`, las pruebas de navegadores y `npm run package`.
5. Registrar las fichas de las extensiones y autorizar sus IDs definitivos en `ALLOWED_ORIGINS`. Probar los paquetes con esos IDs antes del envío final.
6. Cargar `dist/packages/ghostpair-chrome-0.1.0.zip` y `ghostpair-edge-0.1.0.zip` en las cuentas correspondientes. Adjuntar capturas reales, política de privacidad y datos de contacto.
7. Facilitar a los revisores instrucciones de conexión entre dos instalaciones; no incluir una contraseña permanente o una sesión desatendida de producción.

## Ficha propuesta

**Nombre:** GhostPair

**Descripción breve:** Comparte y controla páginas con otra persona mediante una conexión P2P autorizada.

**Descripción:** GhostPair crea un espacio de colaboración entre dos navegadores. Inicia una sesión, elige una contraseña y comparte tu dirección con otra persona. Podrá ver la página activa de la ventana autorizada, hacer clic, escribir y administrar sus pestañas. Puedes pausar, retirar el control o terminar en cualquier momento desde la extensión. Los avisos del navegador permanecen visibles.

La imagen y las interacciones viajan directamente entre los equipos mediante WebRTC. La señalización y STUN ayudan a conectarlos; no existe retransmisión TURN, por lo que algunas redes no serán compatibles. La sincronización opcional del portapapeles comparte cambios de texto de Windows cuando ambos participantes la activan. No incluye audio, archivos ni control del escritorio.

## Justificación de permisos

| Permiso | Uso concreto |
| --- | --- |
| `debugger` | Capturar la página autorizada y aplicar clics/teclado mediante comandos delimitados de CDP. |
| `tabs` | Identificar y administrar las pestañas de la ventana compartida. |
| `storage` | Conservar identidad de instalación y configuración; no historial de navegación ni contraseñas de sesión. |
| `offscreen` | Mantener WebRTC y el adaptador de portapapeles con el menú cerrado. |
| `clipboardRead`, `clipboardWrite` (opcionales) | Sincronizar cambios de texto durante sesiones donde ambos lo habiliten. |
| Acceso al origen de señalización (opcional) | Registrar y autenticar la instalación en el servidor elegido. Se solicita el origen concreto. |

## Declaraciones de datos

Declarar el tratamiento de contenido de páginas, actividad de navegación necesaria para mostrar las pestañas, datos de autenticación e identificadores de instalación. La transmisión P2P también es tratamiento de datos. Describir la sincronización del portapapeles y las direcciones IP que ven los peers y la infraestructura de conexión. No declarar que el producto no trata datos.

Todos los scripts se incluyen en el paquete; no hay JavaScript alojado remotamente, publicidad ni telemetría de contenido. La política y las fichas deben coincidir con la configuración real del operador, incluida retención de logs e identidades.

## Capturas requeridas

- Menú «Compartir» con información y consentimiento, sin datos reales.
- Sesión conectada con dirección de demostración.
- Vista remota sobre la página de pruebas local.
- Controles de pausa, finalización y portapapeles.

Las capturas de prueba headless no sustituyen la revisión de los avisos nativos en Windows. Capturar las imágenes definitivas después de completar la validación manual.

Fuentes oficiales: [Chrome Web Store](https://developer.chrome.com/docs/webstore/publish), [declaración de datos](https://developer.chrome.com/docs/webstore/program-policies/disclosure-requirements), [publicación en Edge](https://learn.microsoft.com/en-us/microsoft-edge/extensions/publish/publish-extension).
