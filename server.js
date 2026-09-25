const http = require("http");

const PORT = process.env.PORT || 3000;

const server = http.createServer((req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8"
  });

  res.end(`
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="UTF-8">
        <title>Solicitante Compilador</title>
      </head>
      <body>
        <h1>Solicitante Compilador</h1>
        <p>El servidor está funcionando correctamente.</p>
      </body>
    </html>
  `);
});

server.listen(PORT, () => {
  console.log("Servidor iniciado en el puerto " + PORT);
});
