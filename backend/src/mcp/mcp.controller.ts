import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { SessionGuard } from '../auth/auth.guard';
import { McpMovideskService } from './mcp-movidesk.service';

@UseGuards(SessionGuard)
@Controller('mcp/movidesk')
export class McpController {
  constructor(private readonly mcpMovidesk: McpMovideskService) {}

  @Get('status')
  status() {
    return this.mcpMovidesk.getStatus();
  }

  @Get('tools')
  listTools() {
    return this.mcpMovidesk.listTools();
  }

  @Get('prompts')
  listPrompts() {
    return this.mcpMovidesk.listPrompts();
  }

  @Post('prompts/:name/get')
  getPrompt(
    @Param('name') name: string,
    @Body('arguments') args?: Record<string, unknown>,
  ) {
    return this.mcpMovidesk.getPrompt(name, args ?? {});
  }

  @Post('tools/:name/call')
  callTool(
    @Param('name') name: string,
    @Body('arguments') args?: Record<string, unknown>,
  ) {
    return this.mcpMovidesk.callTool(name, args ?? {});
  }
}
