import {useCallback, useEffect, useRef, useState} from 'react'
import {ImportPanel} from './import/ImportPanel'
import {Viewer} from './import/Viewer'
import type {ViewerHandle} from './import/Viewer'
import {request} from './import/api'
import {strings} from './import/strings'
import {dimensions} from './import/types'
import type {Configuration, MedicalFile, Profile} from './import/types'
import {LibraryBrowser} from './library/LibraryBrowser'
import type {BrowseState} from './library/LibraryBrowser'
import {MemberForm} from './library/MemberForm'
import type {MemberDraft} from './library/MemberForm'
import {MemberReview} from './library/MemberReview'
import {memberIdentity, memberReviewKey, needsMemberReview} from './library/browsing'
import './App.css'
import {ChatPanel} from './chat/ChatPanel'

function savedBrowseState (): BrowseState
{
  const saved = new URLSearchParams (sessionStorage.getItem ('libraryBrowse') ?? '')
  const dimension = dimensions.find (key => key === saved.get ('view')) ?? 'date'
  return {dimension, member: saved.get ('member') ?? '', attention: saved.get ('attention') === 'true'}
}

function selectedFile ()
{
  if (!location.hash.startsWith ('#/files/')) return null
  try {return decodeURIComponent (location.hash.slice (8))}
  catch {return location.hash.slice (8)}
}

// Architecture: ../implementation-architecture.svg#O1; UI stages: import/ui-flow.svg.
function App ()
{
  const [language, setLanguage] = useState<'en' | 'zh'> (() => localStorage.getItem ('language') === 'zh' ? 'zh' : 'en')
  const t = strings[language]
  const [config, setConfig] = useState<Configuration | null> (null)
  const [files, setFiles] = useState<MedicalFile[]> ([])
  const [profiles, setProfiles] = useState<Profile[]> ([])
  const [selected, setSelected] = useState<string | null> (selectedFile)
  const [chatFile, setChatFile] = useState<string | null> (selectedFile)
  const [browse, setBrowse] = useState<BrowseState> (savedBrowseState)
  const [loading, setLoading] = useState (true)
  const [error, setError] = useState ('')
  const [notice, setNotice] = useState<MedicalFile | null> (null)
  const [memberDraft, setMemberDraft] = useState<MemberDraft | null> (null)
  const [memberError, setMemberError] = useState ('')
  const [memberBusy, setMemberBusy] = useState (false)
  const [deferredMembers, setDeferredMembers] = useState<Set<string>> (new Set ())
  const [reviewTarget, setReviewTarget] = useState<string | null> (null)
  const [editMemberFile, setEditMemberFile] = useState<string | null> (null)
  const [dirty, setDirty] = useState (false)
  const [newDirty, setNewDirty] = useState (false)
  const [chatDirty, setChatDirty] = useState (false)
  const [phoneTab, setPhoneTab] = useState<'browser' | 'chat'> ('browser')
  const known = useRef<Record<string, string>> ({})
  const mutation = useRef (0)
  const refreshing = useRef (false)
  const browserScroll = useRef (0)
  const lastSelected = useRef<string | null> (selected)
  const viewer = useRef<ViewerHandle> (null)

  const refresh = useCallback (async () => {
    if (refreshing.current) return
    refreshing.current = true
    const version = mutation.current
    // import/ui-flow.svg#U5: poll backend-confirmed records, profiles, and configuration.
    try
    {
      const [nextFiles, nextProfiles, nextConfig] = await Promise.all ([request<MedicalFile[]> ('/files'), request<Profile[]> ('/profiles'), request<Configuration> ('/config')])
      if (version !== mutation.current) return
      for (const file of nextFiles)
      {
        if (known.current[file.id] && known.current[file.id] !== 'filed' && file.status === 'filed') setNotice (file)
        known.current[file.id] = file.status
      }
      setNotice (old => old ? nextFiles.find (file => file.id === old.id) ?? null : null)
      setFiles (nextFiles)
      setProfiles (nextProfiles)
      setConfig (nextConfig)
      setError ('')
    }
    catch (error) {setError ((error as Error).message)}
    finally {setLoading (false); refreshing.current = false}
  }, [])

  useEffect (() => {
    sessionStorage.setItem ('libraryBrowse', new URLSearchParams ({view: browse.dimension, member: browse.member, attention: String (browse.attention)}).toString ())
  }, [browse])

  useEffect (() => {
    if (!selected && lastSelected.current)
    {
      const id = lastSelected.current
      requestAnimationFrame (() => {
        document.querySelector<HTMLButtonElement> (`.file-row[data-file-id="${CSS.escape (id)}"]`)?.focus ({preventScroll: true})
        window.scrollTo (0, browserScroll.current)
      })
    }
    lastSelected.current = selected
  }, [selected])

  useEffect (() => {
    const initial = window.setTimeout (() => void refresh (), 0)
    const timer = window.setInterval (() => void refresh (), 1800)
    return () => {clearTimeout (initial); clearInterval (timer)}
  }, [refresh])

  useEffect (() => {
    document.documentElement.lang = language === 'zh' ? 'zh-CN' : 'en'
    localStorage.setItem ('language', language)
  }, [language])

  useEffect (() => {
    function leave (event: BeforeUnloadEvent)
    {
      // import/ui-flow.svg#U11: guard unsaved drafts during reload and navigation.
      if (dirty || newDirty || chatDirty) {event.preventDefault (); event.returnValue = ''}
    }
    function hash ()
    {
      const next = selectedFile ()
      if (dirty)
      {
        history.replaceState (null, '', selected ? `#/files/${encodeURIComponent (selected)}` : '#')
        viewer.current?.leave (() => {
          setDirty (false)
          setEditMemberFile (null)
          setSelected (next)
          if (next) setChatFile (next)
          history.pushState (null, '', next ? `#/files/${encodeURIComponent (next)}` : '#')
        })
        return
      }
      setDirty (false)
      setEditMemberFile (null)
      if (!selected && next) browserScroll.current = window.scrollY
      setSelected (next)
      if (next) setChatFile (next)
    }
    window.addEventListener ('beforeunload', leave)
    window.addEventListener ('hashchange', hash)
    return () => {window.removeEventListener ('beforeunload', leave); window.removeEventListener ('hashchange', hash)}
  }, [selected, t.unsaved, dirty, newDirty, chatDirty])

  function select (id: string | null)
  {
    // import/ui-flow.svg#U11: resolve one stable identity and preserve the current filters.
    if (id === selected) {viewer.current?.openSaved (); return}
    const open = () => {
      setDirty (false)
      setEditMemberFile (null)
      if (!selected && id) browserScroll.current = window.scrollY
      setSelected (id)
      if (id) setChatFile (id)
      history.pushState (null, '', id ? `#/files/${encodeURIComponent (id)}` : '#')
    }
    if (viewer.current) viewer.current.leave (open)
    else open ()
  }

  function updated (file: MedicalFile, open = true)
  {
    mutation.current++
    // import/ui-flow.svg#U5: immediate mutations use the actual backend receipt, not a guess.
    setFiles (old => [file, ...old.filter (item => item.id !== file.id)])
    setNotice (file)
    known.current[file.id] = file.status
    if (open && selected !== file.id) select (file.id)
  }

  function profileSaved (profile: Profile)
  {
    mutation.current++
    setProfiles (old => [...old.filter (item => item.id !== profile.id), profile])
    setMemberDraft (null)
    void refresh ()
  }

  async function removeProfile (profile: Profile)
  {
    if (!window.confirm (`${t.removeMemberQuestion}\n\n${profile.name}`)) return
    setMemberError ('')
    setMemberBusy (true)
    try
    {
      await request (`/profiles/${profile.id}`, {method: 'DELETE'})
      mutation.current++
      const related = files.filter (file => memberIdentity (file, profiles) === `profile:${profile.id}`)
      setDeferredMembers (old => new Set ([...old, ...related.map (memberReviewKey)]))
      setProfiles (old => old.filter (item => item.id !== profile.id))
      setBrowse (old => old.member === `profile:${profile.id}` ? {...old, member: ''} : old)
      await refresh ()
    }
    catch (error) {setMemberError ((error as Error).message)}
    finally {setMemberBusy (false)}
  }

  function consent ()
  {
    // import/ui-flow.svg#U3: Retry must also acknowledge the configured processing service.
    if (!config) return false
    if (sessionStorage.getItem ('processingConsent') === config.disclosure) return true
    if (!window.confirm (`${t.disclosureBody}\n\n${config.service}\n\n${t.disclosureEnd}`)) return false
    sessionStorage.setItem ('processingConsent', config.disclosure)
    return true
  }

  // import/ui-flow.svg#U6: four logical category views group the same saved identities.
  const current = files.find (file => file.id === selected)
  const reviewFile = !loading && !error && !memberDraft && !dirty && !newDirty && !chatDirty && !memberBusy && !editMemberFile ?
    files.find (file => needsMemberReview (file, profiles) && (reviewTarget === file.id || !deferredMembers.has (memberReviewKey (file)))) : undefined

  function deferReview (file: MedicalFile)
  {
    setDeferredMembers (old => new Set (old).add (memberReviewKey (file)))
    setReviewTarget (null)
  }

  return <>
    <header className="site-header"><div className="brand"><span className="brand-mark" aria-hidden="true">✚</span><div><strong>{t.brand}</strong><small>{t.tagline}</small></div></div>
      <div className="header-actions"><select aria-label="Language / 语言" value={language} onChange={event => setLanguage (event.target.value as 'en' | 'zh')}><option value="en">English</option><option value="zh">简体中文</option></select></div>
    </header>
    <main className={`workspace${selected ? ' has-selection' : ''}${phoneTab === 'chat' ? ' phone-chat' : ''}`}>
      <section className="library-pane">
        {config && <ImportPanel config={config} labels={t} onStored={updated} onDirty={setNewDirty} />}
        {config && !config.configured && <aside className="notice setup"><strong>{t.setup}</strong><p>{t.configure}</p></aside>}
        {notice && <div role="status" className="notice saved-notice"><div><strong>{notice.status === 'filed' ? t.saved : notice.status === 'failed' ? t.failed : t.originalStored}: {notice.title}</strong>
          {notice.status === 'filed' && <p>{dimensions.map (key => `${t[key]}: ${notice.metadata?.[key].values.map (value => value.value).join (' / ') || t.unknown}`).join (' · ')}</p>}
          {notice.check_status === 'failed' && <p>{t.checkFailed}</p>}
          {notice.concerns.length > 0 && <p>{t.concerns}: {notice.concerns.length}</p>}</div>
          <button onClick={() => select (notice.id)}>{t.open} →</button><button aria-label={t.close} onClick={() => setNotice (null)}>×</button></div>}
        {memberError && <p role="alert" className="notice error">{memberError}</p>}
        <LibraryBrowser files={files} profiles={profiles} labels={t} state={browse} onChange={setBrowse} selected={selected} onSelect={select} loading={loading} error={error} onRefresh={() => void refresh ()}
          onAddMember={() => setMemberDraft ({})} onEditMember={profile => setMemberDraft ({profile})} onRemoveMember={profile => {if (!memberBusy) void removeProfile (profile)}} onReviewMember={file => setReviewTarget (file.id)} />
      </section>
      <aside className="viewer-pane">{current ? <Viewer ref={viewer} key={`${current.id}:${editMemberFile === current.id}`} file={current} profiles={profiles} labels={t} onUpdate={file => {setEditMemberFile (null); updated (file)}} onDelete={() => {mutation.current++; setDirty (false); setEditMemberFile (null); setFiles (old => old.filter (file => file.id !== current.id)); setNotice (null); setSelected (null); history.pushState (null, '', '#')}} onBack={() => select (null)} onDirty={setDirty} consent={consent} resolveMember={editMemberFile === current.id} onResolveDone={() => setEditMemberFile (null)} onReviewMember={() => setReviewTarget (current.id)} /> : <div className="viewer-placeholder">{selected ? loading ? t.loading : error ? t.failedLoad : t.unavailableFile : t.select}{selected && <button onClick={() => select (null)}>{t.back}</button>}</div>}</aside>
      {config && <ChatPanel config={config} files={files} profiles={profiles} member={browse.member} onMember={member => setBrowse (old => ({...old, member}))} viewer={files.find (file => file.id === chatFile)} onOpen={select} consent={consent} language={language} onDirty={setChatDirty} />}
    </main>
    <nav className="phone-navigation" aria-label={language === 'zh' ? '工作区' : 'Workspace'}><button aria-pressed={phoneTab === 'chat'} onClick={() => setPhoneTab ('chat')}>{language === 'zh' ? '对话' : 'Chat'}</button><button aria-pressed={phoneTab === 'browser'} onClick={() => setPhoneTab ('browser')}>{language === 'zh' ? '浏览' : 'Browser'}</button></nav>
    {memberDraft && <MemberForm draft={memberDraft} labels={t} onSaved={profileSaved} onClose={() => setMemberDraft (null)} />}
    {reviewFile && <MemberReview key={memberReviewKey (reviewFile)} file={reviewFile} labels={t} onLater={() => deferReview (reviewFile)}
      onMistake={() => {deferReview (reviewFile); select (reviewFile.id); setEditMemberFile (reviewFile.id)}}
      onNew={() => {deferReview (reviewFile); setMemberDraft ({detectedName: reviewFile.metadata!.member.values[0].value})}} />}
  </>
}

export default App
