import { setTimeout as delay } from 'node:timers/promises';

const MAILPIT_URL = process.env.E2E_MAILPIT_URL ?? 'http://127.0.0.1:8025';
type EmailKind = 'verification' | 'reset';
type MessageSummary = { ID: string; Subject: string; To: { Address: string }[] };

/** Read delivered fixture mail, never production logs or token hashes. */
export async function waitForEmailToken(email: string, kind: EmailKind): Promise<string> {
  const subject = kind === 'verification' ? 'Verify your Planora email' : 'Reset your Planora password';
  {
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      const search = new URL('/api/v1/search', MAILPIT_URL);
      search.searchParams.set('query', 'to:' + email);
      const response = await fetch(search, { signal: AbortSignal.timeout(5_000) });
      if (!response.ok) throw new Error('E2E mail sink search failed with ' + response.status);
      const body = await response.json() as { messages: MessageSummary[] };
      const message = body.messages.find((item) =>
        item.Subject === subject && item.To.some((recipient) => recipient.Address === email));
      if (message) {
        const detail = await fetch(new URL('/api/v1/message/' + encodeURIComponent(message.ID), MAILPIT_URL),
          { signal: AbortSignal.timeout(5_000) });
        if (!detail.ok) throw new Error('E2E mail sink message failed with ' + detail.status);
        const delivered = await detail.json() as { Text: string };
        const link = delivered.Text.match(/https?:\/\/[^\s<>"']+/g)?.find((url) => {
          const parsed = new URL(url);
          return parsed.origin === new URL(process.env.E2E_FRONTEND_URL ?? 'http://127.0.0.1:3000').origin
            && parsed.pathname === (kind === 'verification' ? '/auth/verify-email' : '/auth/reset-password')
            && parsed.searchParams.has('token');
        });
        const token = link && new URL(link).searchParams.get('token');
        if (!token) throw new Error('Delivered E2E mail did not contain the expected action link');
        const removed = await fetch(new URL('/api/v1/messages', MAILPIT_URL), {
          method: 'DELETE', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ IDs: [message.ID] }), signal: AbortSignal.timeout(5_000),
        });
        if (!removed.ok) throw new Error('Could not remove consumed E2E mail');
        return token;
      }
      await delay(500);
    }
    throw new Error('Expected E2E ' + kind + ' email was not delivered within 30 seconds');
  }
}
