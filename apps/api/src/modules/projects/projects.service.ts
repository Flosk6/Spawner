import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Project } from '../../entities/project.entity';

@Injectable()
export class ProjectsService {
  constructor(
    @InjectRepository(Project)
    private projectRepository: Repository<Project>,
  ) {}

  async findAll(): Promise<Project[]> {
    return this.projectRepository.find({
      relations: ['resources', 'environments'],
      order: { createdAt: 'DESC' },
    });
  }

  async findOne(id: number): Promise<Project> {
    const project = await this.projectRepository.findOne({
      where: { id },
      relations: ['resources', 'environments'],
    });

    if (!project) {
      throw new NotFoundException(`Project with ID ${id} not found`);
    }

    return project;
  }

  async create(data: { name: string; baseDomain: string }): Promise<Project> {
    // Check if project with same name already exists
    const existing = await this.projectRepository.findOne({
      where: { name: data.name },
    });

    if (existing) {
      throw new ConflictException(`Project with name "${data.name}" already exists`);
    }

    const project = this.projectRepository.create(data);
    return this.projectRepository.save(project);
  }

  async update(id: number, data: { name?: string; baseDomain?: string }): Promise<Project> {
    const project = await this.findOne(id);

    // If updating name, check for conflicts
    if (data.name && data.name !== project.name) {
      const existing = await this.projectRepository.findOne({
        where: { name: data.name },
      });

      if (existing) {
        throw new ConflictException(`Project with name "${data.name}" already exists`);
      }
    }

    Object.assign(project, data);
    return this.projectRepository.save(project);
  }

  async delete(id: number): Promise<void> {
    const project = await this.findOne(id);
    await this.projectRepository.remove(project);
  }
}
