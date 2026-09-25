'use client';

import { MessageSquareText } from 'lucide-react';
import { useEffect, useState } from 'react';

type Comment = { id: string; authorId: string; body: string; context: string; createdAt: string };

export function ProjectCommentsPanel({ projectId }: { projectId: string }) {
  const [comments, setComments] = useState<Comment[]>([]);
  const [body, setBody] = useState('');
  const [message, setMessage] = useState<string>();
  async function load() {
    const response = await fetch(`/api/projects/${projectId}/comments`, { cache: 'no-store' });
    const payload = await response.json();
    if (!response.ok || !payload.ok) throw new Error(payload.error?.message || 'Comments unavailable.');
    setComments(payload.data.comments || []);
  }
  useEffect(() => { load().catch((error) => setMessage(error.message)); }, [projectId]);
  async function add() {
    const response = await fetch(`/api/projects/${projectId}/comments`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ body, context: 'cabinet_review' }) });
    const payload = await response.json();
    if (!response.ok || !payload.ok) { setMessage(payload.error?.message || 'Comment could not be saved.'); return; }
    setBody(''); setMessage('Review comment saved with authenticated authorship.'); await load();
  }
  return <section className="inspector-card comments-card"><header><h2>Review comments</h2><MessageSquareText size={15}/></header><div className="comment-list">{comments.length ? comments.map((comment) => <article key={comment.id}><strong>{comment.authorId}</strong><p>{comment.body}</p><small>{new Date(comment.createdAt).toLocaleString()}</small></article>) : <p className="microcopy">No project comments yet.</p>}</div><label><span>Add comment</span><textarea rows={3} value={body} onChange={(event) => setBody(event.target.value)}/></label><button className="button secondary" type="button" disabled={!body.trim()} onClick={add}>Save review comment</button>{message ? <p className="outreach-message" role="status">{message}</p> : null}</section>;
}
