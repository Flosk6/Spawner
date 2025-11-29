import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma.service';

@Injectable()
export class ProjectsService {
  constructor(private prisma: PrismaService) {}

  async findAll() {
    return this.prisma.project.findMany({
      include: {
        resources: true,
        environments: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: number) {
    const project = await this.prisma.project.findUnique({
      where: { id },
      include: {
        resources: true,
        environments: true,
      },
    });

    if (!project) {
      throw new NotFoundException(`Project with ID ${id} not found`);
    }

    return project;
  }

  async create(data: { name: string; baseDomain: string }) {
    const existing = await this.prisma.project.findUnique({
      where: { name: data.name },
    });

    if (existing) {
      throw new ConflictException(`Project with name "${data.name}" already exists`);
    }

    return this.prisma.project.create({
      data,
    });
  }

  async update(id: number, data: { name?: string; baseDomain?: string }) {
    const project = await this.findOne(id);

    if (data.name && data.name !== project.name) {
      const existing = await this.prisma.project.findUnique({
        where: { name: data.name },
      });

      if (existing) {
        throw new ConflictException(`Project with name "${data.name}" already exists`);
      }
    }

    return this.prisma.project.update({
      where: { id },
      data,
    });
  }

  async delete(id: number) {
    await this.findOne(id);

    await this.prisma.project.delete({
      where: { id },
    });
  }
}
