import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';

export enum PatchType {
  SECURITY = 'security',
  BUGFIX = 'bugfix',
  FEATURE = 'feature',
}

export enum PatchStatus {
  PENDING = 'pending',
  APPLIED = 'applied',
  FAILED = 'failed',
}

@Entity('server_patches')
export class ServerPatch {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  packageName: string;

  @Column()
  currentVersion: string;

  @Column()
  latestVersion: string;

  @Column({
    type: 'varchar',
    enum: PatchType,
    default: PatchType.FEATURE,
  })
  type: string;

  @Column({
    type: 'varchar',
    enum: PatchStatus,
    default: PatchStatus.PENDING,
  })
  status: string;

  @Column({ type: 'text', nullable: true })
  changelog: string;

  @Column({ type: 'timestamp', nullable: true })
  appliedAt: Date;

  @CreateDateColumn()
  detectedAt: Date;
}
