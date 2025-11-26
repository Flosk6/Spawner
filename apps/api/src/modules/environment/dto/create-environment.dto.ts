import { IsString, IsNotEmpty, Matches, IsObject, IsBoolean, IsOptional } from 'class-validator';
import { VALIDATION } from '@spawner/config';

export class CreateEnvironmentDto {
  @IsString()
  @IsNotEmpty()
  @Matches(VALIDATION.ENVIRONMENT_NAME, {
    message: 'Environment name must contain only lowercase letters, numbers, and hyphens',
  })
  name: string;

  @IsObject()
  @IsNotEmpty()
  branches: Record<string, string>;

  @IsBoolean()
  @IsOptional()
  localMode?: boolean;
}
