import { db } from '../db/index.js';
import { config } from '../config.js';
import { loadUsers } from './domain.js';
import { escapeHtml, sendTelegramDocument, sendTelegramMessage } from './telegram.js';
import { mailEnabled, sendMail } from './mail.js';

export type NotifyKind = 'budget' | 'recurring' | 'review' | 'pending' | 'system';

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
  // Pagos pendientes chase you until done: always sent.
  pending: null,
  system: null,
};

/** Stores an in-app notification and, where the user opted in, sends it by email and/or Telegram. Never throws. */
export async function notify(n: Notice) {
  const users = loadUsers().filter((u) => n.users === null || n.users.includes(u.id));
  const insert = db().prepare('INSERT INTO notifications (user_id, kind, title, body, link) VALUES (?, ?, ?, ?, ?)');
  // Every bell entry first, before anything is awaited: an undoable action journals them all (lib/undo.ts).
  for (const u of users) insert.run(u.id, n.kind, n.title, n.body, n.link ?? null);
  for (const u of users) {
    const pref = PREF[n.kind];
    if (pref && !u[pref]) continue;
    const link = n.link && config.publicUrl ? `${config.publicUrl}${n.link}` : '';
    if (u.email && mailEnabled()) {
      try {
        await sendMail(u.email, n.title, `${n.body}${link ? `\n\n${link}` : ''}`, n.document);
      } catch (e) {
        console.error(`Email delivery to user ${u.id} failed:`, (e as Error).message);
      }
    }
    if (!u.telegram_chat_id) continue;
    try {
      const url = link ? `\n${link}` : '';
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
