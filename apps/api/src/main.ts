import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { config } from 'dotenv';
import { join, sep } from 'path';
import { existsSync } from 'fs';
import type { Request, Response, NextFunction } from 'express';
import session from 'express-session';
import passport from 'passport';
import connectPgSimple from 'connect-pg-simple';
import { Pool } from 'pg';
import { SessionIoAdapter } from './adapters/session-io.adapter';

// Load .env file from root BEFORE anything else
config({ path: join(__dirname, '..', '..', '..', '.env') });

/**
 * Serves the built web interface from WEB_DIST_PATH, so a single container
 * exposes the API (/api, /socket.io) and the single-page app on one origin.
 * Hashed assets are cached for a year; index.html is never cached, so a new
 * release is picked up on the next page load. Registered before the session
 * middleware so static files never trigger a session store lookup.
 */
function serveWebApp(app: NestExpressApplication) {
  const webDist = process.env.WEB_DIST_PATH;
  if (!webDist) {
    return;
  }

  const indexHtml = join(webDist, 'index.html');
  if (!existsSync(indexHtml)) {
    console.warn(`WEB_DIST_PATH is set but ${indexHtml} is missing, web interface disabled`);
    return;
  }

  const isBackendPath = (path: string) =>
    ['/api', '/socket.io'].some((prefix) => path === prefix || path.startsWith(`${prefix}/`));

  app.useStaticAssets(webDist, {
    index: false,
    setHeaders: (res, filePath) => {
      if (filePath.includes(`${sep}assets${sep}`)) {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      }
    },
  });

  app.use((req: Request, res: Response, next: NextFunction) => {
    if (!['GET', 'HEAD'].includes(req.method) || isBackendPath(req.path)) {
      return next();
    }
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(indexHtml);
  });
}

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // Trust proxy - required for secure cookies behind reverse proxy
  app.getHttpAdapter().getInstance().set('trust proxy', 1);

  serveWebApp(app);

  // CORS configuration with credentials support
  app.enableCors({
    origin: process.env.FRONTEND_URL || 'http://localhost:8080',
    credentials: true,
  });

  // Session configuration with PostgreSQL store
  const PgSession = connectPgSimple(session);

  // Create PostgreSQL connection pool for sessions
  const pgPool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    user: process.env.DB_USER || 'spawner',
    password: process.env.DB_PASSWORD || 'spawner',
    database: process.env.DB_NAME || 'spawner',
  });

  const sessionMiddleware = session({
    store: new PgSession({
      pool: pgPool,
      tableName: 'sessions',
      createTableIfMissing: true, // Auto-create session table
    }),
    secret: process.env.SESSION_SECRET || 'default-secret-change-in-production',
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: parseInt(process.env.SESSION_MAX_AGE || '86400000'), // 24 hours
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax', // Lax works because frontend and API are on same domain
    },
  });

  app.use(sessionMiddleware);

  // Passport initialization
  app.use(passport.initialize());
  app.use(passport.session());

  // Configure Socket.IO adapter to share sessions
  app.useWebSocketAdapter(new SessionIoAdapter(app, sessionMiddleware));

  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ transform: true }));

  const port = process.env.PORT || 3000;
  await app.listen(port);
  console.log(`Spawner API running on port ${port}`);
}

bootstrap();
