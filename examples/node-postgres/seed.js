const { Client } = require('pg');

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  await client.query('CREATE TABLE IF NOT EXISTS users (id serial PRIMARY KEY, name text NOT NULL)');
  await client.query("INSERT INTO users (name) VALUES ('ada')");
  await client.end();
  console.log('seeded 1 user');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
