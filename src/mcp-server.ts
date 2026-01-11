import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { TaskExecutor } from './core/TaskExecutor.js';
import { FileSystemService } from './services/FileSystemService.js';
import { CodexTelegramBot, CommandHandler } from './telegram/index.js';
import { config } from 'dotenv';

config();

const CreateTaskSchema = z.object({
  description: z.string(),
  type: z.enum(['code', 'analysis', 'documentation']).default('code'),
});

class McpServer {
  private server: Server;
  private taskExecutor: TaskExecutor;
  private telegramBot?: CodexTelegramBot;
  private commandHandler?: CommandHandler;

  constructor() {
    this.server = new Server(
      {
        name: 'god-agent',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.taskExecutor = new TaskExecutor(new FileSystemService());
    this.setupTelegramBot();
    this.setupHandlers();
  }

  private setupTelegramBot(): void {
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;

    if (botToken && chatId) {
      console.log('Initializing Telegram bot...');
      this.telegramBot = new CodexTelegramBot({
        botToken,
        chatId
      });
      
      this.commandHandler = new CommandHandler(this.telegramBot, this.taskExecutor);
    } else {
      console.log('Telegram bot credentials not found. Skipping Telegram integration.');
    }
  }

  private setupHandlers(): void {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      const tools: Tool[] = [
        {
          name: 'create_task',
          description: 'Create and execute a new task using the CODEX system',
          inputSchema: {
            type: 'object',
            properties: {
              description: {
                type: 'string',
                description: 'Detailed description of the task to execute',
              },
              type: {
                type: 'string',
                enum: ['code', 'analysis', 'documentation'],
                description: 'Type of task to execute',
                default: 'code',
              },
            },
            required: ['description'],
          },
        },
      ];

      return { tools };
    });

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      switch (name) {
        case 'create_task': {
          const parsed = CreateTaskSchema.parse(args);
          
          const taskId = `mcp_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
          
          try {
            const result = await this.taskExecutor.submitTask({
              id: taskId,
              description: parsed.description,
              type: parsed.type,
              metadata: {
                source: 'mcp',
                timestamp: Date.now()
              }
            });

            return {
              content: [
                {
                  type: 'text',
                  text: `Task ${taskId} submitted successfully. Result: ${JSON.stringify(result, null, 2)}`,
                },
              ],
            };
          } catch (error) {
            return {
              content: [
                {
                  type: 'text',
                  text: `Failed to execute task: ${error instanceof Error ? error.message : 'Unknown error'}`,
                },
              ],
              isError: true,
            };
          }
        }

        default:
          throw new Error(`Unknown tool: ${name}`);
      }
    });
  }

  async start(): Promise<void> {
    const transport = new StdioServerTransport();
    
    if (this.telegramBot) {
      console.log('Starting Telegram bot...');
      await this.telegramBot.start();
    }

    console.log('Starting MCP server...');
    await this.server.connect(transport);
  }

  async stop(): Promise<void> {
    if (this.telegramBot) {
      console.log('Stopping Telegram bot...');
      await this.telegramBot.stop();
    }
    
    console.log('MCP server stopped');
  }
}

const server = new McpServer();

process.on('SIGINT', async () => {
  console.log('Received SIGINT, shutting down gracefully...');
  await server.stop();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('Received SIGTERM, shutting down gracefully...');
  await server.stop();
  process.exit(0);
});

server.start().catch((error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});