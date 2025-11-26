import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

export class AddSystemTables1732700000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'system_settings',
        columns: [
          {
            name: 'id',
            type: 'int',
            isPrimary: true,
            isGenerated: true,
            generationStrategy: 'increment',
          },
          {
            name: 'key',
            type: 'varchar',
            length: '255',
            isUnique: true,
          },
          {
            name: 'value',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'description',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'createdAt',
            type: 'timestamp',
            default: 'CURRENT_TIMESTAMP',
          },
          {
            name: 'updatedAt',
            type: 'timestamp',
            default: 'CURRENT_TIMESTAMP',
            onUpdate: 'CURRENT_TIMESTAMP',
          },
        ],
      }),
      true,
    );

    await queryRunner.createIndex(
      'system_settings',
      new TableIndex({
        name: 'IDX_SYSTEM_SETTINGS_KEY',
        columnNames: ['key'],
      }),
    );

    await queryRunner.createTable(
      new Table({
        name: 'server_patches',
        columns: [
          {
            name: 'id',
            type: 'int',
            isPrimary: true,
            isGenerated: true,
            generationStrategy: 'increment',
          },
          {
            name: 'packageName',
            type: 'varchar',
            length: '255',
          },
          {
            name: 'currentVersion',
            type: 'varchar',
            length: '255',
          },
          {
            name: 'latestVersion',
            type: 'varchar',
            length: '255',
          },
          {
            name: 'type',
            type: 'varchar',
            length: '50',
            default: "'feature'",
          },
          {
            name: 'status',
            type: 'varchar',
            length: '50',
            default: "'pending'",
          },
          {
            name: 'changelog',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'appliedAt',
            type: 'timestamp',
            isNullable: true,
          },
          {
            name: 'detectedAt',
            type: 'timestamp',
            default: 'CURRENT_TIMESTAMP',
          },
        ],
      }),
      true,
    );

    await queryRunner.createIndex(
      'server_patches',
      new TableIndex({
        name: 'IDX_SERVER_PATCHES_STATUS',
        columnNames: ['status'],
      }),
    );

    await queryRunner.createIndex(
      'server_patches',
      new TableIndex({
        name: 'IDX_SERVER_PATCHES_TYPE',
        columnNames: ['type'],
      }),
    );

    await queryRunner.query(`
      INSERT INTO system_settings (key, value, description) VALUES
      ('AUTO_UPDATE_ENABLED', 'false', 'Enable automatic updates'),
      ('UPDATE_CHECK_CRON', '0 * * * *', 'Cron expression for update checks (hourly)'),
      ('AUTO_UPDATE_CRON', '0 0 * * *', 'Cron expression for automatic updates (daily at midnight)')
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropIndex('server_patches', 'IDX_SERVER_PATCHES_TYPE');
    await queryRunner.dropIndex('server_patches', 'IDX_SERVER_PATCHES_STATUS');
    await queryRunner.dropTable('server_patches');

    await queryRunner.dropIndex('system_settings', 'IDX_SYSTEM_SETTINGS_KEY');
    await queryRunner.dropTable('system_settings');
  }
}
