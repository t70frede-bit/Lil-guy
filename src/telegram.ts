// A tiny Telegram Bot API client with no dependencies: long polling, messages and buttons.

export interface Button { text: string; data: string }
export interface Update {
  update_id: number;
  message?: { message_id: number; chat: { id: number }; text?: string };
  callback_query?: { id: string; data?: string; message?: { message_id: number; chat: { id: number } } };
}

export class Telegram {
  private base: string;
  constructor(token: string) { this.base = `${process.env.TELEGRAM_API_BASE ?? "https://api.telegram.org"}/bot${token}`; }

  private async call<T>(method: string, body: Record<string, unknown>): Promise<T> {
    const res = await fetch(`${this.base}/${method}`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    });
    const json = (await res.json()) as { ok: boolean; result: T; description?: string };
    if (!json.ok) throw new Error(`Telegram ${method} failed: ${json.description}`);
    return json.result;
  }

  getUpdates(offset: number, timeout = 30) {
    return this.call<Update[]>("getUpdates", { offset, timeout, allowed_updates: ["message", "callback_query"] });
  }

  send(chatId: number, text: string, buttons?: Button[]) {
    return this.call<{ message_id: number }>("sendMessage", {
      chat_id: chatId, text,
      ...(buttons ? { reply_markup: { inline_keyboard: [buttons.map(b => ({ text: b.text, callback_data: b.data }))] } } : {}),
    });
  }

  answer(callbackId: string, text?: string) {
    return this.call("answerCallbackQuery", { callback_query_id: callbackId, text });
  }

  clearButtons(chatId: number, messageId: number) {
    return this.call("editMessageReplyMarkup", { chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: [] } });
  }
}
