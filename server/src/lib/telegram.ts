import { config } from '../config.js';

// Minimal Telegram Bot API client. Create a bot with @BotFather and set TELEGRAM_BOT_TOKEN.

export function telegramEnabled() {
  return !!config.telegramToken;
}

async function call(method: string, body: BodyInit, headers: Record<string, string> = {}) {
  const res = await fetch(`https://api.telegram.org/bot${config.telegramToken}/${method}`, {
    method: 'POST',
    body,
    headers,
    signal: AbortSignal.timeout(30_000),
  });
  const json = (await res.json().catch(() => ({}))) as { ok?: boolean; description?: string; result?: unknown };
  if (!json.ok) throw new Error(json.description ?? `Telegram ${method} failed (${res.status})`);
  return json.result;
}

export async function sendTelegramMessage(chatId: string, html: string) {
  if (!telegramEnabled()) return;
  await call('sendMessage', JSON.stringify({ chat_id: chatId, text: html, parse_mode: 'HTML', disable_web_page_preview: true }), {
    'content-type': 'application/json',
  });
}

export async function sendTelegramDocument(chatId: string, fileName: string, data: Buffer, caption?: string) {
  if (!telegramEnabled()) return;
  const form = new FormData();
  form.set('chat_id', chatId);
  if (caption) form.set('caption', caption);
  form.set('document', new Blob([new Uint8Array(data)]), fileName);
  await call('sendDocument', form);
}

/** Finds the chat id of whoever sent "/start <code>" to the bot recently. */
export async function findChatIdByCode(code: string): Promise<string | null> {
  if (!telegramEnabled()) return null;
  const updates = (await call('getUpdates', JSON.stringify({ allowed_updates: ['message'] }), { 'content-type': 'application/json' })) as {
    message?: { text?: string; chat?: { id: number } };
  }[];
  const match = updates.reverse().find((u) => u.message?.text?.trim() === `/start ${code}`);
  return match?.message?.chat?.id != null ? String(match.message.chat.id) : null;
}

export function escapeHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
