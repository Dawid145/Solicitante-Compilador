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
            <input type="file" name="archivo" required>
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

  // Recibir archivo
  if (req.method === "POST" && req.url === "/upload") {

    let datos = Buffer.alloc(0);

    req.on("data", (chunk) => {
      datos = Buffer.concat([datos, chunk]);
    });

    req.on("end", () => {

      const contentType = req.headers["content-type"];

      if (!contentType || !contentType.includes("multipart/form-data")) {
        res.writeHead(400, {
          "Content-Type": "text/plain; charset=utf-8"
        });

        res.end("Formato de archivo no válido.");
        return;
      }

      const match = contentType.match(/boundary=(.+)/);

      if (!match) {
        res.writeHead(400, {
          "Content-Type": "text/plain; charset=utf-8"
        });

        res.end("No se encontró el límite del archivo.");
        return;
      }

      const boundary = "--" + match[1];
      const partes = datos.toString("binary").split(boundary);

      for (const parte of partes) {

        if (!parte.includes('name="archivo"')) {
          continue;
        }

        const nombreMatch = parte.match(/filename="([^"]*)"/);

        if (!nombreMatch) {
          continue;
        }

        const nombreArchivo = path.basename(nombreMatch[1]);

        const separacion = parte.indexOf("\r\n\r\n");

        if (separacion === -1) {
          continue;
        }

        let contenido = parte.substring(separacion + 4);

        contenido = contenido.replace(/\r\n--$/, "");
        contenido = contenido.replace(/\r\n$/, "");

        const bufferArchivo = Buffer.from(contenido, "binary");

        const carpeta = path.join(__dirname, "uploads");

        if (!fs.existsSync(carpeta)) {
          fs.mkdirSync(carpeta);
        }

        const rutaArchivo = path.join(carpeta, nombreArchivo);

        fs.writeFileSync(rutaArchivo, bufferArchivo);

        res.writeHead(200, {
          "Content-Type": "text/html; charset=utf-8"
        });

        res.end(`
          <h1>Archivo recibido correctamente</h1>
          <p>Nombre: ${nombreArchivo}</p>
          <p>Tamaño: ${bufferArchivo.length} bytes</p>
          <br>
          <a href="/">Volver</a>
        `);

        return;
      }

      res.writeHead(400, {
        "Content-Type": "text/plain; charset=utf-8"
      });

      res.end("No se pudo encontrar el archivo.");
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
