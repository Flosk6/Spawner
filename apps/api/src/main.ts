import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { config } from 'dotenv';
import { join } from 'path';
import session from 'express-session';
import passport from 'passport';
import connectPgSimple from 'connect-pg-simple';
import { Pool } from 'pg';
import { SessionIoAdapter } from './adapters/session-io.adapter';

// Load .env file from root BEFORE anything else
config({ path: join(__dirname, '..', '..', '..', '.env') });

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

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
      sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
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
