import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { Project } from './project.entity';

export type ResourceType = 'laravel-api' | 'nextjs-front' | 'mysql-db';

@Entity('project_resources')
export class ProjectResource {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'project_id' })
  projectId: number;

  @ManyToOne(() => Project, (project) => project.resources, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'project_id' })
  project: Project;

  @Column()
  name: string;

  @Column()
  type: ResourceType;

  @Column({ name: 'git_repo', nullable: true })
  gitRepo: string;

  @Column({ name: 'default_branch', nullable: true })
  defaultBranch: string;

  @Column({ name: 'db_resource_id', nullable: true })
  dbResourceId: number;

  @Column({ name: 'api_resource_id', nullable: true })
  apiResourceId: number;

  @Column({ name: 'static_env_vars', type: 'json', default: '{}' })
  staticEnvVars: Record<string, string>;

  @Column({ name: 'post_build_commands', type: 'json', default: '[]' })
  postBuildCommands: string[];

  @Column({ name: 'resource_limits', type: 'json', nullable: true })
  resourceLimits?: {
    cpu?: string;
    memory?: string;
    cpuReservation?: string;
    memoryReservation?: string;
  };

  @Column({ name: 'exposed_port', nullable: true })
  exposedPort?: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
