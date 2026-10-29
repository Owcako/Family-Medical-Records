import {lazy, Suspense, useEffect, useImperativeHandle, useRef, useState} from 'react'
import type {Ref} from 'react'
import {json, request} from './api'
import {dimensions} from './types'
import type {MedicalFile, Profile} from './types'
import type {Labels} from './strings'
import {memberIdentity, needsMemberReview} from '../library/browsing'

const PdfSource = lazy (() => import ('./PdfSource'))

export type ViewerHandle = {leave: (action: () => void) => void; openSaved: () => void}

// Architecture: ui-flow.svg#U6 (inspection), #U7/#U8/#U9 (explicit actions).
export function Viewer ({ref, file, profiles, labels: t, onUpdate, onDelete, onBack, onDirty, consent, resolveMember, onResolveDone, onReviewMember}: {
  ref?: Ref<ViewerHandle>
  file: MedicalFile; profiles: Profile[]; labels: Labels; onUpdate: (file: MedicalFile) => void
  onDelete: () => void; onBack: () => void; onDirty: (dirty: boolean) => void; consent: () => boolean
  resolveMember: boolean; onResolveDone: () => void; onReviewMember: () => void
})
{
  const [tab, setTab] = useState ('current')
  const [editing, setEditing] = useState (resolveMember)
  const [editRevision, setEditRevision] = useState (file.revision)
  const [text, setText] = useState (file.text ?? '')
  const [member, setMember] = useState (file.metadata?.member.values[0]?.value ?? '')
  const [date, setDate] = useState (file.metadata?.date.values[0]?.value ?? '')
  const [department, setDepartment] = useState (file.metadata?.department.values.map (item => item.value).join (', ') ?? '')
  const [disease, setDisease] = useState (file.metadata?.disease.values.map (item => item.value).join (', ') ?? '')
  const [busy, setBusy] = useState (false)
  const [error, setError] = useState ('')
  const [zoom, setZoom] = useState (100)
  const [textZoom, setTextZoom] = useState (100)
  const [baseline, setBaseline] = useState ({text, member, date, department, disease})
  const [pending, setPending] = useState<{action: (saved?: MedicalFile) => void | Promise<void>} | null> (null)
  const dialog = useRef<HTMLDialogElement> (null)
  const dirty = editing && (text !== baseline.text || member !== baseline.member || date !== baseline.date || department !== baseline.department || disease !== baseline.disease)
  const processing = file.status === 'pending' || file.status === 'processing'
  const profile = profiles.find (profile => memberIdentity (file, profiles) === `profile:${profile.id}`)
  const sourceUrl = `/api/files/${encodeURIComponent (file.id)}/original`

  useEffect (() => {onDirty (dirty)}, [dirty, onDirty])
  useEffect (() => {
    if (pending) dialog.current?.showModal ()
    else dialog.current?.close ()
  }, [pending])

  function beforeAction (action: (saved?: MedicalFile) => void | Promise<void>)
  {
    if (busy) return
    if (dirty) setPending ({action})
    else action ()
  }

  useImperativeHandle (ref, () => ({leave: beforeAction, openSaved: () => setTab ('current')}))

  function beginEdit ()
  {
    // ui-flow.svg#U7: capture the exact saved revision being edited. Polling may
    // update props, but must not replace a draft or silently advance its version.
    setEditRevision (file.revision)
    setText (file.text ?? '')
    setMember (file.metadata?.member.values[0]?.value ?? '')
    setDate (file.metadata?.date.values[0]?.value ?? '')
    setDepartment (file.metadata?.department.values.map (item => item.value).join (', ') ?? '')
    setDisease (file.metadata?.disease.values.map (item => item.value).join (', ') ?? '')
    setBaseline ({text: file.text ?? '', member: file.metadata?.member.values[0]?.value ?? '', date: file.metadata?.date.values[0]?.value ?? '',
      department: file.metadata?.department.values.map (item => item.value).join (', ') ?? '', disease: file.metadata?.disease.values.map (item => item.value).join (', ') ?? ''})
    setTab ('current')
    setError ('')
    setEditing (true)
  }

  async function save ()
  {
    // ui-flow.svg#U7: save the editor revision; retain the local draft on failure.
    setBusy (true)
    setError ('')
    try
    {
      const updated = await request<MedicalFile> (`/files/${encodeURIComponent (file.id)}/manual`, {method: 'PUT', ...json ({
        revision: editRevision, text, member_name: member, date,
        department: department.split (',').map (value => value.trim ()).filter (Boolean),
        disease: disease.split (',').map (value => value.trim ()).filter (Boolean),
      })})
      onDirty (false)
      setEditing (false)
      onUpdate (updated)
      setPending (null)
      await pending?.action (updated)
    }
    catch (error) {setError ((error as Error).message)}
    finally {setBusy (false)}
  }

  async function recheck (saved = file)
  {
    if (!consent ()) return
    setBusy (true)
    setError ('')
    try
    {
      const options = json ({revision: saved.revision})
      onUpdate (await request<MedicalFile> (`/files/${encodeURIComponent (saved.id)}/recheck`, {method: 'POST', ...options,
        headers: {...options.headers, 'X-Processing-Consent': sessionStorage.getItem ('processingConsent') ?? ''}}))
    }
    catch (error) {setError ((error as Error).message)}
    finally {setBusy (false)}
  }

  async function retry ()
  {
    // ui-flow.svg#U8: resume the same pending identity after renewed consent if needed.
    if (!consent ()) return
    setBusy (true)
    setError ('')
    try
    {
      onUpdate (await request<MedicalFile> (`/files/${encodeURIComponent (file.id)}/retry`, {method: 'POST', headers: {'X-Processing-Consent': sessionStorage.getItem ('processingConsent') ?? ''}}))
    }
    catch (error) {setError ((error as Error).message)}
    finally {setBusy (false)}
  }

  async function remove ()
  {
    // ui-flow.svg#U9: name/confirm the target, then wait for backend deletion.
    if (!window.confirm (`${t.deleteQuestion}\n\n${file.title}`)) return
    setBusy (true)
    setError ('')
    try
    {
      await request (`/files/${encodeURIComponent (file.id)}`, {method: 'DELETE'})
      onDirty (false)
      onDelete ()
    }
    catch (error) {setError ((error as Error).message)}
    finally {setBusy (false)}
  }

  return <section className="viewer">
    <button className="back" disabled={busy} onClick={onBack}>← {t.back}</button>
    <div className="eyebrow">{t[file.status]}</div><h2>{file.title}</h2>
    {/* ../../backend/database-schema.svg#D2: show archive ownership separately from document facts. */}
    <div className="notice archive-context" aria-label={t.archive}>
      <strong>{t.archive}: {file.archive.title}</strong>
      <p>{profile?.name ?? t.unassigned} · {file.archive.date_label ?? t.unknown} · {file.archive.department_code} · {t.documents}: {file.archive.document_count}</p>
      {file.archive.patient_status === 'conflict' && <p role="alert">{t.identityConflict}</p>}
      {file.archive.index_state !== 'current' && <p role="status">{t.indexPending}{file.archive.index_error && `: ${file.archive.index_error}`}</p>}
    </div>
    {processing && <p className="notice" role="status">{t.processingNote} {t.stage}: {t[file.stage as keyof Labels] ?? file.stage}</p>}
    {file.error && <div className="notice error" role="alert">{file.error}</div>}
    {file.extraction_error && file.extraction_error !== file.error && <div className="notice error">{t.extraction}: {file.extraction_error}</div>}
    <dl className="classifications">{dimensions.map (dimension => {
      const field = file.metadata?.[dimension]
      return <div key={dimension}><dt>{t[dimension]}</dt><dd>{dimension === 'member' ? profile?.name ?? t.unassigned : field?.values.length ? field.values.map (value => value.value).join (' · ') : t.unknown}
        {dimension === 'member' && field?.values.length ? <small>{t.detectedMember}: {field.values.map (value => value.value).join (' · ')}</small> : null}
        {(dimension !== 'disease' || field?.status === 'known') && <small>{field?.provenance === 'user_supplied' ? t.supplied : field?.provenance === 'ai_classified' ? t.aiClassified : field?.status === 'known' ? t.printed : t.unresolvedFields}</small>}
        {field?.provenance === 'ai_classified' && <details><summary>{t.classificationEvidence}</summary>{field.values.map ((value, index) => <p key={index}><q>{value.quote}</q></p>)}</details>}
        {field?.status === 'ambiguous' && <details><summary>{t.tentative}</summary>{field.candidates.map ((value, index) => <p key={index}>{value.value}<br /><q>{value.quote}</q></p>)}</details>}
      </dd></div>
    })}</dl>
    {file.metadata?.member.status === 'ambiguous' && <p className="notice">{t.ambiguous}</p>}
    {!editing && needsMemberReview (file, profiles) && <div className="notice"><p>{t.memberReviewRequired}</p><button onClick={onReviewMember}>{t.reviewMember}</button></div>}
    <div className="tabs" role="tablist" aria-label={t.text}>{['current', 'initial', 'source'].map (name =>
      <button key={name} role="tab" aria-selected={tab === name} onClick={() => setTab (name)}>{t[name as 'current' | 'initial' | 'source']}</button>)}</div>
    {tab === 'source' ? <div className="source-view">
      <a href={sourceUrl} target="_blank" rel="noreferrer">{t.source} ↗</a>
      {file.media.startsWith ('image/') ? <><label>{t.zoom} {zoom}%<input type="range" min="50" max="250" value={zoom} onChange={event => setZoom (Number (event.target.value))} /></label><div className="image-scroll"><img src={sourceUrl} alt={file.title} style={{width: `${zoom}%`, maxWidth: 'none'}} onError={() => setError (t.sourceError)} /></div></> : file.media === 'application/pdf' ?
        <Suspense fallback={<p role="status">{t.loadingPdf}</p>}><PdfSource url={sourceUrl} labels={t} /></Suspense> : <iframe title={file.title} src={sourceUrl} />}
    </div> : <><label className="text-zoom">{t.textZoom} {textZoom}%<input type="range" min="80" max="200" value={textZoom} onChange={event => setTextZoom (Number (event.target.value))} /></label>{tab === 'initial' ? <pre className="document-text" style={{fontSize: `${13 * textZoom / 100}px`}}>{file.initial_text ?? t.noInitial}</pre> : editing ? <div className="editor">
      <p>{t.manual}</p>
      {resolveMember && <p className="notice">{t.correctMemberHelp}</p>}
      <label>{t.member}<input disabled={busy} value={member} list="member-names" maxLength={500} onChange={event => setMember (event.target.value)} /></label>
      <datalist id="member-names">{profiles.map (profile => <option key={profile.id} value={profile.name} />)}</datalist>
      <label>{t.date}<input disabled={busy} value={date} onChange={event => setDate (event.target.value)} /></label>
      <label>{t.department}<input disabled={busy} value={department} onChange={event => setDepartment (event.target.value)} /></label>
      <label>{t.disease}<input disabled={busy} value={disease} onChange={event => setDisease (event.target.value)} /></label><small>{t.separator}</small>
      <label>{t.text}<textarea disabled={busy} aria-label={t.text} rows={14} value={text} style={{fontSize: `${13 * textZoom / 100}px`}} maxLength={100000} onChange={event => setText (event.target.value)} /></label>
      <div className="actions"><button className="primary" disabled={busy || !text.trim ()} onClick={() => void save ()}>{busy ? t.saving : t.save}</button><button disabled={busy} onClick={() => {
        beforeAction (() => {
          setEditing (false)
          onDirty (false)
          onResolveDone ()
        })
      }}>{t.cancel}</button></div>
    </div> : <><div className="text-provenance">{t[file.text_origin as 'imported' | 'user_entered' | 'user_edited']}</div><pre className="document-text" style={{fontSize: `${13 * textZoom / 100}px`}}>{file.text ?? t.noText}</pre></>}</>}
    <div className="check-results" aria-live="polite">
      <h3>{file.check_status === 'checked' ? file.concerns.length ? t.concerns : t.checked : file.check_status === 'failed' ? t.checkFailed : t.stale}</h3>
      {file.check_error && <p role="alert">{file.check_error}</p>}
      {file.check_status !== 'checked' && (file.concerns.length > 0 || file.checked_text_revision != null) && <p>{t.previousCheck}</p>}
      {file.concerns.map ((concern, index) => <blockquote key={index}><q>{concern.quote}</q><small>{t.textLocation}: {concern.start + 1}–{concern.end}</small><p>{concern.reason}</p></blockquote>)}
      {file.check_status === 'checked' && !file.concerns.length && <p>{t.noConcerns}</p>}
    </div>
    {error && <div className="notice error" role="alert">{error}</div>}
    <div className="actions viewer-actions">
      {!editing && <button className="primary" disabled={busy || processing} onClick={beginEdit}>{t.edit}</button>}
      <button disabled={busy || processing || (!dirty && !file.text?.trim ())} onClick={() => beforeAction (saved => {setEditing (false); return recheck (saved)})}>{busy ? t.checking : t.recheck}</button>
      {file.status === 'failed' && !editing && <button disabled={busy} onClick={() => void retry ()}>{t.retry}</button>}
      <button className="danger" disabled={busy || editing} onClick={() => void remove ()}>{t.delete}</button>
    </div>
    <dialog ref={dialog} className="modal profile-dialog" aria-labelledby="unsaved-title" onCancel={event => {event.preventDefault (); if (!busy) setPending (null)}}>
      <h2 id="unsaved-title">{t.unsavedTitle}</h2><p>{file.title}</p><p>{t.unsavedChoice}</p>
      {error && <p className="notice error" role="alert">{error}</p>}
      <div className="actions"><button className="primary" disabled={busy || !text.trim ()} onClick={() => void save ()}>{t.saveContinue}</button>
        <button disabled={busy} onClick={() => {const action = pending?.action; setPending (null); setEditing (false); onDirty (false); action?. ()}}>{t.discardContinue}</button>
        <button disabled={busy} onClick={() => setPending (null)}>{t.stay}</button></div>
    </dialog>
  </section>
}
