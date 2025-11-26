# Authentication System Design - Spawner

## Overview

This document describes the complete implementation plan for adding user authentication to Spawner using Basic Auth with an invitation-based user management system.

## Requirements

- **Authentication Method**: HTTP Basic Authentication
- **User Roles**:
  - `admin`: Full access + ability to invite users
  - `user`: Full access to all features except user management
- **Invitation System**: Only admins can invite new users via temporary invitation tokens
- **Security**: Passwords hashed with bcrypt, tokens expire after 24h, one-time use only

## Architecture

### Database Schema

#### Users Table
```typescript
{
  id: number (primary key, auto-increment)
  username: string (unique, not null)
  password: string (bcrypt hash, not null)
  role: 'admin' | 'user' (default: 'user')
  createdAt: Date
  updatedAt: Date
  lastLoginAt: Date (nullable)
}
```

#### Invitations Table
```typescript
{
  id: number (primary key, auto-increment)
  token: string (unique, UUID v4)
  username: string (unique for pending invitations)
  email: string (nullable, optional)
  invitedBy: number (foreign key -> users.id)
  expiresAt: Date
  usedAt: Date (nullable)
  createdAt: Date
}
```

### Backend Architecture (NestJS)

#### Module Structure

```
apps/api/src/
├── modules/
│   ├── auth/
│   │   ├── auth.module.ts
│   │   ├── auth.service.ts
│   │   ├── auth.controller.ts
│   │   ├── guards/
│   │   │   ├── basic-auth.guard.ts
│   │   │   └── roles.guard.ts
│   │   ├── decorators/
│   │   │   ├── current-user.decorator.ts
│   │   │   └── roles.decorator.ts
│   │   └── strategies/
│   │       └── basic.strategy.ts
│   │
│   └── users/
│       ├── users.module.ts
│       ├── users.service.ts
│       ├── users.controller.ts
│       └── dto/
│           ├── create-invitation.dto.ts
│           ├── register-user.dto.ts
│           └── update-user.dto.ts
│
├── entities/
│   ├── user.entity.ts
│   └── invitation.entity.ts
│
└── common/
    └── interfaces/
        └── request-with-user.interface.ts
```

#### Key Components

##### 1. User Entity (`apps/api/src/entities/user.entity.ts`)
```typescript
import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn } from 'typeorm';
import * as bcrypt from 'bcrypt';

export type UserRole = 'admin' | 'user';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ unique: true })
  username: string;

  @Column()
  password: string; // bcrypt hash

  @Column({ type: 'varchar', default: 'user' })
  role: UserRole;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @Column({ nullable: true })
  lastLoginAt: Date;

  // Instance method to validate password
  async validatePassword(plainPassword: string): Promise<boolean> {
    return bcrypt.compare(plainPassword, this.password);
  }

  // Static method to hash password
  static async hashPassword(plainPassword: string): Promise<string> {
    const salt = await bcrypt.genSalt(10);
    return bcrypt.hash(plainPassword, salt);
  }
}
```

##### 2. Invitation Entity (`apps/api/src/entities/invitation.entity.ts`)
```typescript
import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { User } from './user.entity';

@Entity('invitations')
export class Invitation {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ unique: true })
  token: string; // UUID v4

  @Column()
  username: string; // Pre-assigned username

  @Column({ nullable: true })
  email: string;

  @ManyToOne(() => User, { nullable: false })
  @JoinColumn({ name: 'invitedBy' })
  inviter: User;

  @Column()
  invitedBy: number;

  @Column()
  expiresAt: Date;

  @Column({ nullable: true })
  usedAt: Date;

  @CreateDateColumn()
  createdAt: Date;

  // Check if invitation is still valid
  isValid(): boolean {
    return !this.usedAt && new Date() < this.expiresAt;
  }
}
```

##### 3. Basic Auth Guard (`apps/api/src/modules/auth/guards/basic-auth.guard.ts`)
```typescript
import { Injectable, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class BasicAuthGuard extends AuthGuard('basic') {
  canActivate(context: ExecutionContext) {
    return super.canActivate(context);
  }

  handleRequest(err, user, info) {
    if (err || !user) {
      throw new UnauthorizedException('Invalid credentials');
    }
    return user;
  }
}
```

##### 4. Roles Guard (`apps/api/src/modules/auth/guards/roles.guard.ts`)
```typescript
import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '../../../entities/user.entity';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.get<UserRole[]>('roles', context.getHandler());

    if (!requiredRoles) {
      return true; // No roles required
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user) {
      throw new ForbiddenException('User not authenticated');
    }

    const hasRole = requiredRoles.includes(user.role);

    if (!hasRole) {
      throw new ForbiddenException('Insufficient permissions');
    }

    return true;
  }
}
```

##### 5. Auth Service (`apps/api/src/modules/auth/auth.service.ts`)
```typescript
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../../entities/user.entity';

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User)
    private usersRepository: Repository<User>,
  ) {}

  async validateUser(username: string, password: string): Promise<User | null> {
    const user = await this.usersRepository.findOne({ where: { username } });

    if (!user) {
      return null;
    }

    const isPasswordValid = await user.validatePassword(password);

    if (!isPasswordValid) {
      return null;
    }

    // Update last login
    user.lastLoginAt = new Date();
    await this.usersRepository.save(user);

    return user;
  }

  async getUserById(id: number): Promise<User | null> {
    return this.usersRepository.findOne({ where: { id } });
  }
}
```

##### 6. Users Service (`apps/api/src/modules/users/users.service.ts`)
```typescript
import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../../entities/user.entity';
import { Invitation } from '../../entities/invitation.entity';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private usersRepository: Repository<User>,
    @InjectRepository(Invitation)
    private invitationsRepository: Repository<Invitation>,
  ) {}

  // List all users
  async findAll(): Promise<User[]> {
    return this.usersRepository.find({
      select: ['id', 'username', 'role', 'createdAt', 'lastLoginAt'],
      order: { createdAt: 'DESC' },
    });
  }

  // Create invitation (admin only)
  async createInvitation(
    username: string,
    email: string | null,
    inviterId: number,
  ): Promise<Invitation> {
    // Check if username already exists
    const existingUser = await this.usersRepository.findOne({ where: { username } });
    if (existingUser) {
      throw new BadRequestException('Username already taken');
    }

    // Check for pending invitation with same username
    const pendingInvitation = await this.invitationsRepository.findOne({
      where: { username, usedAt: null },
    });
    if (pendingInvitation && pendingInvitation.isValid()) {
      throw new BadRequestException('Pending invitation already exists for this username');
    }

    const token = uuidv4();
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 24); // 24h expiration

    const invitation = this.invitationsRepository.create({
      token,
      username,
      email,
      invitedBy: inviterId,
      expiresAt,
    });

    return this.invitationsRepository.save(invitation);
  }

  // Register user from invitation
  async registerFromInvitation(token: string, password: string): Promise<User> {
    const invitation = await this.invitationsRepository.findOne({
      where: { token },
    });

    if (!invitation) {
      throw new NotFoundException('Invitation not found');
    }

    if (!invitation.isValid()) {
      throw new BadRequestException('Invitation expired or already used');
    }

    // Check if username is still available
    const existingUser = await this.usersRepository.findOne({
      where: { username: invitation.username },
    });
    if (existingUser) {
      throw new BadRequestException('Username no longer available');
    }

    // Create user
    const hashedPassword = await User.hashPassword(password);
    const user = this.usersRepository.create({
      username: invitation.username,
      password: hashedPassword,
      role: 'user',
    });

    await this.usersRepository.save(user);

    // Mark invitation as used
    invitation.usedAt = new Date();
    await this.invitationsRepository.save(invitation);

    return user;
  }

  // Get invitation details
  async getInvitation(token: string): Promise<Invitation> {
    const invitation = await this.invitationsRepository.findOne({
      where: { token },
    });

    if (!invitation) {
      throw new NotFoundException('Invitation not found');
    }

    return invitation;
  }

  // List all invitations
  async findAllInvitations(): Promise<Invitation[]> {
    return this.invitationsRepository.find({
      order: { createdAt: 'DESC' },
    });
  }

  // Delete user (admin only)
  async deleteUser(userId: number, currentUserId: number): Promise<void> {
    if (userId === currentUserId) {
      throw new BadRequestException('Cannot delete your own account');
    }

    const user = await this.usersRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    await this.usersRepository.remove(user);
  }

  // Update user role (admin only)
  async updateUserRole(userId: number, newRole: 'admin' | 'user'): Promise<User> {
    const user = await this.usersRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    user.role = newRole;
    return this.usersRepository.save(user);
  }
}
```

##### 7. Basic Strategy (`apps/api/src/modules/auth/strategies/basic.strategy.ts`)
```typescript
import { BasicStrategy as Strategy } from 'passport-http';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { AuthService } from '../auth.service';
import { User } from '../../../entities/user.entity';

@Injectable()
export class BasicStrategy extends PassportStrategy(Strategy) {
  constructor(private authService: AuthService) {
    super();
  }

  async validate(username: string, password: string): Promise<User> {
    const user = await this.authService.validateUser(username, password);

    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    return user;
  }
}
```

#### API Endpoints

##### Auth Endpoints
```
POST   /api/auth/login           - Verify credentials (returns user info)
GET    /api/auth/me              - Get current user info
POST   /api/auth/logout          - Logout (client-side only)
```

##### Users Management Endpoints (Admin only except GET /me)
```
GET    /api/users                - List all users (admin only)
GET    /api/users/me             - Get current user
DELETE /api/users/:id            - Delete user (admin only)
PUT    /api/users/:id/role       - Update user role (admin only)

POST   /api/users/invitations    - Create invitation (admin only)
GET    /api/users/invitations    - List all invitations (admin only)
GET    /api/users/invitations/:token - Get invitation details (public)
POST   /api/users/register       - Register from invitation (public)
```

### Frontend Architecture (Vue.js)

#### New Views/Components

```
apps/web/src/
├── views/
│   ├── Login.vue                 - Login page with Basic Auth form
│   ├── Register.vue              - Registration page from invitation
│   └── Users.vue                 - User management (admin only)
│
├── components/
│   ├── UserList.vue              - List of users with delete action
│   ├── InvitationList.vue        - List of pending invitations
│   └── InviteUserModal.vue       - Modal to create invitation
│
├── services/
│   ├── auth.service.ts           - Authentication API calls
│   └── users.service.ts          - User management API calls
│
├── composables/
│   ├── useAuth.ts                - Auth state & helpers
│   └── useCurrentUser.ts         - Current user reactive state
│
└── router/
    └── guards.ts                 - Navigation guards for auth
```

#### Authentication Flow

1. **Login Flow**:
   - User enters username/password in [Login.vue](apps/web/src/views/Login.vue)
   - Frontend encodes credentials to Base64: `btoa(username:password)`
   - Stores encoded credentials in `localStorage.authToken`
   - All API requests include header: `Authorization: Basic <token>`
   - Redirects to Dashboard

2. **Protected Routes**:
   - Navigation guard checks `localStorage.authToken`
   - If missing → redirect to `/login`
   - If present → validate with `GET /api/auth/me`
   - If invalid → clear token, redirect to `/login`

3. **Invitation Flow**:
   - Admin creates invitation from [Users.vue](apps/web/src/views/Users.vue)
   - System generates invitation link: `/register?token=xxx`
   - Admin shares link (manual copy/paste or email)
   - New user visits link → [Register.vue](apps/web/src/views/Register.vue)
   - User sets password → account created → redirect to login

#### Key Frontend Files

##### Auth Service (`apps/web/src/services/auth.service.ts`)
```typescript
import axios from 'axios';
import type { User } from '@spawner/types';

const API_URL = import.meta.env.VITE_API_URL || '/api';

export const authService = {
  // Encode credentials for Basic Auth
  encodeCredentials(username: string, password: string): string {
    return btoa(`${username}:${password}`);
  },

  // Login
  async login(username: string, password: string): Promise<User> {
    const token = this.encodeCredentials(username, password);
    const response = await axios.post(
      `${API_URL}/auth/login`,
      {},
      {
        headers: { Authorization: `Basic ${token}` },
      }
    );

    // Store token
    localStorage.setItem('authToken', token);

    return response.data;
  },

  // Get current user
  async getCurrentUser(): Promise<User> {
    const token = localStorage.getItem('authToken');
    if (!token) {
      throw new Error('Not authenticated');
    }

    const response = await axios.get(`${API_URL}/auth/me`, {
      headers: { Authorization: `Basic ${token}` },
    });

    return response.data;
  },

  // Logout
  logout(): void {
    localStorage.removeItem('authToken');
  },

  // Check if user is logged in
  isAuthenticated(): boolean {
    return !!localStorage.getItem('authToken');
  },

  // Get stored token
  getToken(): string | null {
    return localStorage.getItem('authToken');
  },
};
```

##### useAuth Composable (`apps/web/src/composables/useAuth.ts`)
```typescript
import { ref, computed } from 'vue';
import { authService } from '../services/auth.service';
import type { User } from '@spawner/types';

const currentUser = ref<User | null>(null);
const isLoading = ref(false);

export function useAuth() {
  const isAuthenticated = computed(() => !!currentUser.value);
  const isAdmin = computed(() => currentUser.value?.role === 'admin');

  async function login(username: string, password: string) {
    isLoading.value = true;
    try {
      const user = await authService.login(username, password);
      currentUser.value = user;
      return user;
    } finally {
      isLoading.value = false;
    }
  }

  async function loadCurrentUser() {
    if (!authService.isAuthenticated()) {
      currentUser.value = null;
      return;
    }

    isLoading.value = true;
    try {
      const user = await authService.getCurrentUser();
      currentUser.value = user;
    } catch (error) {
      // Invalid token
      authService.logout();
      currentUser.value = null;
    } finally {
      isLoading.value = false;
    }
  }

  function logout() {
    authService.logout();
    currentUser.value = null;
  }

  return {
    currentUser,
    isAuthenticated,
    isAdmin,
    isLoading,
    login,
    logout,
    loadCurrentUser,
  };
}
```

##### Router Guard (`apps/web/src/router/guards.ts`)
```typescript
import type { NavigationGuardNext, RouteLocationNormalized } from 'vue-router';
import { authService } from '../services/auth.service';

export async function authGuard(
  to: RouteLocationNormalized,
  from: RouteLocationNormalized,
  next: NavigationGuardNext
) {
  const isAuthenticated = authService.isAuthenticated();
  const isLoginPage = to.name === 'Login';
  const isRegisterPage = to.name === 'Register';

  // Allow access to login and register pages
  if (isLoginPage || isRegisterPage) {
    next();
    return;
  }

  // Redirect to login if not authenticated
  if (!isAuthenticated) {
    next({ name: 'Login', query: { redirect: to.fullPath } });
    return;
  }

  next();
}
```

### Shared Types Update

Add to `packages/types/src/index.ts`:

```typescript
// User Types
export type UserRole = 'admin' | 'user';

export interface User {
  id: number;
  username: string;
  role: UserRole;
  createdAt: string | Date;
  lastLoginAt: string | Date | null;
}

export interface Invitation {
  id: number;
  token: string;
  username: string;
  email: string | null;
  invitedBy: number;
  expiresAt: string | Date;
  usedAt: string | Date | null;
  createdAt: string | Date;
}

// DTOs
export interface LoginDto {
  username: string;
  password: string;
}

export interface CreateInvitationDto {
  username: string;
  email?: string;
}

export interface RegisterFromInvitationDto {
  token: string;
  password: string;
}

export interface UpdateUserRoleDto {
  role: UserRole;
}
```

## Implementation Steps

### Phase 1: Backend - Database & Entities
1. ✅ Create [user.entity.ts](apps/api/src/entities/user.entity.ts)
2. ✅ Create [invitation.entity.ts](apps/api/src/entities/invitation.entity.ts)
3. ✅ Update [app.module.ts](apps/api/src/app.module.ts) to include new entities
4. ✅ Install dependencies: `pnpm --filter @spawner/api add bcrypt @types/bcrypt passport passport-http @nestjs/passport uuid`

### Phase 2: Backend - Auth Module
5. ✅ Create auth module structure
6. ✅ Implement BasicStrategy
7. ✅ Create BasicAuthGuard
8. ✅ Create RolesGuard
9. ✅ Create decorators (@CurrentUser, @Roles)
10. ✅ Implement AuthService
11. ✅ Implement AuthController

### Phase 3: Backend - Users Module
12. ✅ Create users module structure
13. ✅ Implement UsersService
14. ✅ Implement UsersController
15. ✅ Add validation DTOs

### Phase 4: Backend - Protect Existing Routes
16. ✅ Add @UseGuards(BasicAuthGuard) to all existing controllers
17. ✅ Add @Roles('admin') to sensitive endpoints if needed

### Phase 5: Frontend - Auth Infrastructure
18. ✅ Update shared types package
19. ✅ Create auth.service.ts
20. ✅ Create useAuth composable
21. ✅ Add router guards

### Phase 6: Frontend - Auth Views
22. ✅ Create Login.vue
23. ✅ Create Register.vue
24. ✅ Create Users.vue (admin panel)
25. ✅ Update navigation to include logout & user info
26. ✅ Update axios interceptor to inject auth header

### Phase 7: Initial Admin Setup
27. ✅ Create database seed/migration to add first admin user
28. ✅ Document initial admin credentials

### Phase 8: Testing & Documentation
29. ✅ Test complete auth flow
30. ✅ Test invitation system
31. ✅ Update README.md with auth setup instructions
32. ✅ Update CLAUDE.md

## Initial Admin User

Create a script or migration to seed the first admin user:

**Script: `apps/api/src/scripts/create-admin.ts`**
```typescript
import { DataSource } from 'typeorm';
import { User } from '../entities/user.entity';
import * as bcrypt from 'bcrypt';

async function createAdmin() {
  const dataSource = new DataSource({
    type: 'sqlite',
    database: process.env.DATABASE_PATH || '/opt/spawner/data/spawner.db',
    entities: [User],
  });

  await dataSource.initialize();

  const username = process.env.ADMIN_USERNAME || 'admin';
  const password = process.env.ADMIN_PASSWORD || 'spawner-admin-2024';

  const existingAdmin = await dataSource
    .getRepository(User)
    .findOne({ where: { username } });

  if (existingAdmin) {
    console.log('Admin user already exists');
    await dataSource.destroy();
    return;
  }

  const hashedPassword = await User.hashPassword(password);
  const admin = dataSource.getRepository(User).create({
    username,
    password: hashedPassword,
    role: 'admin',
  });

  await dataSource.getRepository(User).save(admin);

  console.log(`Admin user created: ${username}`);
  console.log(`Default password: ${password}`);
  console.log('Please change the password after first login');

  await dataSource.destroy();
}

createAdmin().catch(console.error);
```

**Add to `apps/api/package.json`:**
```json
{
  "scripts": {
    "create-admin": "ts-node src/scripts/create-admin.ts"
  }
}
```

## Security Considerations

### Production Deployment
1. **HTTPS Only**: Basic Auth MUST be used over HTTPS in production
2. **Secure Headers**: Add helmet.js middleware
3. **Rate Limiting**: Add rate limiting on auth endpoints
4. **Password Policy**: Enforce strong passwords (min 8 chars, complexity)
5. **Session Timeout**: Consider adding JWT tokens for better session management
6. **Audit Logs**: Log all auth events and user management actions

### Environment Variables
```bash
# Backend .env
ADMIN_USERNAME=admin
ADMIN_PASSWORD=change-me-in-production
SESSION_SECRET=your-secret-key-here
```

### Password Requirements
- Minimum 8 characters
- At least one uppercase letter
- At least one lowercase letter
- At least one number
- At least one special character

## Future Enhancements

### Optional Improvements
1. **Email Invitations**: Send invitation links via email instead of manual copy
2. **JWT Tokens**: Replace Basic Auth with JWT for better session management
3. **Two-Factor Authentication**: Add 2FA support
4. **Password Reset**: Self-service password reset flow
5. **User Profiles**: Add profile pictures, email, etc.
6. **Activity Logs**: Track user actions for audit trail
7. **API Keys**: Allow users to generate API keys for programmatic access
8. **SSO Integration**: SAML/OAuth2 for enterprise authentication

## Testing Checklist

### Backend Tests
- [ ] User creation and password hashing
- [ ] Login with valid credentials
- [ ] Login with invalid credentials
- [ ] Invitation creation (admin only)
- [ ] Invitation validation (expiration, already used)
- [ ] User registration from valid invitation
- [ ] User registration from invalid/expired invitation
- [ ] Protected route access (authenticated)
- [ ] Protected route access (unauthenticated)
- [ ] Admin-only route access (admin user)
- [ ] Admin-only route access (regular user)

### Frontend Tests
- [ ] Login form validation
- [ ] Successful login flow
- [ ] Failed login (wrong credentials)
- [ ] Logout functionality
- [ ] Protected route redirect to login
- [ ] Admin panel visibility (admin only)
- [ ] Invitation creation UI
- [ ] Registration from invitation link
- [ ] Expired invitation handling

## Migration Path

### For Existing Deployments
1. Deploy new backend with auth endpoints
2. Run `pnpm api:create-admin` to create first admin user
3. Deploy new frontend with login page
4. Existing environments continue to work
5. Force login for new sessions
6. Gradually migrate users

### Backward Compatibility
- All existing API endpoints remain functional
- Auth is enforced via guards
- No breaking changes to environment management

## Documentation Updates Required

### Files to Update
- [README.md](README.md): Add authentication setup section
- [CLAUDE.md](CLAUDE.md): Add auth module documentation
- [QUICK-START-MONOREPO.md](QUICK-START-MONOREPO.md): Add initial admin setup

### New Documentation
- **AUTH-SETUP.md**: Detailed auth configuration guide
- **USER-MANAGEMENT.md**: Guide for managing users and invitations

## Dependencies to Add

### Backend
```bash
pnpm --filter @spawner/api add bcrypt passport passport-http @nestjs/passport uuid
pnpm --filter @spawner/api add -D @types/bcrypt @types/passport-http
```

### Frontend
```bash
# No new dependencies required (using built-in btoa for Basic Auth)
```

## API Request Examples

### Login (Basic Auth)
```bash
# Verify credentials
curl -X POST http://localhost:3000/api/auth/login \
  -H "Authorization: Basic $(echo -n 'admin:password' | base64)"

# Response:
{
  "id": 1,
  "username": "admin",
  "role": "admin",
  "createdAt": "2024-01-15T10:00:00.000Z",
  "lastLoginAt": "2024-01-15T10:05:00.000Z"
}
```

### Create Invitation (Admin Only)
```bash
curl -X POST http://localhost:3000/api/users/invitations \
  -H "Authorization: Basic $(echo -n 'admin:password' | base64)" \
  -H "Content-Type: application/json" \
  -d '{
    "username": "john.doe",
    "email": "john@example.com"
  }'

# Response:
{
  "id": 1,
  "token": "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d",
  "username": "john.doe",
  "email": "john@example.com",
  "invitedBy": 1,
  "expiresAt": "2024-01-16T10:00:00.000Z",
  "usedAt": null,
  "createdAt": "2024-01-15T10:00:00.000Z"
}
```

### Register from Invitation
```bash
curl -X POST http://localhost:3000/api/users/register \
  -H "Content-Type: application/json" \
  -d '{
    "token": "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d",
    "password": "SecurePassword123!"
  }'

# Response:
{
  "id": 2,
  "username": "john.doe",
  "role": "user",
  "createdAt": "2024-01-15T10:10:00.000Z",
  "lastLoginAt": null
}
```

### List Users (Admin Only)
```bash
curl http://localhost:3000/api/users \
  -H "Authorization: Basic $(echo -n 'admin:password' | base64)"

# Response:
[
  {
    "id": 1,
    "username": "admin",
    "role": "admin",
    "createdAt": "2024-01-15T10:00:00.000Z",
    "lastLoginAt": "2024-01-15T10:05:00.000Z"
  },
  {
    "id": 2,
    "username": "john.doe",
    "role": "user",
    "createdAt": "2024-01-15T10:10:00.000Z",
    "lastLoginAt": "2024-01-15T11:00:00.000Z"
  }
]
```

## Conclusion

This design provides a secure, simple authentication system using HTTP Basic Auth with an invitation-based user management flow. The admin can control who has access to the Spawner tool, while regular users have full access to all environment management features.

The implementation leverages NestJS best practices (guards, decorators, modules) and Vue.js 3 Composition API for a clean, maintainable codebase that integrates seamlessly with the existing monorepo structure.
