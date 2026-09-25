'use client';

import { Bell, Check, X } from 'lucide-react';
import { useEffect, useState } from 'react';

type Notification = { id: string; severity: string; title: string; body: string; targetPath?: string; occurredAt: string; readAt?: string };

export function NotificationCenter() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Notification[]>([]);

  async function load() {
    const response = await fetch('/api/notifications', { cache: 'no-store' });
    const payload = await response.json().catch(() => ({}));
    if (response.ok && payload.ok) setItems(payload.data.notifications || []);
  }
  useEffect(() => { void load(); }, []);

  async function update(id: string, action: 'read' | 'dismiss') {
    await fetch(`/api/notifications/${id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action }) });
    await load();
  }

  const unread = items.filter((item) => !item.readAt).length;
  return <div className="notification-center"><button className="icon-button" type="button" aria-expanded={open} onClick={() => setOpen((value) => !value)}><Bell size={16}/>{unread ? <span className="notification-count">{unread}</span> : null}<span className="sr-only">Notifications</span></button>{open ? <div className="notification-popover"><header><strong>Notifications</strong><span>{unread} unread</span></header>{items.length ? items.slice(0, 12).map((item) => <article key={item.id} className={`notification-item ${item.severity}`}><div><strong>{item.title}</strong><p>{item.body}</p><small>{new Date(item.occurredAt).toLocaleString()}</small></div><div className="notification-actions">{item.targetPath ? <a href={item.targetPath} onClick={() => update(item.id, 'read')}>Open</a> : null}{!item.readAt ? <button type="button" onClick={() => update(item.id, 'read')}><Check size={13}/><span className="sr-only">Mark read</span></button> : null}<button type="button" onClick={() => update(item.id, 'dismiss')}><X size={13}/><span className="sr-only">Dismiss</span></button></div></article>) : <p className="empty-compact">No notifications.</p>}</div> : null}</div>;
}
