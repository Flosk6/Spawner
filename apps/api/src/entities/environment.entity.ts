import { Entity, Column, PrimaryColumn, CreateDateColumn, OneToMany, ManyToOne, JoinColumn } from 'typeorm';
import { EnvironmentResource } from './environment-resource.entity';
import { Project } from './project.entity';
import type { EnvironmentStatus } from '@spawner/types';

@Entity('environments')
export class Environment {
  @PrimaryColumn()
  id: string;

  @Column({ unique: true })
  name: string;

  @Column({ name: 'project_id', nullable: true })
  projectId: number;

  @ManyToOne(() => Project, (project) => project.environments, { onDelete: 'CASCADE', nullable: true })
  @JoinColumn({ name: 'project_id' })
  project: Project;

  @Column()
  status: EnvironmentStatus;

  @Column({ type: 'text', name: 'config_json' })
  configJson: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @OneToMany(() => EnvironmentResource, resource => resource.environment, {
    cascade: true,
    eager: true,
  })
  resources: EnvironmentResource[];
}
