import {
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  MinLength,
} from 'class-validator';

export const SUPPORTED_PUBSUB_TOPICS = [
  'platform-service-tpc-order-to-trier-sistemas-legacy-prd',
  'platform-service-tpc-order-to-trier-sistemas-prd',
  'platform-service-tpc-order-to-hos-sistemas-prd',
] as const;

export class PublishTrierOrderDto {
  @IsIn(SUPPORTED_PUBSUB_TOPICS)
  topic!: string;

  @IsString()
  @MinLength(3)
  @MaxLength(160)
  orderId!: string;

  @IsString()
  @MinLength(10)
  token!: string;

  @IsUrl({ require_tld: false, protocols: ['http', 'https'] })
  @MaxLength(2000)
  apiUrl!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(80)
  defaultDeliveryFee!: string;

  @IsOptional()
  @IsObject()
  extraConfig?: Record<string, unknown>;
}
