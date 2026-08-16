export interface TelegramVoiceAttachment {
  file_id: string;
  file_unique_id?: string;
  duration?: number;
  mime_type?: string;
  file_size?: number;
}

export interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    text?: string;
    caption?: string;
    voice?: TelegramVoiceAttachment;
    audio?: TelegramVoiceAttachment;
    chat: { id: number; type: string };
    from?: { id: number; username?: string };
    reply_to_message?: { message_id: number };
  };
  callback_query?: {
    id: string;
    from: { id: number };
    message?: { chat: { id: number; type: string }; message_id: number };
    data?: string;
  };
}

export interface TelegramClient {
  getMe(): Promise<{ id: string; username: string | null }>;
  getWebhookInfo(): Promise<{ url: string }>;
  getUpdates(input: {
    offset?: number;
    timeout: number;
    allowedUpdates: string[];
  }): Promise<TelegramUpdate[]>;
  sendMessage(input: {
    chatId: string;
    text: string;
    replyToMessageId?: number;
    parseMode?: "MarkdownV2" | "HTML";
  }): Promise<{ messageId: number }>;
  sendVoice(input: {
    chatId: string;
    voice: Buffer;
    filename: string;
    replyToMessageId?: number;
    caption?: string;
  }): Promise<{ messageId: number }>;
  downloadFile(fileId: string): Promise<{ buffer: Buffer; filename: string }>;
  sendChatAction(input: { chatId: string; action: "typing" | "record_voice" }): Promise<void>;
}

export type TelegramErrorKind = "auth" | "rate_limit" | "conflict" | "transient" | "validation";

export class TelegramApiError extends Error {
  constructor(
    readonly kind: TelegramErrorKind,
    message: string,
    readonly statusCode?: number,
  ) {
    super(message);
    this.name = "TelegramApiError";
  }
}

export function classifyTelegramError(statusCode: number, description: string): TelegramApiError {
  if (statusCode === 401 || description.includes("Unauthorized")) {
    return new TelegramApiError("auth", description, statusCode);
  }
  if (statusCode === 409) {
    return new TelegramApiError("conflict", description, statusCode);
  }
  if (statusCode === 429) {
    return new TelegramApiError("rate_limit", description, statusCode);
  }
  if (statusCode >= 500) {
    return new TelegramApiError("transient", description, statusCode);
  }
  return new TelegramApiError("validation", description, statusCode);
}
