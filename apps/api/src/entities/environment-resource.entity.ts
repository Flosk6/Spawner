import { Entity, Column, PrimaryColumn, ManyToOne, JoinColumn, CreateDateColumn } from 'typeorm';
import { Environment } from './environment.entity';
import type { ResourceType } from '@spawner/types';

@Entity('environment_resources')
export class EnvironmentResource {
  @PrimaryColumn()
  id: string;

  @Column({ name: 'environment_id' })
  environmentId: string;

  @Column({ name: 'resource_name' })
  resourceName: string;

  @Column({ name: 'resource_type' })
  resourceType: ResourceType;

  @Column({ nullable: true })
  branch: string;

  @Column({ nullable: true })
  url: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @ManyToOne(() => Environment, environment => environment.resources, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'environment_id' })
  environment: Environment;
}
