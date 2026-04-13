import { IsNumber, IsOptional, IsString, IsDateString, Min, Max } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class LocationUpdateDto {
  @ApiProperty({ description: 'Latitude (-90 to 90)', example: -20.1575 })
  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude: number;

  @ApiProperty({ description: 'Longitude (-180 to 180)', example: 28.5833 })
  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude: number;

  @ApiProperty({ description: 'GPS accuracy in meters', example: 10.5 })
  @IsNumber()
  @Min(0)
  accuracy: number;

  @ApiPropertyOptional({ description: 'Altitude in meters' })
  @IsOptional()
  @IsNumber()
  altitude?: number;

  @ApiPropertyOptional({ description: 'Speed in m/s' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  speed?: number;

  @ApiPropertyOptional({ description: 'Heading in degrees (0-360)' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(360)
  heading?: number;

  @ApiProperty({ description: 'ISO timestamp when location was captured on device' })
  @IsDateString()
  recordedAt: string;

  @ApiPropertyOptional({ description: 'Network type (wifi, 4g, 5g)' })
  @IsOptional()
  @IsString()
  networkType?: string;

  @ApiPropertyOptional({ description: 'Connected WiFi SSID' })
  @IsOptional()
  @IsString()
  wifiSsid?: string;

  @ApiPropertyOptional({ description: 'Signal strength (RSSI in dBm)' })
  @IsOptional()
  @IsNumber()
  signalStrength?: number;

  @ApiPropertyOptional({ description: 'Client-generated idempotency key' })
  @IsOptional()
  @IsString()
  idempotencyKey?: string;
}

export class BatchLocationUpdateDto {
  @ApiProperty({ type: [LocationUpdateDto] })
  locations: LocationUpdateDto[];
}
