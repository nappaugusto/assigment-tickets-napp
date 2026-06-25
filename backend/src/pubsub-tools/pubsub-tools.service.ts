import { BadRequestException, Injectable } from '@nestjs/common';
import { PubSub } from '@google-cloud/pubsub';
import { PublishTrierOrderDto } from './pubsub-tools.dto';

@Injectable()
export class PubsubToolsService {
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

    const channelInConfig = {
      token: dto.token,
      api_url: dto.apiUrl,
      default_delivery_fee: dto.defaultDeliveryFee,
      ...(dto.extraConfig ?? {}),
    };

    const message = {
      order_id: dto.orderId,
      channel_in_config: JSON.stringify(channelInConfig),
    };

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
