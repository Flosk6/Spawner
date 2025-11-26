import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Octokit } from '@octokit/rest';
import { User } from '../../entities/user.entity';
import { AuditLog } from '../../entities/audit-log.entity';

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
