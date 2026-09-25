const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 3000;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

// Nombre del workflow que queremos ejecutar.
// Podés cambiarlo después desde Render mediante una variable de entorno.
const COMPILER_WORKFLOW =
  process.env.COMPILER_WORKFLOW || "compilar.yml";


// ============================================================
// UTILIDADES
// ============================================================

function responderHTML(res, codigo, html) {
  res.writeHead(codigo, {
    "Content-Type": "text/html; charset=utf-8"
  });

  res.end(html);
}


async function githubRequest(url, opciones = {}) {

  if (!GITHUB_TOKEN) {
    throw new Error(
      "GITHUB_TOKEN no está configurado en Render."
    );
  }

  return fetch(url, {
    ...opciones,

    headers: {
      "Authorization": `Bearer ${GITHUB_TOKEN}`,
      "Accept": "application/vnd.github+json",
      "X-GitHub-Api-Version": "2026-03-10",
      "User-Agent": "Solicitante-Compilador",

      ...(opciones.headers || {})
    }
  });
}


// ============================================================
// OBTENER USUARIO DE GITHUB
// ============================================================

async function obtenerUsuarioGitHub() {

  const respuesta = await githubRequest(
    "https://api.github.com/user"
  );

  const datos = await respuesta.json();

  if (!respuesta.ok) {

    throw new Error(
      datos.message ||
      "No se pudo obtener el usuario de GitHub."
    );
  }

  return datos;
}


// ============================================================
// LIMPIAR NOMBRE DEL REPOSITORIO
// ============================================================

function prepararNombreRepositorio(nombre) {

  let resultado = nombre
    .trim()
    .replace(/\.[^.]+$/, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");

  if (!resultado) {
    resultado = "proyecto";
  }

  return resultado;
}


// ============================================================
// OBTENER NOMBRE DEL PROYECTO
// ============================================================

function obtenerNombreProyecto(archivos) {

  if (archivos.length === 0) {
    return "proyecto";
  }

  const primeraRuta = archivos[0].ruta;

  const segmentos = primeraRuta
    .split("/")
    .filter(Boolean);

  /*
   * Si seleccionamos una carpeta completa:
   *
   * MiApp/index.html
   *
   * usamos:
   *
   * MiApp
   */

  if (segmentos.length > 1) {
    return prepararNombreRepositorio(
      segmentos[0]
    );
  }

  /*
   * Si se seleccionó un archivo individual:
   *
   * app.js
   *
   * usamos:
   *
   * app
   */

  return prepararNombreRepositorio(
    path.basename(
      segmentos[0],
      path.extname(segmentos[0])
    )
  );
}


// ============================================================
// COMPROBAR / CREAR REPOSITORIO
// ============================================================

async function obtenerOCrearRepositorio(
  owner,
  nombreRepositorio
) {

  const url =
    `https://api.github.com/repos/` +
    `${encodeURIComponent(owner)}/` +
    `${encodeURIComponent(nombreRepositorio)}`;

  const comprobar =
    await githubRequest(url);

  /*
   * El repositorio ya existe.
   */

  if (comprobar.status === 200) {

    const repo =
      await comprobar.json();

    return {
      ...repo,
      creadoAhora: false
    };
  }


  /*
   * Si GitHub devuelve algo distinto de 404,
   * existe otro problema.
   */

  if (comprobar.status !== 404) {

    const error =
      await comprobar.json();

    throw new Error(
      error.message ||
      `GitHub respondió ${comprobar.status}.`
    );
  }


  /*
   * No existe.
   *
   * Lo creamos.
   *
   * auto_init = true crea el primer commit
   * y permite trabajar inmediatamente sobre
   * la rama principal.
   */

  const crear =
    await githubRequest(
      "https://api.github.com/user/repos",
      {
        method: "POST",

        headers: {
          "Content-Type":
            "application/json"
        },

        body: JSON.stringify({
          name: nombreRepositorio,

          private: true,

          description:
            "Proyecto administrado por Solicitante-Compilador",

          auto_init: true
        })
      }
    );

  const datos =
    await crear.json();

  if (!crear.ok) {

    throw new Error(
      datos.message ||
      "GitHub no permitió crear el repositorio."
    );
  }

  return {
    ...datos,
    creadoAhora: true
  };
}


// ============================================================
// SUBIR UN ARCHIVO A GITHUB
// ============================================================

async function subirArchivoGitHub(
  owner,
  repo,
  ruta,
  contenido,
  branch
) {

  const rutaGitHub =
    ruta
      .split(path.sep)
      .join("/");

  const url =
    `https://api.github.com/repos/` +
    `${encodeURIComponent(owner)}/` +
    `${encodeURIComponent(repo)}/contents/` +
    `${rutaGitHub
      .split("/")
      .map(encodeURIComponent)
      .join("/")}`;


  /*
   * Convertimos el archivo a Base64,
   * que es el formato requerido por
   * este endpoint de GitHub.
   */

  const contenidoBase64 =
    contenido.toString("base64");


  /*
   * Comprobamos si el archivo ya existe.
   *
   * Si existe necesitamos su SHA para
   * actualizarlo.
   */

  let sha = undefined;

  const comprobar =
    await githubRequest(
      `${url}?ref=${encodeURIComponent(branch)}`
    );


  if (comprobar.status === 200) {

    const existente =
      await comprobar.json();

    sha = existente.sha;
  }


  const cuerpo = {
    message:
      `Actualizar ${rutaGitHub}`,

    content:
      contenidoBase64,

    branch
  };


  if (sha) {
    cuerpo.sha = sha;
  }


  const respuesta =
    await githubRequest(
      url,
      {
        method: "PUT",

        headers: {
          "Content-Type":
            "application/json"
        },

        body:
          JSON.stringify(cuerpo)
      }
    );


  const datos =
    await respuesta.json();


  if (!respuesta.ok) {

    throw new Error(
      datos.message ||
      `No se pudo subir ${rutaGitHub}.`
    );
  }


  return datos;
}


// ============================================================
// EJECUTAR GITHUB ACTION
// ============================================================
// ============================================================
// CREAR WORKFLOW AUTOMÁTICAMENTE
// ============================================================

async function crearWorkflowCompilador(
  owner,
  repo,
  branch
) {

  const rutaWorkflow =
    ".github/workflows/compilar.yml";


  const workflow = `name: Compilar proyecto

on:
  workflow_dispatch:

jobs:
  preparar:
    runs-on: ubuntu-latest

    steps:

      - name: Descargar proyecto
        uses: actions/checkout@v4

      - name: Mostrar archivos recibidos
        run: |
          echo "================================"
          echo "SOLICITANTE-COMPILADOR"
          echo "================================"
          echo "Proyecto recibido correctamente."
          echo ""
          echo "Archivos del proyecto:"
          find . -maxdepth 5 -type f \\
            ! -path "./.git/*"
          echo ""
          echo "================================"

      - name: Crear resultado de prueba
        run: |
          echo "Compilación de prueba ejecutada correctamente." > resultado.txt
          echo "Repositorio: $GITHUB_REPOSITORY" >> resultado.txt
          echo "Commit: $GITHUB_SHA" >> resultado.txt

      - name: Guardar resultado
        uses: actions/upload-artifact@v4
        with:
          name: resultado-compilacion
          path: resultado.txt
          retention-days: 7
`;


  const contenido =
    Buffer.from(workflow)
      .toString("base64");


  const url =
    \`https://api.github.com/repos/\` +
    \`\${encodeURIComponent(owner)}/\` +
    \`\${encodeURIComponent(repo)}/contents/\` +
    \`.github/workflows/compilar.yml\`;


  /*
   * Comprobamos si el workflow ya existe.
   */

  const comprobar =
    await githubRequest(
      \`\${url}?ref=\${encodeURIComponent(branch)}\`
    );


  let sha;


  if (comprobar.status === 200) {

    const existente =
      await comprobar.json();

    sha = existente.sha;
  }


  const cuerpo = {

    message:
      "Configurar workflow del compilador",

    content:
      contenido,

    branch
  };


  /*
   * Si ya existe, GitHub exige su SHA
   * para actualizarlo.
   */

  if (sha) {
    cuerpo.sha = sha;
  }


  const respuesta =
    await githubRequest(
      url,
      {
        method: "PUT",

        headers: {
          "Content-Type":
            "application/json"
        },

        body:
          JSON.stringify(cuerpo)
      }
    );


  const datos =
    await respuesta.json();


  if (!respuesta.ok) {

    if (
      respuesta.status === 403
    ) {

      throw new Error(
        "GitHub rechazó la creación del workflow. " +
        "El PAT probablemente necesita el alcance " +
        "'workflow'."
      );
    }


    throw new Error(
      datos.message ||
      "No se pudo crear compilar.yml."
    );
  }


  return datos;
}
async function ejecutarAction(
  owner,
  repo,
  workflow,
  branch
) {

  const url =
    `https://api.github.com/repos/` +
    `${encodeURIComponent(owner)}/` +
    `${encodeURIComponent(repo)}/` +
    `actions/workflows/` +
    `${encodeURIComponent(workflow)}/dispatches`;


  const respuesta =
    await githubRequest(
      url,
      {
        method: "POST",

        headers: {
          "Content-Type":
            "application/json"
        },

        body: JSON.stringify({
          ref: branch
        })
      }
    );


  /*
   * GitHub responde 204 cuando el dispatch
   * fue aceptado.
   */

  if (respuesta.status === 204) {

    return {
      ejecutada: true
    };
  }


  const datos =
    await respuesta.json()
      .catch(() => ({}));


  /*
   * No hacemos fallar toda la subida si
   * todavía no existe la Action.
   */

  return {
    ejecutada: false,

    mensaje:
      datos.message ||
      `GitHub respondió ${respuesta.status}.`
  };
}


// ============================================================
// PÁGINA PRINCIPAL
// ============================================================

const server = http.createServer(
  async (req, res) => {

    // ========================================================
    // INICIO
    // ========================================================

    if (
      req.method === "GET" &&
      req.url === "/"
    ) {

      return responderHTML(
        res,
        200,
        `
        <!DOCTYPE html>

        <html>

          <head>

            <meta charset="UTF-8">

            <meta
              name="viewport"
              content="width=device-width, initial-scale=1"
            >

            <title>
              Solicitante Compilador
            </title>

          </head>


          <body>

            <h1>
              Solicitante Compilador
            </h1>


            <h2>
              GitHub
            </h2>


            <p>

              <a href="/github/test">

                <button>
                  Probar conexión con GitHub
                </button>

              </a>

            </p>


            <hr>


            <h2>
              Subir proyecto
            </h2>


            <p>
              Podés seleccionar archivos o
              una carpeta completa.
            </p>


            <form
              action="/upload"
              method="POST"
              enctype="multipart/form-data"
            >

              <input
                type="file"
                name="archivo"
                multiple
                webkitdirectory
                directory
              >


              <br><br>


              <button type="submit">
                Enviar proyecto
              </button>

            </form>

          </body>

        </html>
        `
      );
    }


    // ========================================================
    // PROBAR GITHUB
    // ========================================================

    if (
      req.method === "GET" &&
      req.url === "/github/test"
    ) {

      try {

        const usuario =
          await obtenerUsuarioGitHub();


        return responderHTML(
          res,
          200,
          `
          <h1>
            Conexión con GitHub correcta
          </h1>

          <p>
            Usuario autenticado:
            <strong>
              ${usuario.login}
            </strong>
          </p>

          <p>
            GitHub respondió correctamente.
          </p>

          <br>

          <a href="/">
            Volver
          </a>
          `
        );

      } catch (error) {

        return responderHTML(
          res,
          500,
          `
          <h1>
            Error de conexión con GitHub
          </h1>

          <p>
            ${error.message}
          </p>

          <br>

          <a href="/">
            Volver
          </a>
          `
        );
      }
    }


    // ========================================================
    // RECIBIR Y ENVIAR PROYECTO
    // ========================================================

    if (
      req.method === "POST" &&
      req.url === "/upload"
    ) {

      const chunks = [];


      req.on(
        "data",
        chunk => {
          chunks.push(chunk);
        }
      );


      req.on(
        "end",
        async () => {

          try {

            const datos =
              Buffer.concat(chunks);


            const contentType =
              req.headers["content-type"];


            if (
              !contentType ||
              !contentType.includes(
                "multipart/form-data"
              )
            ) {

              return responderHTML(
                res,
                400,
                `
                <h1>
                  Error
                </h1>

                <p>
                  La solicitud no contiene
                  archivos válidos.
                </p>

                <a href="/">
                  Volver
                </a>
                `
              );
            }


            /*
             * Obtener boundary.
             */

            const match =
              contentType.match(
                /boundary=(?:"([^"]+)"|([^;]+))/
              );


            if (!match) {

              return responderHTML(
                res,
                400,
                `
                <h1>
                  Error
                </h1>

                <p>
                  No se encontró el límite
                  del formulario.
                </p>

                <a href="/">
                  Volver
                </a>
                `
              );
            }


            const boundary =
              Buffer.from(
                "--" +
                (match[1] || match[2])
              );


            /*
             * Separar las partes multipart.
             */

            const partes = [];

            let posicion = 0;


            while (true) {

              const encontrada =
                datos.indexOf(
                  boundary,
                  posicion
                );


              if (encontrada === -1) {
                break;
              }


              partes.push(
                datos.slice(
                  posicion,
                  encontrada
                )
              );


              posicion =
                encontrada +
                boundary.length;
            }


            /*
             * Carpeta temporal.
             */

            const carpetaUploads =
              path.join(
                __dirname,
                "uploads"
              );


            fs.mkdirSync(
              carpetaUploads,
              {
                recursive: true
              }
            );


            const archivos = [];


            // =================================================
            // PROCESAR ARCHIVOS
            // =================================================

            for (
              const parte of partes
            ) {

              const encabezadoFin =
                parte.indexOf(
                  Buffer.from(
                    "\r\n\r\n"
                  )
                );


              if (
                encabezadoFin === -1
              ) {
                continue;
              }


              const encabezados =
                parte
                  .slice(
                    0,
                    encabezadoFin
                  )
                  .toString();


              if (
                !encabezados.includes(
                  'name="archivo"'
                )
              ) {
                continue;
              }


              const nombreMatch =
                encabezados.match(
                  /filename="([^"]*)"/
                );


              if (!nombreMatch) {
                continue;
              }


              let nombre =
                nombreMatch[1];


              if (!nombre) {
                continue;
              }


              /*
               * Normalizar separadores.
               */

              nombre =
                nombre.replace(
                  /\\/g,
                  "/"
                );


              nombre =
                nombre.replace(
                  /^\/+/,
                  ""
                );


              /*
               * Evitar rutas peligrosas.
               */

              const segmentos =
                nombre
                  .split("/")
                  .filter(
                    segmento =>
                      segmento &&
                      segmento !== "." &&
                      segmento !== ".."
                  );


              if (
                segmentos.length === 0
              ) {
                continue;
              }


              const rutaRelativa =
                segmentos.join("/");


              const rutaLocal =
                path.join(
                  carpetaUploads,
                  ...segmentos
                );


              /*
               * Seguridad:
               * impedir salir de uploads.
               */

              const comprobacion =
                path.relative(
                  carpetaUploads,
                  rutaLocal
                );


              if (
                comprobacion.startsWith(
                  ".."
                ) ||
                path.isAbsolute(
                  comprobacion
                )
              ) {
                continue;
              }


              /*
               * Extraer contenido.
               */

              let contenido =
                parte.slice(
                  encabezadoFin + 4
                );


              /*
               * Quitar CRLF final.
               */

              if (
                contenido.length >= 2 &&
                contenido
                  .slice(-2)
                  .toString() ===
                    "\r\n"
              ) {

                contenido =
                  contenido.slice(
                    0,
                    -2
                  );
              }


              /*
               * Crear carpetas.
               */

              fs.mkdirSync(
                path.dirname(
                  rutaLocal
                ),
                {
                  recursive: true
                }
              );


              /*
               * Guardar temporalmente.
               */

              fs.writeFileSync(
                rutaLocal,
                contenido
              );


              archivos.push({
                ruta:
                  rutaRelativa,

                local:
                  rutaLocal,

                contenido:
                  contenido
              });
            }


            if (
              archivos.length === 0
            ) {

              return responderHTML(
                res,
                400,
                `
                <h1>
                  No se recibieron archivos
                </h1>

                <p>
                  No encontramos archivos
                  válidos.
                </p>

                <a href="/">
                  Volver
                </a>
                `
              );
            }


            // =================================================
            // OBTENER NOMBRE DEL PROYECTO
            // =================================================

            const nombreRepositorio =
              obtenerNombreProyecto(
                archivos
              );


            // =================================================
            // USUARIO GITHUB
            // =================================================

            const usuario =
              await obtenerUsuarioGitHub();


            const owner =
              usuario.login;


            // =================================================
            // CREAR / REUTILIZAR REPOSITORIO
            // =================================================

            const repositorio =
              await obtenerOCrearRepositorio(
                owner,
                nombreRepositorio
              );


            const branch =
              repositorio.default_branch ||
              "main";
            // =================================================
// CREAR / ACTUALIZAR WORKFLOW
// =================================================

await crearWorkflowCompilador(
  owner,
  repositorio.name,
  branch
);

            // =================================================
            // SUBIR ARCHIVOS
            // =================================================

            const resultados = [];


            /*
             * IMPORTANTE:
             *
             * Los archivos se suben uno por uno,
             * no simultáneamente.
             */

            for (
              const archivo of archivos
            ) {

              const resultado =
                await subirArchivoGitHub(
                  owner,

                  repositorio.name,

                  archivo.ruta,

                  archivo.contenido,

                  branch
                );


              resultados.push(
                resultado
              );
            }


            // =================================================
            // EJECUTAR ACTION
            // =================================================

            const action =
              await ejecutarAction(
                owner,

                repositorio.name,

                COMPILER_WORKFLOW,

                branch
              );


            // =================================================
            // LIMPIAR TEMPORAL
            // =================================================

            /*
             * Solo eliminamos uploads DESPUÉS
             * de terminar el envío a GitHub.
             *
             * Esto NO toca el archivo original
             * del móvil o PC.
             */

            fs.rmSync(
              carpetaUploads,
              {
                recursive: true,
                force: true
              }
            );


            // =================================================
            // RESULTADO
            // =================================================

            return responderHTML(
              res,
              200,
              `
              <!DOCTYPE html>

              <html>

                <head>

                  <meta charset="UTF-8">

                  <title>
                    Proyecto enviado
                  </title>

                </head>


                <body>

                  <h1>
                    Proyecto enviado correctamente
                  </h1>


                  <p>

                    Repositorio:

                    <strong>
                      ${repositorio.full_name}
                    </strong>

                  </p>


                  <p>

                    Archivos enviados:

                    <strong>
                      ${archivos.length}
                    </strong>

                  </p>


                  <p>

                    Repositorio:

                    ${
                      repositorio.creadoAhora
                        ? "creado ahora"
                        : "ya existía"
                    }

                  </p>


                  <p>

                    GitHub Action:

                    <strong>

                      ${
                        action.ejecutada
                          ? "solicitada correctamente"
                          : "no ejecutada todavía"
                      }

                    </strong>

                  </p>


                  ${
                    !action.ejecutada
                      ? `
                        <p>
                          Motivo:
                          ${action.mensaje}
                        </p>

                        <p>
                          Revisá que exista el workflow
                          <strong>
                            ${COMPILER_WORKFLOW}
                          </strong>
                          y que acepte
                          <code>workflow_dispatch</code>.
                        </p>
                      `
                      : ""
                  }


                  <p>

                    <a
                      href="${repositorio.html_url}"
                      target="_blank"
                    >
                      Abrir repositorio
                    </a>

                  </p>


                  <br>


                  <a href="/">
                    Volver
                  </a>

                </body>

              </html>
              `
            );


          } catch (error) {

            console.error(
              "Error procesando proyecto:",
              error
            );


            return responderHTML(
              res,
              500,
              `
              <h1>
                Error procesando el proyecto
              </h1>

              <p>
                ${error.message}
              </p>

              <p>
                Los archivos originales
                de tu dispositivo
                <strong>
                  no fueron eliminados
                </strong>.
              </p>

              <br>

              <a href="/">
                Volver
              </a>
              `
            );
          }
        }
      );


      return;
    }


    // ========================================================
    // 404
    // ========================================================

    responderHTML(
      res,
      404,
      `
      <h1>
        404
      </h1>

      <p>
        Página no encontrada.
      </p>

      <a href="/">
        Volver
      </a>
      `
    );

  }
);


// ============================================================
// SERVIDOR
// ============================================================

server.listen(
  PORT,
  () => {

    console.log(
      "Servidor iniciado en el puerto " +
      PORT
    );

  }
);
