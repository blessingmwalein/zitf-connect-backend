import { IsString, IsNumber, IsBoolean, IsOptional, IsEnum, IsDateString, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { TicketCategory } from './create-ticket-type.dto.js';

export class UpdateTicketTypeDto {
  @ApiPropertyOptional({ example: 'VIP Pass - Visitor' })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ example: 50.0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  price?: number;

  @ApiPropertyOptional({ example: 'USD' })
  @IsOptional()
  @IsString()
  currency?: string;

  @ApiPropertyOptional({ example: 500 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  max_quantity?: number;

  @ApiPropertyOptional({ enum: TicketCategory })
  @IsOptional()
  @IsEnum(TicketCategory)
  ticket_category?: TicketCategory;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  valid_from?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  valid_until?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}
