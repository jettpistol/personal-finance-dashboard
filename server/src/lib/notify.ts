import { db } from '../db/index.js';
import { config } from '../config.js';
import { loadUsers } from './domain.js';
import { escapeHtml, sendTelegramDocument, sendTelegramMessage } from './telegram.js';

export type NotifyKind = 'budget' | 'recurring' | 'review' | 'system';

type Notice = {
  kind: NotifyKind;
  /** Recipients; null means every user. */
  users: number[] | null;
  title: string;
  body: string;
  link?: string;
  document?: { fileName: string; data: Buffer };
};

const PREF: Record<NotifyKind, 'notify_budget' | 'notify_recurring' | 'notify_review' | null> = {
  budget: 'notify_budget',
  recurring: 'notify_recurring',
  review: 'notify_review',
  system: null,
};

/** Stores an in-app notification and, where the user opted in, sends it on Telegram. Never throws. */
export async function notify(n: Notice) {
  const users = loadUsers().filter((u) => n.users === null || n.users.includes(u.id));
  const insert = db().prepare('INSERT INTO notifications (user_id, kind, title, body, link) VALUES (?, ?, ?, ?, ?)');
  for (const u of users) {
    insert.run(u.id, n.kind, n.title, n.body, n.link ?? null);
    const pref = PREF[n.kind];
    if (!u.telegram_chat_id || (pref && !u[pref])) continue;
    try {
      const url = n.link && config.publicUrl ? `\n${config.publicUrl}${n.link}` : '';
      if (n.document) {
        await sendTelegramDocument(u.telegram_chat_id, n.document.fileName, n.document.data, `${n.title}\n${n.body}`.slice(0, 1000));
      } else {
        await sendTelegramMessage(u.telegram_chat_id, `<b>${escapeHtml(n.title)}</b>\n${escapeHtml(n.body)}${escapeHtml(url)}`);
      }
    } catch (e) {
      console.error(`Telegram delivery to user ${u.id} failed:`, (e as Error).message);
    }
  }
}
