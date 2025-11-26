import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, OneToMany } from 'typeorm';
import { ProjectResource } from './project-resource.entity';
import { Environment } from './environment.entity';

@Entity('projects')
export class Project {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ unique: true })
  name: string;

  @Column({ name: 'base_domain' })
  baseDomain: string;

  @OneToMany(() => ProjectResource, (resource) => resource.project, { cascade: true })
  resources: ProjectResource[];

  @OneToMany(() => Environment, (environment) => environment.project)
  environments: Environment[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
