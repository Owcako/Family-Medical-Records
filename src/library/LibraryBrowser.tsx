import {useRef, useState} from 'react'
import type {ReactNode} from 'react'
import {dimensions} from '../import/types'
import type {Dimension, MedicalFile, Profile} from '../import/types'
import type {Labels} from '../import/strings'
import {fileBranches, groupFiles, memberIdentity, memberOptions, needsAttention, needsMemberReview, unresolvedFields} from './browsing'
import type {FileBranch} from './browsing'

export type BrowseState = {dimension: Dimension; member: string; attention: boolean}

export function LibraryBrowser ({files, profiles, labels: t, state, onChange, selected, onSelect, loading, error, onRefresh, onAddMember, onEditMember, onRemoveMember, onReviewMember}: {
  files: MedicalFile[]; profiles: Profile[]; labels: Labels; state: BrowseState; onChange: (state: BrowseState) => void
  selected: string | null; onSelect: (id: string) => void; loading: boolean; error: string; onRefresh: () => void
  onAddMember: () => void; onEditMember: (profile: Profile) => void; onRemoveMember: (profile: Profile) => void; onReviewMember: (file: MedicalFile) => void
})
{
  const tabs = useRef<HTMLDivElement> (null)
  const [collapsed, setCollapsed] = useState<Record<string, boolean>> ({})
  const options = memberOptions (profiles)
  const selectedProfile = profiles.find (profile => state.member === `profile:${profile.id}`)
  const memberFiles = files.filter (file => !state.member || memberIdentity (file, profiles) === state.member)
  const attentionCount = memberFiles.filter (file => needsAttention (file) || needsMemberReview (file, profiles)).length
  const visible = memberFiles.filter (file => !state.attention || needsAttention (file) || needsMemberReview (file, profiles))
  const groups = groupFiles (visible, state.dimension, profiles)
  const branches = fileBranches (groups, state.dimension)

  function branch (group: FileBranch): ReactNode
  {
    const id = `${state.dimension}:${group.id}`
    const label = group.kind === 'unknown-month' ? t.unknownMonth : group.kind === 'month' ? t.months[Number (group.value) - 1] :
      group.placement === 'unknown' ? (state.dimension === 'member' ? t.unassigned : t.unknown) : group.value
    return <details className={`file-group file-branch placement-${group.placement}`} key={id} open={!collapsed[id]}>
      <summary onClick={event => {event.preventDefault (); setCollapsed (old => ({...old, [id]: !old[id]}))}}>
        <span className="branch-arrow" aria-hidden="true">›</span><span className="branch-folder" aria-hidden="true">▱</span><span className="branch-label">{label}</span>
        {group.placement === 'tentative' && <span className="placement-badge">{t.tentative}</span>}<span className="branch-count">{group.files.length}</span>
      </summary>
      <div className="branch-contents">{group.children ? group.children.map (branch) : group.files.map (file => {
        const missing = unresolvedFields (file)
        const member = file.metadata?.member
        const date = file.metadata?.date
        const profile = profiles.find (profile => memberIdentity (file, profiles) === `profile:${profile.id}`)
        const review = needsMemberReview (file, profiles)
        return <div className="file-entry" key={file.id}><button data-file-id={file.id} className={`file-row ${selected === file.id ? 'selected' : ''}`} onClick={() => onSelect (file.id)} aria-label={`${t.open}: ${file.title}`} aria-current={selected === file.id ? 'true' : undefined}>
          <span className="file-icon" aria-hidden="true">{file.media.startsWith ('image') ? '▧' : '▤'}</span>
          <span className="file-info"><strong>{file.title}</strong>
            <small>{profile?.name ?? t.unassigned} · {date?.status === 'known' ? date.values.map (item => item.value).join (' / ') : `${t.date}: ${t.unknown}`}</small>
            {member?.values.length && (!profile || profile.name !== member.values[0].value) ? <small>{t.detectedMember}: {member.values.map (item => item.value).join (' / ')}</small> : null}
            {review && <small className="unresolved-text">{t.memberReviewRequired}</small>}
            <small className={file.status === 'failed' ? 'error-text' : ''}>{t[file.status]}{file.status !== 'filed' ? ` · ${t[file.stage as keyof Labels] ?? file.stage}` : ''}</small>
            {missing.length > 0 && <small className="unresolved-text">{t.unresolvedFields}: {missing.map (key => `${t[key]} (${file.metadata?.[key].status === 'ambiguous' ? t.uncertainField : t.missingField})`).join (' · ')}</small>}
            {file.concerns.length > 0 && <small className="unresolved-text">{t.concerns}: {file.concerns.length}</small>}
            {file.check_status !== 'checked' && <small className="unresolved-text">{file.check_status === 'failed' ? t.checkFailed : t.stale}</small>}
            {file.extraction_status === 'failed' && <small className="error-text">{t.extraction}: {t.failed}</small>}
            {file.archive.index_state !== 'current' && <small className="unresolved-text">{t.indexPending}</small>}
            {file.metadata && dimensions.some (key => file.metadata![key].provenance === 'user_supplied') && <small>{t.supplied}</small>}
          </span><span aria-hidden="true">↗</span>
        </button>{review && <button className="review-member-button" onClick={() => onReviewMember (file)}>{t.reviewMember}: {file.title}</button>}</div>
      })}</div>
    </details>
  }

  return <section aria-labelledby="library-title" className="library-browser">
    <div className="library-heading"><h2 id="library-title">{t.library} <span>{files.length}</span></h2><button className="quiet" onClick={onRefresh}>{t.refresh} ↻</button></div>
    <div className="filters">
      <div className="segmented" aria-label={t.filter}>
        <button aria-pressed={!state.attention} className={!state.attention ? 'active' : ''} onClick={() => onChange ({...state, attention: false})}>{t.all}</button>
        <button aria-pressed={state.attention} className={state.attention ? 'active' : ''} onClick={() => onChange ({...state, attention: true})}>{t.unresolved} <span>{attentionCount}</span></button>
      </div>
      <div className="member-toolbar"><label className="member-filter">{t.member}<select aria-label={t.member} value={state.member} onChange={event => onChange ({...state, member: event.target.value})}>
        <option value="">{t.allMembers}</option>
        {state.member && !options.some (option => option.id === state.member) && <option value={state.member}>{t.unavailableMember}</option>}
        {options.map (option => <option key={option.id} value={option.id}>{option.name}</option>)}
      </select></label>
      <details className="member-actions"><summary aria-label={`${t.memberActions}: ${selectedProfile?.name ?? t.allMembers}`}>{t.memberActions} ▾</summary><div className="member-action-options">
        <button disabled={!selectedProfile} onClick={event => {event.currentTarget.closest ('details')!.open = false; onEditMember (selectedProfile!)}}>{t.editMember}</button>
        <button disabled={!selectedProfile} onClick={event => {event.currentTarget.closest ('details')!.open = false; onRemoveMember (selectedProfile!)}}>{t.removeMember}</button>
      </div></details>
      <button className="add-member-button" onClick={onAddMember}>＋ {t.addMember}</button></div>
    </div>
    <div ref={tabs} className="tabs browse-tabs" role="tablist" aria-label={t.library} onKeyDown={event => {
      const index = dimensions.indexOf (state.dimension)
      const next = event.key === 'ArrowRight' ? (index + 1) % dimensions.length : event.key === 'ArrowLeft' ? (index + dimensions.length - 1) % dimensions.length : event.key === 'Home' ? 0 : event.key === 'End' ? dimensions.length - 1 : -1
      if (next < 0) return
      event.preventDefault ()
      onChange ({...state, dimension: dimensions[next]})
      tabs.current?.querySelectorAll ('button')[next].focus ()
    }}>{dimensions.map (key => <button id={`browse-${key}`} aria-controls="browse-results" role="tab" tabIndex={state.dimension === key ? 0 : -1} aria-selected={state.dimension === key} key={key} onClick={() => onChange ({...state, dimension: key})}>{t[key]}</button>)}</div>
    <div id="browse-results" role="tabpanel" aria-labelledby={`browse-${state.dimension}`} aria-busy={loading} tabIndex={0}>
      {error && <div className="notice error" role="alert">{files.length ? t.readError : t.failedLoad} <p>{error}</p><button onClick={onRefresh}>{t.refresh}</button></div>}
      {loading ? <p className="empty" role="status">{t.loading}</p> : !files.length && !error ? <div className="empty"><div className="empty-symbol" aria-hidden="true">▤</div><h3>{t.empty}</h3><p>{t.emptyBody}</p></div> : !visible.length && !error ? <div className="empty" role="status"><h3>{t.noMatch}</h3><p>{t.emptyViewBody}</p>{(state.member || state.attention) && <button onClick={() => onChange ({...state, member: '', attention: false})}>{t.clearFilters}</button>}</div> : <>
        <p className="browse-context">{state.attention ? t.attentionHelp : t.browseHelp}</p>
        <p className="result-count" role="status">{t.documents}: {visible.length} · {t[state.dimension]}: {branches.length}</p>
        <div className="file-tree">{branches.map (branch)}</div>
      </>}
    </div>
  </section>
}
