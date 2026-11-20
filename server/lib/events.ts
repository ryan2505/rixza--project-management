import type { Request, Response } from 'express';
import { canAccessProject } from './access.ts';
import type { SessionUser } from '../../shared/domain.ts';

// Server-Sent Events: tells open browsers *that* something changed in a project
// (never what) so they refetch through the normal authorised API.
interface Conn {
  user: SessionUser;
  res: Response;
}
const conns = new Set<Conn>();

export function streamHandler(req: Request, res: Response) {
  const user = req.user!;
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive' });
  res.flushHeaders();
  res.write('retry: 5000\n\n');
  const conn = { user, res };
  conns.add(conn);
  const ping = setInterval(() => res.write(': ping\n\n'), 25000);
  req.on('close', () => {
    clearInterval(ping);
    conns.delete(conn);
  });
}

export function broadcastProject(projectId: string | null, kind = 'change') {
  if (!projectId) return;
  for (const c of conns) {
    if (canAccessProject(c.user, projectId)) c.res.write(`data: ${JSON.stringify({ projectId, kind })}\n\n`);
  }
}

export function pushToUser(userId: string, kind: string) {
  for (const c of conns) if (c.user.id === userId) c.res.write(`data: ${JSON.stringify({ kind })}\n\n`);
}
