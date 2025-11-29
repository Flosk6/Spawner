import { Injectable, NotFoundException } from '@nestjs/common';
import { Octokit } from '@octokit/rest';
import { PrismaService } from '../../common/prisma.service';

interface CreateUserDto {
  githubId: string;
  username: string;
  email?: string;
  avatarUrl?: string;
}

@Injectable()
export class AuthService {
  constructor(private prisma: PrismaService) {}

  async verifyTeamMembership(
    accessToken: string,
    org: string,
    team: string,
    username: string,
  ): Promise<boolean> {
    try {
      const octokit = new Octokit({ auth: accessToken });

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

  async findOrCreateUser(data: CreateUserDto) {
    const user = await this.prisma.user.findUnique({
      where: { githubId: data.githubId },
    });

    if (!user) {
      return this.prisma.user.create({
        data: {
          ...data,
          lastLoginAt: new Date(),
        },
      });
    }

    return this.prisma.user.update({
      where: { githubId: data.githubId },
      data: {
        username: data.username,
        email: data.email,
        avatarUrl: data.avatarUrl,
        lastLoginAt: new Date(),
      },
    });
  }

  async findUserById(id: number) {
    const user = await this.prisma.user.findUnique({ where: { id } });
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
  ) {
    await this.prisma.auditLog.create({
      data: {
        userId,
        action,
        details: JSON.stringify(details),
        ipAddress,
        userAgent,
      },
    });
  }
}
