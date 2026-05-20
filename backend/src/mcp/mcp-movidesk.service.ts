import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { existsSync } from 'fs';

interface McpConnection {
  client: Client;
  transport: StdioClientTransport;
}

type JsonRecord = Record<string, unknown>;

@Injectable()
export class McpMovideskService implements OnModuleDestroy {
  private readonly logger = new Logger(McpMovideskService.name);
  private connection: McpConnection | null = null;
  private connecting: Promise<McpConnection> | null = null;

  constructor(private readonly config: ConfigService) {}

  async onModuleDestroy(): Promise<void> {
    await this.closeConnection();
  }

  getStatus() {
    return {
      configured: this.isConfigured(),
      connected: !!this.connection,
      command: this.getCommand(),
      args: this.getArgs(),
      cwd: this.config.get<string>('MOVIDESK_MCP_CWD') || null,
      tokenConfigured: !!this.getToken(),
    };
  }

  async listTools() {
    const client = await this.getClient();
    return client.listTools();
  }

  async listPrompts() {
    const client = await this.getClient();
    return client.listPrompts();
  }

  async getPrompt(name: string, args: JsonRecord = {}) {
    if (!name?.trim()) {
      throw new BadRequestException('Nome do prompt MCP é obrigatório.');
    }

    const client = await this.getClient();
    return client.getPrompt({
      name: name.trim(),
      arguments: args as Record<string, string>,
    });
  }

  async callTool(name: string, args: JsonRecord = {}) {
    if (!name?.trim()) {
      throw new BadRequestException('Nome da ferramenta MCP é obrigatório.');
    }

    const client = await this.getClient();
    return client.callTool({
      name: name.trim(),
      arguments: args,
    });
  }

  private isConfigured(): boolean {
    return (
      !!this.getCommand() && this.getArgs().length > 0 && !!this.getToken()
    );
  }

  private getCommand(): string {
    return this.config.get<string>('MOVIDESK_MCP_COMMAND')?.trim() || 'node';
  }

  private getArgs(): string[] {
    const raw = this.config.get<string>('MOVIDESK_MCP_ARGS')?.trim() ?? '';
    if (!raw) {
      return this.resolveMcpArgs([]);
    }

    if (raw.startsWith('[')) {
      try {
        const parsed = JSON.parse(raw) as unknown;
        if (
          Array.isArray(parsed) &&
          parsed.every((item) => typeof item === 'string')
        ) {
          return this.resolveMcpArgs(parsed);
        }
      } catch {
        throw new BadRequestException(
          'MOVIDESK_MCP_ARGS deve ser um JSON array válido.',
        );
      }
    }

    const args =
      raw
        .match(/"[^"]+"|'[^']+'|\S+/g)
        ?.map((arg) => arg.replace(/^['"]|['"]$/g, '')) ?? [];
    return this.resolveMcpArgs(args);
  }

  private resolveMcpArgs(args: string[]): string[] {
    const bundledPath = '/app/mcp-movidesk/dist/index.js';
    if (args.length === 0) {
      return existsSync(bundledPath) ? [bundledPath] : [];
    }

    const entrypoint = args[0];
    if (
      entrypoint.startsWith('/') &&
      !existsSync(entrypoint) &&
      existsSync(bundledPath)
    ) {
      this.logger.warn(
        `MOVIDESK_MCP_ARGS aponta para arquivo inexistente (${entrypoint}); usando MCP empacotado.`,
      );
      return [bundledPath, ...args.slice(1)];
    }

    return args;
  }

  private getToken(): string {
    return (
      this.config.get<string>('MOVIDESK_TOKEN')?.trim() ||
      this.config.get<string>('MOVIDESK_API_TOKEN')?.trim() ||
      ''
    );
  }

  private getEnv(): Record<string, string> {
    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(process.env)) {
      if (typeof value === 'string') {
        env[key] = value;
      }
    }

    env.MOVIDESK_TOKEN = this.getToken();
    return env;
  }

  private async getClient(): Promise<Client> {
    if (this.connection) return this.connection.client;

    if (!this.isConfigured()) {
      throw new BadRequestException(
        'MCP Movidesk não configurado. Defina MOVIDESK_MCP_ARGS e MOVIDESK_TOKEN.',
      );
    }

    if (!this.connecting) {
      this.connecting = this.connect();
    }

    try {
      const connection = await this.connecting;
      return connection.client;
    } catch (error) {
      this.connecting = null;
      throw error;
    }
  }

  private async connect(): Promise<McpConnection> {
    const transport = new StdioClientTransport({
      command: this.getCommand(),
      args: this.getArgs(),
      env: this.getEnv(),
      cwd: this.config.get<string>('MOVIDESK_MCP_CWD') || undefined,
      stderr: 'pipe',
    });

    transport.stderr?.on('data', (chunk: Buffer) => {
      this.logger.debug(`MCP Movidesk stderr: ${chunk.toString().trim()}`);
    });

    const client = new Client(
      { name: 'assignment-tickets-napp', version: '1.0.0' },
      { capabilities: {} },
    );

    try {
      await client.connect(transport);
      this.connection = { client, transport };
      this.connecting = null;
      this.logger.log('MCP Movidesk conectado.');
      return this.connection;
    } catch (error) {
      await transport.close().catch(() => undefined);
      this.logger.error(
        `Erro ao conectar no MCP Movidesk: ${(error as Error).message}`,
      );
      throw new InternalServerErrorException(
        'Não foi possível conectar ao MCP Movidesk.',
      );
    }
  }

  private async closeConnection(): Promise<void> {
    const current = this.connection;
    this.connection = null;
    this.connecting = null;
    if (current) {
      await current.transport.close().catch(() => undefined);
    }
  }
}
