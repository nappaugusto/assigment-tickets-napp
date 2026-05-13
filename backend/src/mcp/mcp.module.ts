import { Module } from '@nestjs/common';
import { McpController } from './mcp.controller';
import { McpMovideskService } from './mcp-movidesk.service';

@Module({
  controllers: [McpController],
  providers: [McpMovideskService],
  exports: [McpMovideskService],
})
export class McpModule {}
