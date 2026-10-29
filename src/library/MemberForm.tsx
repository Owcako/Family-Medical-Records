import {useEffect, useRef, useState} from 'react'
import {json, request} from '../import/api'
import type {Profile} from '../import/types'
import type {Labels} from '../import/strings'

export type MemberDraft = {profile?: Profile; detectedName?: string}

export function MemberForm ({draft, labels: t, onSaved, onClose}: {
  draft: MemberDraft; labels: Labels; onSaved: (profile: Profile) => void; onClose: () => void
})
{
  const dialog = useRef<HTMLDialogElement> (null)
  const [name, setName] = useState (draft.profile?.name ?? draft.detectedName ?? '')
  const [aliases, setAliases] = useState (draft.profile?.aliases.join (', ') ?? '')
  const [busy, setBusy] = useState (false)
  const [error, setError] = useState ('')
  useEffect (() => {dialog.current?.showModal ()}, [])

  async function save ()
  {
    setBusy (true)
    setError ('')
    const values = aliases.split (',').map (value => value.trim ()).filter (Boolean)
    // Retain the reviewed printed name as an alias when a different display name
    // is chosen. The backend links the preserved evidence without rewriting text.
    if (draft.detectedName && draft.detectedName !== name.trim () && !values.includes (draft.detectedName)) values.push (draft.detectedName)
    try
    {
      const profile = await request<Profile> (draft.profile ? `/profiles/${draft.profile.id}` : '/profiles', {
        method: draft.profile ? 'PUT' : 'POST', ...json ({name: name.trim (), aliases: values}),
      })
      onSaved (profile)
    }
    catch (error) {setError ((error as Error).message); setBusy (false)}
  }

  return <dialog ref={dialog} className="modal profile-dialog" aria-labelledby="member-form-title" onCancel={event => {if (busy) event.preventDefault (); else onClose ()}}>
    <h2 id="member-form-title">{draft.profile ? t.editMember : t.addMember}</h2>
    {draft.detectedName && <p>{t.detectedMember}: <strong>{draft.detectedName}</strong>. {t.newMemberHelp}</p>}
    <form onSubmit={event => {event.preventDefault (); void save ()}}>
      <label>{t.name}<input autoFocus disabled={busy} value={name} maxLength={100} onChange={event => setName (event.target.value)} /></label>
      <label>{t.aliases}<input disabled={busy} value={aliases} onChange={event => setAliases (event.target.value)} /></label>
      {error && <p className="error-text" role="alert">{error}</p>}
      <div className="actions"><button className="primary" type="submit" disabled={busy || !name.trim ()}>{busy ? t.saving : draft.profile ? t.editMember : t.addMember}</button><button type="button" disabled={busy} onClick={onClose}>{t.cancel}</button></div>
    </form>
  </dialog>
}
