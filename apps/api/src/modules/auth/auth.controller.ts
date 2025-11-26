import { Controller, Get, Req, Res, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Request, Response } from 'express';
import { ConfigService } from '@nestjs/config';
import { SessionAuthGuard } from './guards/session-auth.guard';
import { AuthService } from './auth.service';
import { AuthTokenService } from './auth-token.service';
import { User } from '../../entities/user.entity';

@Controller('auth')
export class AuthController {
  constructor(
    private configService: ConfigService,
    private authService: AuthService,
    private authTokenService: AuthTokenService,
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

    // Manually call req.login to serialize user into session
    return new Promise((resolve, reject) => {
      req.login(user, async (err) => {
        if (err) {
          console.error('OAuth login error:', err);
          return reject(err);
        }

        // Log login action
        await this.authService.logAction(
          user.id,
          'LOGIN',
          { method: 'github', username: user.username },
          req.ip,
          req.headers['user-agent'],
        );

        // Redirect to frontend
        const frontendUrl = this.configService.get('FRONTEND_URL') || 'http://localhost:8080';
        res.redirect(frontendUrl);
        resolve(true);
      });
    });
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
        const frontendUrl = this.configService.get('FRONTEND_URL') || 'http://localhost:8080';
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

  @Get('ws-token')
  @UseGuards(SessionAuthGuard)
  getWsToken(@Req() req: Request) {
    const user = req.user as User;
    return this.authTokenService.generateWsToken(user.id, user.username);
  }
}
