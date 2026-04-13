import { IsNumber, IsOptional, IsDateString, Min, Max } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';

export class HeatmapQueryDto {
  @ApiProperty({ description: 'Viewport minimum latitude' })
  @IsNumber()
  @Min(-90)
  @Max(90)
  @Transform(({ value }) => parseFloat(value))
  minLat: number;

  @ApiProperty({ description: 'Viewport minimum longitude' })
  @IsNumber()
  @Min(-180)
  @Max(180)
  @Transform(({ value }) => parseFloat(value))
  minLng: number;

  @ApiProperty({ description: 'Viewport maximum latitude' })
  @IsNumber()
  @Min(-90)
  @Max(90)
  @Transform(({ value }) => parseFloat(value))
  maxLat: number;

  @ApiProperty({ description: 'Viewport maximum longitude' })
  @IsNumber()
  @Min(-180)
  @Max(180)
  @Transform(({ value }) => parseFloat(value))
  maxLng: number;

  @ApiPropertyOptional({ description: 'Start time (ISO string), defaults to 5 minutes ago' })
  @IsOptional()
  @IsDateString()
  since?: string;

  @ApiPropertyOptional({ description: 'End time (ISO string), defaults to now' })
  @IsOptional()
  @IsDateString()
  until?: string;
}

export class ZoneTrafficQueryDto {
  @ApiPropertyOptional({ description: 'Start time (ISO string), defaults to 1 hour ago' })
  @IsOptional()
  @IsDateString()
  since?: string;

  @ApiPropertyOptional({ description: 'Zone type filter' })
  @IsOptional()
  zoneType?: string;
}

export class HistoricalQueryDto {
  @ApiProperty({ description: 'Start date (ISO string)' })
  @IsDateString()
  startDate: string;

  @ApiProperty({ description: 'End date (ISO string)' })
  @IsDateString()
  endDate: string;

  @ApiPropertyOptional({ description: 'Zone ID filter' })
  @IsOptional()
  zoneId?: string;

  @ApiPropertyOptional({ description: 'Interval in minutes (5, 15, 60)', default: 60 })
  @IsOptional()
  @IsNumber()
  @Transform(({ value }) => parseInt(value))
  intervalMinutes?: number;
}
