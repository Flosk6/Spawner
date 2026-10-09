import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { NestExpressApplication } from "@nestjs/platform-express";
import connectPgSimple from "connect-pg-simple";
import { config } from "dotenv";
import session from "express-session";
import { join } from "path";
import { Pool } from "pg";
import { AppModule } from "./app.module";
import { securityHeaders } from "./common/frame-headers";
import { withRequestContext } from "./common/request-context";
import { SecretsService } from "./common/secrets.service";
import { SpawnerConfig } from "./common/spawner.config";
import { serveWebApp } from "./web-app";

// The root .env, before anything reads the environment.
config({ path: join(__dirname, "..", "..", "..", ".env") });

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const settings = app.get(SpawnerConfig);
  const secure = settings.scheme === "https";

  // Behind Traefik: the client address and protocol come from X-Forwarded-*.
  app.set("trust proxy", 1);
  app.disable("x-powered-by");
  app.use(withRequestContext);

  // Before the web app: its static files are answered without going further.
  app.use(securityHeaders({ https: secure }));
  serveWebApp(app);

  app.enableCors({ origin: settings.dashboardOrigins, credentials: true });

  const PgSession = connectPgSimple(session);
  app.use(
    session({
      // A __Host- cookie stays on the dashboard host: previews, on sibling
      // hosts of the same site, can neither receive nor overwrite it.
      name: secure ? "__Host-spawner_session" : "spawner_session",
      store: new PgSession({
        pool: new Pool({
          host: process.env.DB_HOST || "localhost",
          port: parseInt(process.env.DB_PORT || "5432", 10),
          user: process.env.DB_USER || "spawner",
          password: process.env.DB_PASSWORD || "spawner",
          database: process.env.DB_NAME || "spawner",
        }),
        tableName: "sessions",
        createTableIfMissing: true,
      }),
      secret: process.env.SESSION_SECRET || app.get(SecretsService).key("session").toString("hex"),
      resave: false,
      saveUninitialized: false,
      cookie: {
        maxAge: parseInt(process.env.SESSION_MAX_AGE || "86400000", 10),
        httpOnly: true,
        secure,
        sameSite: "lax",
        path: "/",
      },
    }),
  );

  // Room for the standard input of a command (1 MiB, sent in base64).
  app.useBodyParser("json", { limit: "2mb" });

  app.setGlobalPrefix("api");
  app.useGlobalPipes(new ValidationPipe({ transform: true }));

  const port = process.env.PORT || 3000;
  await app.listen(port);
  console.log(`Spawner API running on port ${port}`);
}

bootstrap();
