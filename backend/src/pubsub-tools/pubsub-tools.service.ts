import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PubSub } from '@google-cloud/pubsub';
import { PublishTrierOrderDto } from './pubsub-tools.dto';

const LEGACY_TRIER_TOPIC =
  'platform-service-tpc-order-to-trier-sistemas-legacy-prd';
const LEGACY_CONFIG_FIELDS = new Set(['api_url', 'default_delivery_fee']);

function buildChannelInConfig(dto: PublishTrierOrderDto) {
  const extraConfig = { ...(dto.extraConfig ?? {}) };
  const isLegacyTrier = dto.topic === LEGACY_TRIER_TOPIC;

  if (!isLegacyTrier) {
    for (const field of LEGACY_CONFIG_FIELDS) {
      delete extraConfig[field];
    }
  }

  return {
    ...(dto.token ? { token: dto.token } : {}),
    ...(isLegacyTrier && dto.apiUrl ? { api_url: dto.apiUrl } : {}),
    ...(isLegacyTrier && dto.defaultDeliveryFee
      ? { default_delivery_fee: dto.defaultDeliveryFee }
      : {}),
    ...extraConfig,
  };
}

function redactChannelInConfig(config: Record<string, unknown>) {
  const redacted = { ...config };

  for (const field of ['token', 'client_secret']) {
    if (typeof redacted[field] === 'string') {
      redacted[field] = '***redacted***';
    }
  }

  return redacted;
}

@Injectable()
export class PubsubToolsService {
  private readonly logger = new Logger(PubsubToolsService.name);

  async publishTrierOrder(dto: PublishTrierOrderDto) {
    const projectId = process.env.PUBSUB_PROJECT_ID?.trim();
    const credentialsFile = process.env.PUBSUB_CREDENTIALS_FILE?.trim();

    if (!projectId) {
      throw new BadRequestException('PUBSUB_PROJECT_ID não configurado.');
    }

    const pubsub = new PubSub({
      projectId,
      ...(credentialsFile ? { keyFilename: credentialsFile } : {}),
    });

    const channelInConfig = buildChannelInConfig(dto);

    const message: Record<string, unknown> = {
      order_id: dto.orderId,
      channel_in_config: JSON.stringify(channelInConfig),
    };
    if (dto.sendOrderToChannelIn) {
      message.send_order_to_channel_in = true;
    }

    this.logger.log(
      `Publishing Trier order ${dto.orderId} to ${dto.topic} with config ${JSON.stringify(
        redactChannelInConfig(channelInConfig),
      )}`,
    );

    try {
      const messageId = await pubsub
        .topic(dto.topic, { messageOrdering: true })
        .publishMessage({ json: message });

      return {
        success: true,
        topic: dto.topic,
        messageId,
        orderId: dto.orderId,
        message,
      };
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error
          ? error.message
          : 'Erro ao publicar mensagem no Pub/Sub.',
      );
    }
  }
}
