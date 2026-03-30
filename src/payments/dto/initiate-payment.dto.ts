import { IsString, IsNumber, IsEnum, IsOptional, IsUUID, Min, Matches } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum PaymentMethod {
  WEB = 'web',
  ECOCASH = 'ecocash',
  ONEMONEY = 'onemoney',
}

export class InitiatePaymentDto {
  @ApiProperty({ example: '550e8400-e29b-41d4-a716-446655440000' })
  @IsUUID()
  order_id: string;

  @ApiProperty({ enum: PaymentMethod, example: 'ecocash' })
  @IsEnum(PaymentMethod)
  payment_method: PaymentMethod;

  @ApiPropertyOptional({ example: '0771234567', description: 'Required for mobile money payments' })
  @IsOptional()
  @IsString()
  @Matches(/^07[0-9]{8}$/, { message: 'Phone number must be a valid Zimbabwean mobile number (e.g., 0771234567)' })
  phone_number?: string;
}

export class InitiateStandPaymentDto {
  @ApiProperty({ example: '550e8400-e29b-41d4-a716-446655440000' })
  @IsUUID()
  exhibitor_id: string;

  @ApiProperty({ example: '550e8400-e29b-41d4-a716-446655440001' })
  @IsUUID()
  stand_id: string;

  @ApiProperty({ example: 250.0 })
  @IsNumber()
  @Min(0)
  amount: number;

  @ApiProperty({ enum: PaymentMethod, example: 'ecocash' })
  @IsEnum(PaymentMethod)
  payment_method: PaymentMethod;

  @ApiPropertyOptional({ example: '0771234567' })
  @IsOptional()
  @IsString()
  @Matches(/^07[0-9]{8}$/, { message: 'Phone number must be a valid Zimbabwean mobile number' })
  phone_number?: string;

  @ApiPropertyOptional({ example: 'user@example.com' })
  @IsOptional()
  @IsString()
  user_email?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  feature_ids?: string[];
}
