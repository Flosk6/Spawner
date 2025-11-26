# OAuth GitHub Authentication Implementation Plan

## Overview

This plan implements OAuth2 GitHub authentication for Spawner with team-based access control. Only members of the "Developer" team in the "Iris-Prevention" organization will be able to access Spawner.

## GitHub OAuth App Setup

### Development App
- **Application name:** Spawner Development
- **Homepage URL:** `http://localhost:8001`
- **Authorization callback URL:** `http://localhost:8001/api/auth/github/callback`
- **Organization:** Iris-Prevention (recommended for team access)

### Production App
- **Application name:** Spawner Production
- **Homepage URL:** `https://spawner.irisprevention.fr`
- **Authorization callback URL:** `https://spawner.irisprevention.fr/api/auth/github/callback`
- **Organization:** Iris-Prevention

**Important:** Save the Client ID and Client Secret for each app. These will be used in environment variables.

## Backend Implementation (NestJS)

### 1. Install Dependencies

```bash
cd backend
npm install @nestjs/passport passport passport-github2 express-session @types/express-session @types/passport-github2 @octokit/rest connect-sqlite3
```

### 2. Environment Variables

Add to `backend/.env`:

```env
# GitHub OAuth (use different values for dev/prod)
GITHUB_CLIENT_ID=your_github_client_id
GITHUB_CLIENT_SECRET=your_github_client_secret
GITHUB_CALLBACK_URL=http://localhost:8001/api/auth/github/callback
GITHUB_ORG=Iris-Prevention
GITHUB_TEAM=Developer

# Session
SESSION_SECRET=generate_a_random_secret_here_min_32_chars
SESSION_MAX_AGE=86400000

# Frontend URL for redirects
FRONTEND_URL=http://localhost:8001
```

For production, update with production values.

### 3. Database Entities

#### `backend/src/auth/entities/user.entity.ts`

```typescript
import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn, OneToMany } from 'typeorm';
import { AuditLog } from './audit-log.entity';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ unique: true })
  githubId: string;

  @Column()
  username: string;

  @Column({ nullable: true })
  email: string;

  @Column({ nullable: true })
  avatarUrl: string;

  @Column({ default: true })
  isActive: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @Column({ type: 'datetime', nullable: true })
  lastLoginAt: Date;

  @OneToMany(() => AuditLog, (auditLog) => auditLog.user)
  auditLogs: AuditLog[];
}
```

#### `backend/src/auth/entities/audit-log.entity.ts`

```typescript
import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { User } from './user.entity';

@Entity('audit_logs')
export class AuditLog {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => User, (user) => user.auditLogs, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column({ nullable: true })
  userId: number;

  @Column()
  action: string; // e.g., 'LOGIN', 'LOGOUT', 'CREATE_ENV', 'DELETE_ENV'

  @Column({ type: 'text', nullable: true })
  details: string; // JSON string with additional context

  @Column({ nullable: true })
  ipAddress: string;

  @Column({ nullable: true })
  userAgent: string;

  @CreateDateColumn()
  createdAt: Date;
}
```

### 4. GitHub Strategy

#### `backend/src/auth/strategies/github.strategy.ts`

```typescript
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, Profile } from 'passport-github2';
import { ConfigService } from '@nestjs/config';
import { AuthService } from '../auth.service';

@Injectable()
export class GithubStrategy extends PassportStrategy(Strategy, 'github') {
  constructor(
    private configService: ConfigService,
    private authService: AuthService,
  ) {
    super({
      clientID: configService.get('GITHUB_CLIENT_ID'),
      clientSecret: configService.get('GITHUB_CLIENT_SECRET'),
      callbackURL: configService.get('GITHUB_CALLBACK_URL'),
      scope: ['user:email', 'read:org'],
    });
  }

  async validate(accessToken: string, refreshToken: string, profile: Profile) {
    const { id, username, emails, photos } = profile;

    // Verify team membership
    const org = this.configService.get('GITHUB_ORG');
    const team = this.configService.get('GITHUB_TEAM');

    const isMember = await this.authService.verifyTeamMembership(
      accessToken,
      org,
      team,
      username,
    );

    if (!isMember) {
      throw new UnauthorizedException(
        `Access denied. You must be a member of the ${team} team in ${org} organization.`,
      );
    }

    // Find or create user
    const user = await this.authService.findOrCreateUser({
      githubId: id,
      username,
      email: emails?.[0]?.value,
      avatarUrl: photos?.[0]?.value,
    });

    return user;
  }
}
```

### 5. Session Serialization

#### `backend/src/auth/serialization/session.serializer.ts`

```typescript
import { Injectable } from '@nestjs/common';
import { PassportSerializer } from '@nestjs/passport';
import { User } from '../entities/user.entity';
import { AuthService } from '../auth.service';

@Injectable()
export class SessionSerializer extends PassportSerializer {
  constructor(private authService: AuthService) {
    super();
  }

  serializeUser(user: User, done: (err: Error, user: { id: number }) => void) {
    done(null, { id: user.id });
  }

  async deserializeUser(
    payload: { id: number },
    done: (err: Error, user: User) => void,
  ) {
    const user = await this.authService.findUserById(payload.id);
    done(null, user);
  }
}
```

### 6. Auth Service

#### `backend/src/auth/auth.service.ts`

```typescript
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Octokit } from '@octokit/rest';
import { User } from './entities/user.entity';
import { AuditLog } from './entities/audit-log.entity';

interface CreateUserDto {
  githubId: string;
  username: string;
  email?: string;
  avatarUrl?: string;
}

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User)
    private userRepository: Repository<User>,
    @InjectRepository(AuditLog)
    private auditLogRepository: Repository<AuditLog>,
  ) {}

  async verifyTeamMembership(
    accessToken: string,
    org: string,
    team: string,
    username: string,
  ): Promise<boolean> {
    try {
      const octokit = new Octokit({ auth: accessToken });

      // Get team by name
      const { data: teamData } = await octokit.teams.getByName({
        org,
        team_slug: team.toLowerCase(),
      });

      // Check if user is a member of the team
      const { status } = await octokit.teams.getMembershipForUserInOrg({
        org,
        team_slug: team.toLowerCase(),
        username,
      });

      return status === 200;
    } catch (error) {
      console.error('Error verifying team membership:', error);
      return false;
    }
  }

  async findOrCreateUser(data: CreateUserDto): Promise<User> {
    let user = await this.userRepository.findOne({
      where: { githubId: data.githubId },
    });

    if (!user) {
      user = this.userRepository.create(data);
    } else {
      // Update user info
      user.username = data.username;
      user.email = data.email;
      user.avatarUrl = data.avatarUrl;
    }

    user.lastLoginAt = new Date();
    return await this.userRepository.save(user);
  }

  async findUserById(id: number): Promise<User> {
    const user = await this.userRepository.findOne({ where: { id } });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return user;
  }

  async logAction(
    userId: number,
    action: string,
    details: any,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<void> {
    const auditLog = this.auditLogRepository.create({
      userId,
      action,
      details: JSON.stringify(details),
      ipAddress,
      userAgent,
    });
    await this.auditLogRepository.save(auditLog);
  }
}
```

### 7. Auth Guards

#### `backend/src/auth/guards/session-auth.guard.ts`

```typescript
import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';

@Injectable()
export class SessionAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    return request.isAuthenticated();
  }
}
```

### 8. Auth Controller

#### `backend/src/auth/auth.controller.ts`

```typescript
import { Controller, Get, Req, Res, UseGuards, UnauthorizedException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Request, Response } from 'express';
import { ConfigService } from '@nestjs/config';
import { SessionAuthGuard } from './guards/session-auth.guard';
import { AuthService } from './auth.service';
import { User } from './entities/user.entity';

@Controller('auth')
export class AuthController {
  constructor(
    private configService: ConfigService,
    private authService: AuthService,
  ) {}

  @Get('github')
  @UseGuards(AuthGuard('github'))
  githubLogin() {
    // Initiates GitHub OAuth flow
  }

  @Get('github/callback')
  @UseGuards(AuthGuard('github'))
  async githubCallback(@Req() req: Request, @Res() res: Response) {
    const user = req.user as User;

    // Log login action
    await this.authService.logAction(
      user.id,
      'LOGIN',
      { method: 'github', username: user.username },
      req.ip,
      req.headers['user-agent'],
    );

    // Redirect to frontend
    const frontendUrl = this.configService.get('FRONTEND_URL');
    res.redirect(frontendUrl);
  }

  @Get('logout')
  @UseGuards(SessionAuthGuard)
  async logout(@Req() req: Request, @Res() res: Response) {
    const user = req.user as User;

    // Log logout action
    await this.authService.logAction(
      user.id,
      'LOGOUT',
      { username: user.username },
      req.ip,
      req.headers['user-agent'],
    );

    req.logout((err) => {
      if (err) {
        return res.status(500).json({ error: 'Logout failed' });
      }
      req.session.destroy((err) => {
        if (err) {
          return res.status(500).json({ error: 'Session destroy failed' });
        }
        res.clearCookie('connect.sid');
        const frontendUrl = this.configService.get('FRONTEND_URL');
        res.redirect(`${frontendUrl}/login`);
      });
    });
  }

  @Get('me')
  @UseGuards(SessionAuthGuard)
  getMe(@Req() req: Request) {
    return req.user;
  }

  @Get('status')
  getStatus(@Req() req: Request) {
    return {
      authenticated: req.isAuthenticated(),
      user: req.user || null,
    };
  }
}
```

### 9. Auth Module

#### `backend/src/auth/auth.module.ts`

```typescript
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule } from '@nestjs/config';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { GithubStrategy } from './strategies/github.strategy';
import { SessionSerializer } from './serialization/session.serializer';
import { User } from './entities/user.entity';
import { AuditLog } from './entities/audit-log.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, AuditLog]),
    PassportModule.register({ session: true }),
    ConfigModule,
  ],
  controllers: [AuthController],
  providers: [AuthService, GithubStrategy, SessionSerializer],
  exports: [AuthService],
})
export class AuthModule {}
```

### 10. Main Application Configuration

#### `backend/src/main.ts`

Add session middleware before app initialization:

```typescript
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import * as session from 'express-session';
import * as passport from 'passport';
import * as SQLiteStore from 'connect-sqlite3';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // CORS configuration
  app.enableCors({
    origin: process.env.FRONTEND_URL || 'http://localhost:8001',
    credentials: true,
  });

  // Session configuration
  const SQLiteStoreSession = SQLiteStore(session);
  app.use(
    session({
      store: new SQLiteStoreSession({
        db: 'sessions.db',
        dir: './data',
      }),
      secret: process.env.SESSION_SECRET,
      resave: false,
      saveUninitialized: false,
      cookie: {
        maxAge: parseInt(process.env.SESSION_MAX_AGE || '86400000'),
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
      },
    }),
  );

  // Passport initialization
  app.use(passport.initialize());
  app.use(passport.session());

  app.setGlobalPrefix('api');
  await app.listen(3001);
}
bootstrap();
```

### 11. Protect Existing Routes

Add `@UseGuards(SessionAuthGuard)` to all controllers that need authentication:

```typescript
import { Controller, Get, UseGuards } from '@nestjs/common';
import { SessionAuthGuard } from './auth/guards/session-auth.guard';

@Controller('environments')
@UseGuards(SessionAuthGuard)
export class EnvironmentsController {
  // All routes now require authentication
}
```

Apply to:
- `EnvironmentsController`
- `ProjectController`
- `GitController`

### 12. Add User Context to Audit Logs

Update controllers to log user actions:

```typescript
@Delete(':id')
async deleteEnvironment(@Param('id') id: string, @Req() req: Request) {
  const user = req.user as User;
  const environment = await this.environmentsService.deleteEnvironment(parseInt(id));

  await this.authService.logAction(
    user.id,
    'DELETE_ENVIRONMENT',
    { environmentId: id, environmentName: environment.name },
    req.ip,
    req.headers['user-agent'],
  );

  return environment;
}
```

## Frontend Implementation (Vue.js)

### 1. Create Auth Store

#### `frontend/src/stores/auth.ts`

```typescript
import { defineStore } from 'pinia';
import { ref, computed } from 'vue';

interface User {
  id: number;
  githubId: string;
  username: string;
  email?: string;
  avatarUrl?: string;
  lastLoginAt: string;
}

export const useAuthStore = defineStore('auth', () => {
  const user = ref<User | null>(null);
  const loading = ref(false);
  const error = ref<string | null>(null);

  const isAuthenticated = computed(() => user.value !== null);

  async function checkAuth() {
    loading.value = true;
    error.value = null;
    try {
      const response = await fetch('http://localhost:3001/api/auth/status', {
        credentials: 'include',
      });
      const data = await response.json();
      if (data.authenticated && data.user) {
        user.value = data.user;
      } else {
        user.value = null;
      }
    } catch (e) {
      console.error('Auth check failed:', e);
      error.value = 'Failed to check authentication status';
      user.value = null;
    } finally {
      loading.value = false;
    }
  }

  async function logout() {
    loading.value = true;
    error.value = null;
    try {
      await fetch('http://localhost:3001/api/auth/logout', {
        credentials: 'include',
      });
      user.value = null;
      window.location.href = '/login';
    } catch (e) {
      console.error('Logout failed:', e);
      error.value = 'Failed to logout';
    } finally {
      loading.value = false;
    }
  }

  function loginWithGithub() {
    window.location.href = 'http://localhost:3001/api/auth/github';
  }

  return {
    user,
    loading,
    error,
    isAuthenticated,
    checkAuth,
    logout,
    loginWithGithub,
  };
});
```

### 2. Create Login Page

#### `frontend/src/views/Login.vue`

```vue
<template>
  <div class="min-h-screen bg-gray-900 flex items-center justify-center px-4">
    <div class="max-w-md w-full space-y-8">
      <div class="text-center">
        <h1 class="text-4xl font-bold text-white mb-2">Spawner</h1>
        <p class="text-gray-400">Preview Environment Manager</p>
      </div>

      <div class="bg-gray-800 rounded-lg shadow-xl p-8">
        <div v-if="error" class="mb-4 p-4 bg-red-500/10 border border-red-500 rounded-lg">
          <p class="text-red-500 text-sm">{{ error }}</p>
        </div>

        <button
          @click="handleLogin"
          :disabled="loading"
          class="w-full flex items-center justify-center gap-3 bg-gray-700 hover:bg-gray-600
                 text-white font-medium py-3 px-4 rounded-lg transition-colors disabled:opacity-50
                 disabled:cursor-not-allowed"
        >
          <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
            <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
          </svg>
          <span v-if="!loading">Login with GitHub</span>
          <span v-else>Logging in...</span>
        </button>

        <div class="mt-6 text-center">
          <p class="text-gray-400 text-sm">
            Access restricted to members of the<br>
            <span class="font-medium text-white">Developer</span> team in
            <span class="font-medium text-white">Iris-Prevention</span>
          </p>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useAuthStore } from '@/stores/auth';

const route = useRoute();
const router = useRouter();
const authStore = useAuthStore();

const loading = ref(false);
const error = ref<string | null>(null);

onMounted(async () => {
  // Check if user is already authenticated
  await authStore.checkAuth();
  if (authStore.isAuthenticated) {
    router.push('/');
  }

  // Check for error in URL query params
  if (route.query.error) {
    error.value = decodeURIComponent(route.query.error as string);
  }
});

function handleLogin() {
  loading.value = true;
  authStore.loginWithGithub();
}
</script>
```

### 3. Create User Menu Component

#### `frontend/src/components/UserMenu.vue`

```vue
<template>
  <div class="relative" ref="menuRef">
    <button
      @click="isOpen = !isOpen"
      class="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-gray-700 transition-colors"
    >
      <img
        v-if="user.avatarUrl"
        :src="user.avatarUrl"
        :alt="user.username"
        class="w-8 h-8 rounded-full"
      />
      <div v-else class="w-8 h-8 rounded-full bg-gray-600 flex items-center justify-center">
        <span class="text-white font-medium">{{ user.username[0].toUpperCase() }}</span>
      </div>
      <span class="text-white font-medium">{{ user.username }}</span>
      <svg
        class="w-4 h-4 text-gray-400 transition-transform"
        :class="{ 'rotate-180': isOpen }"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
      </svg>
    </button>

    <div
      v-if="isOpen"
      class="absolute right-0 mt-2 w-48 bg-gray-800 rounded-lg shadow-xl border border-gray-700 py-1 z-50"
    >
      <div class="px-4 py-2 border-b border-gray-700">
        <p class="text-sm text-gray-400">Signed in as</p>
        <p class="text-sm font-medium text-white truncate">{{ user.username }}</p>
      </div>
      <button
        @click="handleLogout"
        class="w-full text-left px-4 py-2 text-sm text-gray-300 hover:bg-gray-700 transition-colors flex items-center gap-2"
      >
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
        </svg>
        Logout
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import { useAuthStore } from '@/stores/auth';

interface Props {
  user: {
    username: string;
    avatarUrl?: string;
  };
}

defineProps<Props>();

const authStore = useAuthStore();
const isOpen = ref(false);
const menuRef = ref<HTMLElement | null>(null);

function handleLogout() {
  authStore.logout();
}

function handleClickOutside(event: MouseEvent) {
  if (menuRef.value && !menuRef.value.contains(event.target as Node)) {
    isOpen.value = false;
  }
}

onMounted(() => {
  document.addEventListener('click', handleClickOutside);
});

onUnmounted(() => {
  document.removeEventListener('click', handleClickOutside);
});
</script>
```

### 4. Update App Layout

#### `frontend/src/App.vue`

Add UserMenu to header:

```vue
<template>
  <div class="min-h-screen bg-gray-900 text-white">
    <header v-if="authStore.isAuthenticated" class="bg-gray-800 border-b border-gray-700">
      <div class="container mx-auto px-4 py-4 flex items-center justify-between">
        <div class="flex items-center gap-4">
          <h1 class="text-2xl font-bold">Spawner</h1>
          <nav class="flex gap-2">
            <router-link
              to="/"
              class="px-3 py-2 rounded-lg hover:bg-gray-700 transition-colors"
              active-class="bg-gray-700"
            >
              Dashboard
            </router-link>
            <router-link
              to="/environments/new"
              class="px-3 py-2 rounded-lg hover:bg-gray-700 transition-colors"
              active-class="bg-gray-700"
            >
              New Environment
            </router-link>
          </nav>
        </div>
        <UserMenu v-if="authStore.user" :user="authStore.user" />
      </div>
    </header>

    <main class="container mx-auto px-4 py-8">
      <router-view />
    </main>
  </div>
</template>

<script setup lang="ts">
import { onMounted } from 'vue';
import { useAuthStore } from '@/stores/auth';
import UserMenu from '@/components/UserMenu.vue';

const authStore = useAuthStore();

onMounted(() => {
  authStore.checkAuth();
});
</script>
```

### 5. Add Navigation Guards

#### `frontend/src/router/index.ts`

```typescript
import { createRouter, createWebHistory } from 'vue-router';
import { useAuthStore } from '@/stores/auth';
import Dashboard from '@/views/Dashboard.vue';
import Login from '@/views/Login.vue';
import NewEnvironment from '@/views/NewEnvironment.vue';
import EnvironmentDetail from '@/views/EnvironmentDetail.vue';

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/login',
      name: 'Login',
      component: Login,
      meta: { requiresAuth: false },
    },
    {
      path: '/',
      name: 'Dashboard',
      component: Dashboard,
      meta: { requiresAuth: true },
    },
    {
      path: '/environments/new',
      name: 'NewEnvironment',
      component: NewEnvironment,
      meta: { requiresAuth: true },
    },
    {
      path: '/environments/:id',
      name: 'EnvironmentDetail',
      component: EnvironmentDetail,
      meta: { requiresAuth: true },
    },
  ],
});

router.beforeEach(async (to, from, next) => {
  const authStore = useAuthStore();

  // Check authentication status if not already checked
  if (authStore.user === null && !authStore.loading) {
    await authStore.checkAuth();
  }

  const requiresAuth = to.meta.requiresAuth !== false;

  if (requiresAuth && !authStore.isAuthenticated) {
    // Redirect to login if route requires auth and user is not authenticated
    next({ name: 'Login' });
  } else if (to.name === 'Login' && authStore.isAuthenticated) {
    // Redirect to dashboard if user is authenticated and tries to access login
    next({ name: 'Dashboard' });
  } else {
    next();
  }
});

export default router;
```

## Database Migration

Run TypeORM migration to create new tables:

```bash
cd backend
npm run typeorm migration:generate -- -n AddAuthTables
npm run typeorm migration:run
```

Or manually create the tables in SQLite:

```sql
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  githubId TEXT UNIQUE NOT NULL,
  username TEXT NOT NULL,
  email TEXT,
  avatarUrl TEXT,
  isActive INTEGER DEFAULT 1,
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  lastLoginAt DATETIME
);

CREATE TABLE audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  userId INTEGER,
  action TEXT NOT NULL,
  details TEXT,
  ipAddress TEXT,
  userAgent TEXT,
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (userId) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX idx_audit_logs_userId ON audit_logs(userId);
CREATE INDEX idx_audit_logs_action ON audit_logs(action);
CREATE INDEX idx_audit_logs_createdAt ON audit_logs(createdAt);
```

## Testing Procedure

### 1. Development Testing

1. Start backend: `cd backend && npm run start:dev`
2. Start frontend: `cd frontend && npm run dev`
3. Navigate to `http://localhost:8001`
4. You should be redirected to `/login`
5. Click "Login with GitHub"
6. Authorize the app on GitHub
7. You should be redirected back to the dashboard
8. Verify your username and avatar appear in the top-right
9. Try accessing different pages (all should work)
10. Click logout and verify you're redirected to login

### 2. Team Membership Testing

1. Login with a GitHub account that is NOT a member of the Developer team
2. You should see an error: "Access denied. You must be a member of the Developer team in Iris-Prevention organization."
3. Login with an account that IS a member
4. Access should be granted

### 3. Session Persistence Testing

1. Login successfully
2. Close the browser tab
3. Open a new tab to `http://localhost:8001`
4. You should still be logged in (session persisted)
5. Wait for session to expire (default: 24 hours)
6. Refresh the page - you should be redirected to login

### 4. Audit Log Verification

Check the database for audit logs:

```sql
SELECT * FROM audit_logs ORDER BY createdAt DESC;
```

You should see entries for:
- LOGIN actions when users log in
- LOGOUT actions when users log out
- CREATE_ENVIRONMENT when environments are created
- DELETE_ENVIRONMENT when environments are deleted

## Production Deployment

### 1. Update Environment Variables

Create `backend/.env.production`:

```env
# GitHub OAuth Production
GITHUB_CLIENT_ID=your_production_client_id
GITHUB_CLIENT_SECRET=your_production_client_secret
GITHUB_CALLBACK_URL=https://spawner.irisprevention.fr/api/auth/github/callback
GITHUB_ORG=Iris-Prevention
GITHUB_TEAM=Developer

# Session
SESSION_SECRET=generate_a_different_random_secret_min_32_chars
SESSION_MAX_AGE=86400000

# Frontend URL
FRONTEND_URL=https://spawner.irisprevention.fr

# Production flag
NODE_ENV=production
```

### 2. Update CORS Configuration

In `backend/src/main.ts`:

```typescript
app.enableCors({
  origin: process.env.FRONTEND_URL,
  credentials: true,
});
```

### 3. Update Frontend API URLs

Create `frontend/.env.production`:

```env
VITE_API_URL=https://spawner.irisprevention.fr/api
```

Update auth store to use environment variable:

```typescript
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';

async function checkAuth() {
  const response = await fetch(`${API_URL}/auth/status`, {
    credentials: 'include',
  });
  // ...
}
```

### 4. SSL/HTTPS Requirements

- Session cookies require `secure: true` in production
- CORS must be properly configured
- GitHub OAuth callback must use HTTPS
- Ensure reverse proxy (Traefik/Nginx) handles SSL termination

## Security Considerations

1. **Session Security**
   - Sessions stored in SQLite database (file: `backend/data/sessions.db`)
   - Session cookies are httpOnly and secure in production
   - Session secret should be strong and unique (min 32 characters)

2. **Team Verification**
   - Team membership checked on every login
   - Uses GitHub OAuth access token to verify via API
   - Unauthorized users cannot access the application

3. **CORS**
   - Only frontend URL is allowed
   - Credentials (cookies) are allowed for authentication

4. **Audit Logging**
   - All actions are logged with user, timestamp, IP, and user agent
   - Logs help track security incidents
   - Can be reviewed in database or via admin interface (future)

5. **Rate Limiting** (Recommended Addition)
   - Add rate limiting to login endpoint to prevent brute force
   - Use `@nestjs/throttler` package

6. **Database Backups**
   - SQLite database should be backed up regularly
   - Includes users, audit logs, and sessions

## Future Enhancements

1. **Admin Interface** - View audit logs and manage users via UI
2. **Role-Based Access Control** - Different permissions for different teams
3. **Environment Access Control** - Restrict certain environments to specific users
4. **Email Notifications** - Notify on important actions
5. **Rate Limiting** - Prevent abuse of authentication endpoints
6. **Session Management** - View and revoke active sessions
7. **Two-Factor Authentication** - Additional security layer
8. **OAuth with GitLab** - Support for GitLab OAuth as alternative
