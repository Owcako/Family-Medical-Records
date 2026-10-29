import {useRef, useState} from 'react'
import {json, request} from './api'
import type {Configuration, MedicalFile} from './types'
import type {Labels} from './strings'

type Action = {kind: 'files'; files: File[]; keys: string[]} | {kind: 'text'; text: string; title: string; key: string}

// Architecture: ui-flow.svg#U1 (picker), #U2 (local draft), #U3 (disclosure).
export function ImportPanel ({config, labels: t, onStored, onDirty}: {
  config: Configuration; labels: Labels; onStored: (file: MedicalFile) => void; onDirty: (dirty: boolean) => void
})
{
  const input = useRef<HTMLInputElement> (null)
  const [accept, setAccept] = useState ('')
  const [editing, setEditing] = useState (false)
  const [title, setTitle] = useState ('')
  const [text, setText] = useState ('')
  const [action, setAction] = useState<Action | null> (null)
  const [disclosure, setDisclosure] = useState (false)
  const [busy, setBusy] = useState (false)
  const [error, setError] = useState ('')

  function pick (formats: string)
  {
    // ui-flow.svg#U1: use the browser picker; each selected file stays independent.
    setAccept (formats)
    if (input.current)
    {
      input.current.accept = formats
      input.current.click ()
    }
  }

  async function submit (next: Action)
  {
    // ui-flow.svg#U3: keep the action local until the disclosure revision is accepted.
    if (sessionStorage.getItem ('processingConsent') !== config.disclosure)
    {
      setAction (next)
      setDisclosure (true)
      return
    }
    setBusy (true)
    setError ('')
    setAction (next)
    const headers = {'X-Processing-Consent': config.disclosure}
    // ui-flow.svg#U4: retain operation keys across retries, including uncertain responses.
    try
    {
      if (next.kind === 'files')
      {
        for (let i = 0; i < next.files.length; i++)
        {
          const body = new FormData ()
          body.append ('file', next.files[i])
          onStored (await request<MedicalFile> ('/imports', {method: 'POST', body, headers: {...headers, 'Idempotency-Key': next.keys[i]}}))
        }
      }
      else
      {
        // ui-flow.svg#U2: new text leaves draft state only after explicit Save is confirmed.
        const options = json ({title: next.title, text: next.text})
        onStored (await request<MedicalFile> ('/texts', {...options, method: 'POST', headers: {...options.headers, ...headers, 'Idempotency-Key': next.key}}))
        setEditing (false)
        setText ('')
        setTitle ('')
        onDirty (false)
      }
      setAction (null)
    }
    catch (error)
    {
      setError ((error as Error).message)
    }
    finally
    {
      setBusy (false)
    }
  }

  return <section className="import-card">
    <div className="eyebrow">{t.library}</div>
    <h1>{t.add}</h1>
    <p className="intro">{t.intro}</p>
    <div className="import-actions">
      <button disabled={busy} onClick={() => pick ('.jpg,.jpeg,.png,.webp')}><span aria-hidden="true">▧</span>{t.photo}</button>
      <button disabled={busy} onClick={() => pick ('.pdf')}><span aria-hidden="true">▤</span>{t.pdf}</button>
      <button disabled={busy} onClick={() => pick ('.txt')}><span aria-hidden="true">≡</span>{t.textFile}</button>
      <button disabled={busy} onClick={() => setEditing (true)}><span aria-hidden="true">＋</span>{t.newText}</button>
    </div>
    <small>{t.limits}</small>
    <input ref={input} type="file" hidden multiple accept={accept} onChange={event => {
      const files = Array.from (event.target.files ?? [])
      if (files.length) void submit ({kind: 'files', files, keys: files.map (() => crypto.randomUUID ())})
      event.target.value = ''
    }} />
    {error && <div role="alert" className="notice error">{t.savingFailed}: {error}
      {action && <button disabled={busy} onClick={() => void submit (action)}>{t.uploadRetry}</button>}
    </div>}
    {editing && <div className="new-draft">
      <h2>{t.draft}</h2>
      <label>{t.title}<input maxLength={200} value={title} disabled={busy} onChange={event => {setTitle (event.target.value); onDirty (true)}} /></label>
      <label>{t.text}<textarea rows={8} maxLength={config.max_text} value={text} disabled={busy} onChange={event => {setText (event.target.value); onDirty (true)}} /></label>
      <div className="actions"><button className="primary" disabled={busy || !title.trim () || !text.trim ()} onClick={() => void submit ({kind: 'text', title, text, key: action?.kind === 'text' && action.title === title && action.text === text ? action.key : crypto.randomUUID ()})}>{busy ? t.saving : t.saveNew}</button>
        <button disabled={busy} onClick={() => {if (!text && !title || window.confirm (t.unsaved)) {setEditing (false); setTitle (''); setText (''); onDirty (false)}}}>{t.cancel}</button></div>
    </div>}
    {disclosure && <div className="modal-backdrop"><section className="modal" role="dialog" aria-modal="true" aria-labelledby="disclosure-title">
      <h2 id="disclosure-title">{t.disclosure}</h2><p>{t.disclosureBody}</p><div className="service">{config.service}</div><p>{t.disclosureEnd}</p>
      <div className="actions"><button className="primary" autoFocus onClick={() => {
        sessionStorage.setItem ('processingConsent', config.disclosure)
        setDisclosure (false)
        if (action) void submit (action)
      }}>{t.agree}</button><button onClick={() => {setDisclosure (false); setAction (null)}}>{t.cancel}</button></div>
    </section></div>}
  </section>
}
