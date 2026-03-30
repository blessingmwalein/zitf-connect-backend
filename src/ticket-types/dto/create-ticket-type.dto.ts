import { IsString, IsNumber, IsBoolean, IsOptional, IsEnum, IsDateString, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum TicketCategory {
  VISITOR = 'visitor',
  EXHIBITOR = 'exhibitor',
}

export class CreateTicketTypeDto {
  @ApiProperty({ example: 'General Admission - Visitor' })
  @IsString()
  name: string;

  @ApiPropertyOptional({ example: 'Standard entry ticket for visitors' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ example: 10.0 })
  @IsNumber()
  @Min(0)
  price: number;

  @ApiPropertyOptional({ example: 'USD', default: 'USD' })
  @IsOptional()
  @IsString()
  currency?: string = 'USD';

  @ApiPropertyOptional({ example: 5000 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  max_quantity?: number;

  @ApiProperty({ enum: TicketCategory, example: 'visitor' })
  @IsEnum(TicketCategory)
  ticket_category: TicketCategory;

  @ApiPropertyOptional({ example: '2025-04-22T08:00:00Z' })
  @IsOptional()
  @IsDateString()
  valid_from?: string;

  @ApiPropertyOptional({ example: '2025-04-26T18:00:00Z' })
  @IsOptional()
  @IsDateString()
  valid_until?: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  is_active?: boolean = true;
}
