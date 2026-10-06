const http = require('http');
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const GREETING = 'Hello from Spawner';

async function users() {
  const { rows } = await pool.query('SELECT id, name FROM users ORDER BY id');
  return rows;
}

const server = http.createServer(async (request, response) => {
  try {
    if (request.url === '/health') {
      await pool.query('SELECT 1');
      response.writeHead(200, { 'content-type': 'text/plain' }).end('ok');
      return;
    }
    if (request.url === '/users') {
      response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(await users()));
      return;
    }
    const list = await users();
    response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' }).end(
      `${GREETING} (${process.env.ENV_NAME}) at ${process.env.PUBLIC_URL}: ${list.length} user(s)\n`,
    );
  } catch (error) {
    console.error(error);
    response.writeHead(500, { 'content-type': 'text/plain' }).end('error\n');
  }
});

server.listen(3000, () => console.log('listening on 3000'));
