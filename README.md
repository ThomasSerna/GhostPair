# GhostPair

Colaboración autorizada entre dos navegadores: compartir páginas, controlar clics y teclado, administrar pestañas y sincronizar texto del portapapeles. Extensión Manifest V3 para Chrome y Edge en Windows.

El anfitrión inicia cada sesión desde el menú con una contraseña. El visitante introduce su dirección fija y esa contraseña. Imagen, control y portapapeles viajan por WebRTC directamente entre los equipos. El servidor únicamente autentica y coordina la conexión; STUN ayuda a encontrar la ruta. No existe retransmisión TURN ni conexión automática después de reiniciar el navegador.

## Desarrollo

Requisitos: Node.js 24.13 o posterior y npm. En PowerShell, usar `npm.cmd` si la política de ejecución bloquea `npm.ps1`.

```powershell
npm.cmd ci
npm.cmd run build
```

1. Abre `chrome://extensions` o `edge://extensions`, activa el modo de desarrollador y carga `dist/extension` como extensión descomprimida.
2. Copia el identificador que muestra el navegador. Cada instalación/perfil tiene su propia identidad de GhostPair; el ID de la extensión es otro identificador, usado para autorizar al cliente en el servidor.
3. Inicia la señalización con los orígenes exactos autorizados:

```powershell
$env:ALLOWED_ORIGINS = 'chrome-extension://IDENTIFICADOR_DE_LA_EXTENSION'
npm.cmd run dev:server
```

4. En el menú de GhostPair → Configuración, usa `http://127.0.0.1:8787` para pruebas en un mismo equipo. El servidor local necesita autorización para cada ID de extensión que se utilice.
5. En una ventana con una página HTTP/HTTPS, abre GhostPair → Compartir, establece una contraseña de al menos 12 caracteres y confirma el alcance. Comparte la dirección y contraseña por el medio que elijas.
6. En otro perfil aislado o equipo, abre GhostPair → Conectarse. Ambos deben usar el mismo servidor. Para conectar dos PC por internet, despliega primero la señalización HTTPS indicada abajo.

El valor `127.0.0.1` siempre apunta al equipo donde está instalado ese navegador. No sirve como dirección de un servidor que corre en otro PC. HTTP solo se admite en loopback para desarrollo.

```powershell
npm.cmd run dev:extension  # Recompila al editar; recarga la extensión en el navegador.
npm.cmd run typecheck
npm.cmd test
npm.cmd run test:browser
npm.cmd run package
```

Los paquetes se generan en `dist/packages/`. Los ZIP generados con la configuración de desarrollo son para pruebas; antes de presentar en tiendas configura los endpoints de producción y sigue [Publicación](docs/publishing.md).

## Uso

- **Ventana autorizada:** se comparte su página activa y se pueden administrar sus pestañas. No se capturan la barra de direcciones local, otras ventanas ni el escritorio.
- **Control:** clic, doble clic, arrastre, selección, escritura, desplazamiento y navegación. El visitante dispone de una barra y un selector de pestañas propios. Pulsa Escape para liberar el teclado de la vista remota.
- **Estado:** el icono indica que se está compartiendo y los avisos nativos del navegador permanecen visibles. El menú permite pausar, quitar el control o terminar. Atajo predeterminado para detener: `Ctrl+Shift+9`, configurable en los atajos de extensiones.
- **Portapapeles:** desactivado hasta que ambos lo habiliten. Sincroniza cambios de texto copiado en Windows, incluidas otras aplicaciones, cada 500 ms aproximadamente. No transfiere el contenido que ya existía antes de activarlo. Límite: 256 KiB de UTF-8, sin imágenes ni archivos. Puede omitir cambios que ocurran entre dos lecturas.
- **Dirección fija:** pertenece a la instalación/perfil y al servidor configurado; Chrome y Edge pueden tener direcciones diferentes. Borrar los datos de la extensión o desinstalarla elimina sus credenciales.

## Despliegue

Incluye Docker Compose con Node.js, SQLite persistente, Caddy para HTTPS/WSS y coturn en modo exclusivo STUN. Hace falta un dominio con DNS dirigido al servidor y puertos TCP 80/443 y UDP/TCP 3478 accesibles.

```powershell
Copy-Item deploy/.env.example .env
# Edita SIGNAL_DOMAIN y ALLOWED_ORIGINS con los valores reales.
docker compose --env-file .env up -d --build
```

Edita `apps/extension/.env.local` antes de compilar los paquetes públicos:

```dotenv
VITE_SIGNALING_URL=https://connect.tudominio.com
VITE_STUN_URLS=stun:connect.tudominio.com:3478
```

No expongas directamente el puerto 8787 del contenedor. `TRUST_PROXY=true` solo debe usarse detrás del proxy controlado; el servidor recibe de Caddy la IP necesaria para limitar intentos. Haz copias de seguridad del volumen `identities`; perderlo invalida las identidades registradas. Para una copia consistente, detén señalización o usa la API de backup de SQLite.

`GET /health` permite verificar disponibilidad sin contenido de sesiones. El servidor no registra los cuerpos de mensajes ni contraseñas. Supervisa salud del proceso, uso de memoria, espacio en disco y fallos de conexión; no habilites logs de payload en el proxy.

## Límites de esta versión

La captura CDP sigue siendo experimental y los fotogramas JPEG completos consumen más ancho de banda que un códec de vídeo. El objetivo es navegación y trabajo con texto; no streaming multimedia, audio ni DRM. El adaptador de portapapeles usa `execCommand`, mantenido por compatibilidad y deprecado.

No se controlan páginas internas, tiendas de extensiones, archivos locales, incógnito, menús del sistema ni selectores de archivos. Abrir DevTools, minimizar la ventana o retirar el permiso del servidor termina la sesión; se requiere iniciarla de nuevo. Las políticas corporativas pueden impedir captura o control.

Sin TURN, algunas redes no pueden conectar. Tras 30 segundos sin ruta directa se muestra un error. Los peers confían en la señalización para autenticar el emparejamiento: este diseño no protege la identidad del interlocutor frente a un servidor de señalización comprometido.

Consulta la evidencia ejecutada y las pruebas pendientes en [Validación](docs/validation.md), la arquitectura en [Arquitectura](docs/architecture.md) y la preparación para tiendas en [Publicación](docs/publishing.md).
