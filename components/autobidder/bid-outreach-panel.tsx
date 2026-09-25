'use client';

import { MailCheck, Send } from 'lucide-react';
import { useEffect, useState } from 'react';

type ProviderState = { provider: string | null; status: string; message: string };
type Outreach = { id: string; status: string; recipient: string; subject: string; body: string; sentAt?: string | null };
type ExportArtifact = { id: string; format: string; audience: string; status: string; generatedAt?: string | null };

async function responseData(response: Response) {
  const payload = await response.json();
  if (!response.ok || !payload.ok) throw new Error(payload.error?.message || `Request failed with HTTP ${response.status}.`);
  return payload.data;
}

export function BidOutreachPanel(props: { projectId: string; jobId: string; projectName: string }) {
  const [provider, setProvider] = useState<ProviderState>();
  const [outreach, setOutreach] = useState<Outreach[]>([]);
  const [companyName, setCompanyName] = useState('Customer');
  const [recipient, setRecipient] = useState('');
  const [scope, setScope] = useState(`Cabinet package for ${props.projectName}`);
  const [inclusions, setInclusions] = useState('Cabinet casework');
  const [exclusions, setExclusions] = useState('Countertops\nField installation unless noted');
  const [assumptions, setAssumptions] = useState('Field dimensions will be verified before release');
  const [artifacts, setArtifacts] = useState<ExportArtifact[]>([]);
  const [attachmentIds, setAttachmentIds] = useState<string[]>([]);
  const [signature, setSignature] = useState('Vulpine Estimating');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();

  async function refresh() {
    const [data, exports] = await Promise.all([
      responseData(await fetch(`/api/backoffice/projects/${props.projectId}/outreach`, { cache: 'no-store' })),
      responseData(await fetch(`/api/jobs/${props.jobId}/export`, { cache: 'no-store' })),
    ]);
    setProvider(data.provider); setOutreach(data.outreach || []); setArtifacts((exports.artifacts || []).filter((item: ExportArtifact) => item.status === 'ready'));
  }

  useEffect(() => { refresh().catch((error) => setMessage(error.message)); }, [props.projectId]);

  async function prepare() {
    setBusy(true); setMessage(undefined);
    try {
      const data = await responseData(await fetch(`/api/backoffice/projects/${props.projectId}/outreach`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'prepare', jobId: props.jobId, companyName, recipient, scope,
          inclusions: inclusions.split('\n').map((item) => item.trim()).filter(Boolean),
          exclusions: exclusions.split('\n').map((item) => item.trim()).filter(Boolean),
          assumptions: assumptions.split('\n').map((item) => item.trim()).filter(Boolean),
          attachmentIds, estimatorSignature: signature,
        }),
      }));
      setOutreach((current) => [data.outreach, ...current.filter((item) => item.id !== data.outreach.id)]);
      setMessage('Approved canonical total synchronized and outreach draft prepared. Nothing has been sent.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not prepare outreach.'); }
    finally { setBusy(false); }
  }

  async function sendDraft() {
    const draft = outreach.find((item) => item.status === 'draft');
    if (!draft) return;
    setBusy(true); setMessage(undefined);
    try {
      const data = await responseData(await fetch(`/api/backoffice/projects/${props.projectId}/outreach`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'send', outreachId: draft.id, confirmation }),
      }));
      setOutreach((current) => current.map((item) => item.id === draft.id ? data.outreach : item));
      setConfirmation(''); setMessage('The configured provider accepted the approved bid outreach.');
      await refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not send outreach.'); }
    finally { setBusy(false); }
  }

  const draft = outreach.find((item) => item.status === 'draft');
  const connected = provider?.status === 'connected';
  return <section className="inspector-card outreach-card">
    <header><h2>Bid outreach</h2><MailCheck size={15}/></header>
    <p className="microcopy">The deal amount is copied server-side from the approved canonical estimate. Preparing a draft never sends email.</p>
    <label><span>Customer company</span><input value={companyName} onChange={(event) => setCompanyName(event.target.value)}/></label>
    <label><span>Recipient</span><input type="email" value={recipient} onChange={(event) => setRecipient(event.target.value)} placeholder="buyer@example.com"/></label>
    <label><span>Scope</span><textarea rows={3} value={scope} onChange={(event) => setScope(event.target.value)}/></label>
    <label><span>Inclusions · one per line</span><textarea rows={2} value={inclusions} onChange={(event) => setInclusions(event.target.value)}/></label>
    <label><span>Exclusions · one per line</span><textarea rows={2} value={exclusions} onChange={(event) => setExclusions(event.target.value)}/></label>
    <label><span>Assumptions · one per line</span><textarea rows={2} value={assumptions} onChange={(event) => setAssumptions(event.target.value)}/></label>
    <fieldset className="outreach-attachments"><legend>Generated attachments</legend>{artifacts.length ? artifacts.map((artifact) => <label key={artifact.id}><input type="checkbox" checked={attachmentIds.includes(artifact.id)} onChange={(event) => setAttachmentIds((current) => event.target.checked ? [...current, artifact.id] : current.filter((id) => id !== artifact.id))}/><span>{artifact.format.toUpperCase()} · {artifact.audience.replaceAll('_', ' ')}</span></label>) : <p className="microcopy">No generated exports are available yet. The draft can be prepared without an attachment.</p>}</fieldset>
    <label><span>Estimator signature</span><input value={signature} onChange={(event) => setSignature(event.target.value)}/></label>
    <button className="button secondary" type="button" disabled={busy || !recipient || !scope || !companyName || !signature} onClick={prepare}>{busy ? 'Working…' : 'Prepare approved draft'}</button>
    {draft ? <div className="outreach-preview"><strong>{draft.subject}</strong><span>To {draft.recipient}</span><pre>{draft.body}</pre></div> : null}
    <div className="provider-truth"><span>Email delivery</span><strong className={connected ? 'status-good' : 'status-muted'}>{provider?.status?.replaceAll('_', ' ') || 'checking'}</strong></div>
    {draft && connected ? <><label><span>Type SEND_APPROVED_BID_OUTREACH</span><input value={confirmation} onChange={(event) => setConfirmation(event.target.value)}/></label><button className="button primary" type="button" disabled={busy || confirmation !== 'SEND_APPROVED_BID_OUTREACH'} onClick={sendDraft}><Send size={14}/> Send approved bid</button></> : null}
    {draft && !connected ? <p className="microcopy">Draft retained locally. Sending stays disabled until a verified email provider is configured.</p> : null}
    {message ? <p className="outreach-message" role="status">{message}</p> : null}
  </section>;
}
