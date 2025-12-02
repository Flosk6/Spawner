import { IsObject, IsOptional } from 'class-validator';

export class UpdateEnvironmentDto {
  @IsObject()
  @IsOptional()
  branches?: Record<string, string>;
}
