export interface TelegramMessage {
  message_id: number;
  from?: {
    id: number;
    is_bot: boolean;
    first_name: string;
    username?: string;
  };
  chat: {
    id: number;
    type: string;
    first_name?: string;
    username?: string;
  };
  date: number;
  text?: string;
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
}

export interface TelegramBotConfig {
  token: string;
  allowedUsers?: number[];
  webhookUrl?: string;
}

export interface TaskRequest {
  id: string;
  description: string;
  userId: number;
  chatId: number;
  timestamp: number;
}