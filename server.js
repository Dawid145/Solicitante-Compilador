const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 3000;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

const server = http.createServer((req, res) => {

  // Página principal
  if (req.method === "GET" && req.url === "/") {
    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8"
    });

    res.end(`
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <title>Solicitante Compilador</title>
        </head>

        <body>
          <h1>Solicitante Compilador</h1>

          <h2>GitHub</h2>

          <p>
            <a href="/github/test">
              <button>Probar conexión con GitHub</button>
            </a>
          </p>

          <hr>

          <h2>Subir un archivo</h2>

          <form action="/upload" method="POST" enctype="multipart/form-data">
            <input
  type="file"
  name="archivo"
  multiple
  webkitdirectory
  directory
>
            <br><br>
            <button type="submit">Enviar archivo</button>
          </form>

        </body>
      </html>
    `);

    return;
  }

  // Comprobar conexión con GitHub
  if (req.method === "GET" && req.url === "/github/test") {

    if (!GITHUB_TOKEN) {
      res.writeHead(500, {
        "Content-Type": "text/plain; charset=utf-8"
      });

      res.end("ERROR: GITHUB_TOKEN no está configurado en Render.");
      return;
    }

    fetch("https://api.github.com/user", {
      headers: {
        "Authorization": `Bearer ${GITHUB_TOKEN}`,
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "Solicitante-Compilador"
      }
    })
    .then(async (respuesta) => {

      const datos = await respuesta.json();

      if (!respuesta.ok) {
        throw new Error(
          datos.message || "GitHub rechazó la solicitud."
        );
      }

      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8"
      });

      res.end(`
        <!DOCTYPE html>
        <html>
          <head>
            <meta charset="UTF-8">
            <title>GitHub conectado</title>
          </head>

          <body>
            <h1>Conexión con GitHub correcta</h1>

            <p>
              Usuario autenticado:
              <strong>${datos.login}</strong>
            </p>

            <p>GitHub respondió correctamente a nuestro servidor.</p>

            <br>

            <a href="/">Volver</a>
          </body>
        </html>
      `);

    })
    .catch((error) => {

      console.error("Error de GitHub:", error);

      res.writeHead(500, {
        "Content-Type": "text/html; charset=utf-8"
      });

      res.end(`
        <h1>Error de conexión con GitHub</h1>
        <p>${error.message}</p>
        <br>
        <a href="/">Volver</a>
      `);
    });

    return;
  }

  // Recibir archivos y conservar carpetas
  if (req.method === "POST" && req.url === "/upload") {

    let datos = Buffer.alloc(0);

    req.on("data", (chunk) => {
      datos = Buffer.concat([datos, chunk]);
    });

    req.on("end", () => {

      try {

        const contentType = req.headers["content-type"];

        if (
          !contentType ||
          !contentType.includes("multipart/form-data")
        ) {
          res.writeHead(400, {
            "Content-Type": "text/plain; charset=utf-8"
          });

          res.end("Formato de archivo no válido.");
          return;
        }

        const match = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/);

        if (!match) {
          res.writeHead(400, {
            "Content-Type": "text/plain; charset=utf-8"
          });

          res.end("No se encontró el límite del formulario.");
          return;
        }

        const boundary = "--" + (match[1] || match[2]);

        /*
         * Convertimos la solicitud en partes.
         * Cada parte representa un archivo.
         */
        const partes = datos.toString("binary").split(boundary);

        const carpetaUploads = path.join(
          __dirname,
          "uploads"
        );

        /*
         * Creamos uploads si todavía no existe.
         */
        if (!fs.existsSync(carpetaUploads)) {
          fs.mkdirSync(carpetaUploads, {
            recursive: true
          });
        }

        const archivosGuardados = [];

        for (const parte of partes) {

          /*
           * Ignoramos partes que no contienen
           * información de archivo.
           */
          if (!parte.includes("filename=")) {
            continue;
          }

          const nombreMatch = parte.match(
            /filename="([^"]*)"/
          );

          if (!nombreMatch) {
            continue;
          }

          let nombreOriginal = nombreMatch[1];

          if (!nombreOriginal) {
            continue;
          }

          /*
           * Los navegadores pueden enviar "\" para
           * separar carpetas en Windows.
           * Lo convertimos a "/".
           */
          nombreOriginal = nombreOriginal.replace(
            /\\/g,
            "/"
          );

          /*
           * Eliminamos posibles barras iniciales.
           */
          nombreOriginal = nombreOriginal.replace(
            /^\/+/,
            ""
          );

          /*
           * Separamos la ruta en carpetas.
           *
           * Ejemplo:
           *
           * MiApp/js/app.js
           *
           * se convierte en:
           *
           * ["MiApp", "js", "app.js"]
           */
          const segmentos = nombreOriginal
            .split("/")
            .filter(segmento =>
              segmento &&
              segmento !== "." &&
              segmento !== ".."
            );

          if (segmentos.length === 0) {
            continue;
          }

          /*
           * Construimos la ruta de forma segura.
           */
          const rutaRelativa = path.join(
            ...segmentos
          );

          const rutaArchivo = path.join(
            carpetaUploads,
            rutaRelativa
          );

          /*
           * Comprobación de seguridad:
           * el archivo debe permanecer dentro
           * de uploads.
           */
          const rutaComprobacion = path.relative(
            carpetaUploads,
            rutaArchivo
          );

          if (
            rutaComprobacion.startsWith("..") ||
            path.isAbsolute(rutaComprobacion)
          ) {
            continue;
          }

          /*
           * Creamos las subcarpetas necesarias.
           *
           * Ejemplo:
           *
           * uploads/MiApp/js/
           */
          fs.mkdirSync(
            path.dirname(rutaArchivo),
            {
              recursive: true
            }
          );

          /*
           * Buscamos dónde terminan los encabezados
           * del archivo.
           */
          const separacion = parte.indexOf(
            "\r\n\r\n"
          );

          if (separacion === -1) {
            continue;
          }

          /*
           * Extraemos el contenido.
           */
          let contenido = parte.substring(
            separacion + 4
          );

          /*
           * Eliminamos los caracteres que agrega
           * multipart al final de cada archivo.
           */
          contenido = contenido.replace(
            /\r\n$/,
            ""
          );

          /*
           * Guardamos el archivo conservando
           * su estructura de carpetas.
           */
          const bufferArchivo = Buffer.from(
            contenido,
            "binary"
          );

          fs.writeFileSync(
            rutaArchivo,
            bufferArchivo
          );

          archivosGuardados.push({
            ruta: rutaRelativa,
            tamaño: bufferArchivo.length
          });
        }

        /*
         * Si no encontramos ningún archivo.
         */
        if (archivosGuardados.length === 0) {

          res.writeHead(400, {
            "Content-Type": "text/html; charset=utf-8"
          });

          res.end(`
            <h1>No se recibieron archivos</h1>

            <p>
              El servidor no encontró archivos
              válidos en la solicitud.
            </p>

            <br>

            <a href="/">Volver</a>
          `);

          return;
        }

        /*
         * Construimos una lista para mostrar
         * exactamente qué recibió el servidor.
         */
        const listaArchivos =
          archivosGuardados
            .map(archivo => `
              <li>
                ${archivo.ruta}
                (${archivo.tamaño} bytes)
              </li>
            `)
            .join("");

        res.writeHead(200, {
          "Content-Type": "text/html; charset=utf-8"
        });

        res.end(`
          <!DOCTYPE html>

          <html>
            <head>
              <meta charset="UTF-8">
              <title>Archivos recibidos</title>
            </head>

            <body>

              <h1>Archivos recibidos correctamente</h1>

              <p>
                Se recibieron
                <strong>
                  ${archivosGuardados.length}
                </strong>
                archivo(s).
              </p>

              <h2>Estructura recibida:</h2>

              <ul>
                ${listaArchivos}
              </ul>

              <p>
                Los archivos fueron guardados
                temporalmente en:
              </p>

              <code>uploads/</code>

              <br><br>

              <a href="/">Volver</a>

            </body>
          </html>
        `);

      } catch (error) {

        console.error(
          "Error procesando archivos:",
          error
        );

        res.writeHead(500, {
          "Content-Type": "text/html; charset=utf-8"
        });

        res.end(`
          <h1>Error procesando archivos</h1>

          <p>
            ${error.message}
          </p>

          <br>

          <a href="/">Volver</a>
        `);
      }
    });

    return;
  }

  // Página inexistente
  res.writeHead(404, {
    "Content-Type": "text/plain; charset=utf-8"
  });

  res.end("Página no encontrada.");
});

server.listen(PORT, () => {
  console.log("Servidor iniciado en el puerto " + PORT);
});
