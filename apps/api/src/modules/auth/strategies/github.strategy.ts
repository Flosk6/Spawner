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
