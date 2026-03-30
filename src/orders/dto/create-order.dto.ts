import { IsString, IsArray, IsOptional, IsEnum, IsNumber, IsUUID, Min, ValidateNested, ArrayMinSize } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum UserType {
  VISITOR = 'visitor',
  EXHIBITOR = 'exhibitor',
}

export class OrderItemDto {
  @ApiProperty({ example: '550e8400-e29b-41d4-a716-446655440000' })
  @IsUUID()
  ticket_type_id: string;

  @ApiProperty({ example: 2, minimum: 1 })
  @IsNumber()
  @Min(1)
  quantity: number;
}

export class CreateOrderDto {
  @ApiPropertyOptional({ description: 'Supabase auth user ID' })
  @IsOptional()
  @IsString()
  user_id?: string;

  @ApiProperty({ example: 'visitor@example.com' })
  @IsString()
  user_email: string;

  @ApiProperty({ example: 'John Doe' })
  @IsString()
  holder_name: string;

  @ApiProperty({ enum: UserType, example: 'visitor' })
  @IsEnum(UserType)
  user_type: UserType;

  @ApiProperty({ type: [OrderItemDto], description: 'Ticket items to purchase' })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => OrderItemDto)
  items: OrderItemDto[];
}
