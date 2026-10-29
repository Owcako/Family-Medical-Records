import {useRef, useState} from 'react'
import Markdown from 'react-markdown'
import {json, request} from '../import/api'
import type {Configuration, MedicalFile, Profile} from '../import/types'
import {memberIdentity} from '../library/browsing'
import './chat.css'

type Reply = {
  message?: string
  service?: string
  claims: {text: string; citations: {file_id: string; quote: string}[]}[]
  explanation: string; limitation: string
  references?: string[]
  sources: {file_id: string; title: string; revision: number; kind?: string; status?: string; missing_fields?: string[]; text_origin: string; check_status: string; concerns: {quote: string; reason: string}[]}[]
  search: {total: number; indexed: number; retrieved: number}
}
type Message = {question: string; reply: Reply; member: string; member_name: string; viewer_id: string | null}
const copy = {
  en: {
    viewer: 'Document context', savedOnly: 'Current saved text is attached when you send. Unsaved edits stay in the viewer.', outsideScope: 'This document is outside the chat member filter. Choose its member or All family members to include it.',
    title: "Let's talk", intro: 'We can talk through your health history, questions, or next visit.', member: 'Chat member', all: 'All family members',
    placeholder: 'What’s on your mind?', question: 'Message', send: 'Send',
    thinking: 'Thinking…', failed: 'Could not complete this message. Your draft is kept.',
    sources: 'Sources', evidence: 'Open saved text', review: 'Take a look',
    scope: 'Member', search: 'Search coverage', indexed: 'indexed', read: 'read', of: 'of',
    caution: 'Sources have text warnings, stale checks, or manual edits. Review the supporting report.', boundary: 'Answers explain saved records. Medication and treatment decisions belong with your clinician.',
    sourceChanged: 'This source changed or is unavailable. Ask again to refresh the answer.', edited: 'Manually edited text', extracted: 'Extracted text', userText: 'User-entered text', originalRead: 'Original transcription', unresolved: 'Unresolved fields',
  },
  zh: {
    viewer: '文档上下文', savedOnly: '发送时会附上当前已保存文本，未保存修改保留在查看器中。', outsideScope: '此文档不在对话成员筛选范围内。请选择其所属成员或所有家庭成员以包含该文档。',
    title: '聊聊您的健康', intro: '可以聊聊您的健康经历、疑问，或下一次就诊。', member: '对话家庭成员', all: '所有家庭成员',
    placeholder: '您想聊些什么？', question: '消息', send: '发送', thinking: '正在思考…', failed: '消息未完成，草稿已保留。',
    sources: '来源', evidence: '打开已保存文本', review: '一起看看', scope: '成员', search: '检索范围', indexed: '已查看索引', read: '已读取', of: '/',
    caution: '来源含文本疑点、过期检查或人工修改，请核对原报告。', boundary: '回答用于理解已保存记录。用药和治疗决定请咨询医生。',
    sourceChanged: '来源已更改或不可用。请重新提问以更新回答。', edited: '人工修改文本', extracted: '提取文本', userText: '用户输入文本', originalRead: '原件转录', unresolved: '未解决分类',
  },
}

function AnswerText ({children}: {children: string})
{
  return <Markdown allowedElements={['p', 'strong', 'em', 'ul', 'ol', 'li', 'br', 'code']} unwrapDisallowed>{children}</Markdown>
}

export function ChatPanel ({config, files, profiles, member, onMember, viewer, onOpen, consent, language, onDirty}: {
  config: Configuration; files: MedicalFile[]; profiles: Profile[]; member: string; onMember: (member: string) => void
  viewer?: MedicalFile; onOpen: (id: string) => void; consent: () => boolean
  language: 'en' | 'zh'; onDirty: (dirty: boolean) => void
})
{
  const t = copy[language]
  const [message, setMessage] = useState ('')
  const [messages, setMessages] = useState<Message[]> ([])
  const [busy, setBusy] = useState (false)
  const [error, setError] = useState ('')
  const end = useRef<HTMLDivElement> (null)
  const conversation = messages.filter (item => item.member === member)
  const scope = profiles.find (profile => `profile:${profile.id}` === member)?.name ?? t.all

  async function send ()
  {
    if (busy || !message.trim () || !consent ()) return
    setError (''); setBusy (true)
    try
    {
      const question = message.trim ()
      // Preserve every exchange and its source references. The backend supplies
      // the complete current catalog and re-reads saved evidence on demand.
      const history = conversation.flatMap (item => [
        {role: 'user', content: item.question},
        {role: 'assistant', content: JSON.stringify ({answer: item.reply, viewer_id: item.viewer_id})},
      ])
      const options = json ({message: question, history, member, viewer_id: viewer?.id ?? null, language})
      const reply = await request<Reply> ('/chat', {...options, method: 'POST', headers: {...options.headers, 'X-Processing-Consent': config.disclosure}})
      setMessages (old => [...old, {question, reply, member, member_name: scope, viewer_id: viewer?.id ?? null}])
      setMessage (''); onDirty (false)
      window.setTimeout (() => end.current?.scrollIntoView ({block: 'nearest', behavior: 'smooth'}), 0)
    }
    catch (error) {setError ((error as Error).message)}
    finally {setBusy (false)}
  }

  return <section className="chat-pane" aria-label={t.title}>
    <div className="chat-heading"><div><div className="eyebrow">{language === 'zh' ? '对话' : 'Conversation'}</div><h2>{t.title}</h2></div></div>
    <p className="chat-intro">{t.intro}</p>
    <div className="chat-context"><label>{t.member}<select value={member} disabled={busy} onChange={event => {onMember (event.target.value); setError ('')}}><option value="">{t.all}</option>{profiles.map (profile => <option key={profile.id} value={`profile:${profile.id}`}>{profile.name}</option>)}</select></label></div>
    {viewer && <aside className="notice viewer-chat-context" aria-label={t.viewer}><strong>{t.viewer}</strong>
      <a href={`#/files/${encodeURIComponent (viewer.id)}`} onClick={event => {event.preventDefault (); onOpen (viewer.id)}}>{viewer.title}</a>
      <p>{member && memberIdentity (viewer, profiles) !== member ? t.outsideScope : t.savedOnly}</p>
    </aside>}
    <div className="chat-messages" aria-live="polite" aria-busy={busy}>
      {conversation.map ((item, index) => <article className="chat-turn" key={index}>
        <div className="chat-question"><small>{t.scope}: {item.member ? item.member_name : t.all}</small><p>{item.question}</p></div>
        <div className="chat-answer">
          {item.reply.message ? <div className="chat-message"><AnswerText>{item.reply.message}</AnswerText></div> : item.reply.claims.map ((claim, i) => <div className="chat-claim" key={i}><AnswerText>{claim.text}</AnswerText></div>)}
          {item.reply.explanation && <div className="chat-general"><AnswerText>{item.reply.explanation}</AnswerText></div>}
          {item.reply.limitation && <div className="chat-limitation"><AnswerText>{item.reply.limitation}</AnswerText></div>}
          {!!item.reply.references?.length && <div className="chat-references evidence-links">{item.reply.sources.filter (source => item.reply.references?.includes (source.file_id)).map (source => <a key={source.file_id} href={`#/files/${encodeURIComponent (source.file_id)}`} onClick={event => {event.preventDefault (); onOpen (source.file_id)}}>{t.review}: {source.title} ↗</a>)}</div>}
          {item.reply.sources.some (source => files.find (file => file.id === source.file_id)?.revision !== source.revision) && <p className="notice">{t.sourceChanged}</p>}
          {!!item.reply.sources.length && <details className="chat-evidence"><summary>{t.sources}</summary>
            {item.reply.sources.some (source => source.check_status !== 'checked' || source.concerns.length || source.text_origin === 'user_edited') && <p className="notice">{t.caution}</p>}
            {item.reply.sources.map (source => <div className="chat-source-status" key={source.file_id}>
              <div className="evidence-links"><a href={`#/files/${encodeURIComponent (source.file_id)}`} onClick={event => {event.preventDefault (); onOpen (source.file_id)}}>{t.evidence}: {source.title} ↗</a></div>
              <small>{source.kind === 'original_transcription' ? t.originalRead : source.text_origin === 'user_edited' ? t.edited : source.text_origin === 'user_entered' ? t.userText : t.extracted}</small>
              {[...new Set (item.reply.claims.flatMap (claim => claim.citations.filter (citation => citation.file_id === source.file_id).map (citation => citation.quote)))].map (quote => <blockquote key={quote}>{quote}</blockquote>)}
              {!!source.missing_fields?.length && <p>{t.unresolved}: {source.missing_fields.join (' / ')}</p>}
              {source.concerns.map ((concern, i) => <blockquote key={i}>{concern.quote}<p>{concern.reason}</p></blockquote>)}
            </div>)}
            <small className="search-coverage">{t.search}: {item.reply.search.indexed} {t.indexed}, {item.reply.search.retrieved} {t.read} {t.of} {item.reply.search.total}</small>
            {item.reply.service && <small className="chat-service">{item.reply.service}</small>}
          </details>}
        </div>
      </article>)}
      <div ref={end} />
    </div>
    <form className="chat-composer" onSubmit={event => {event.preventDefault (); void send ()}}>
      {error && <p role="alert" className="notice error">{t.failed} {error}</p>}
      {busy && <p role="status">{t.thinking}</p>}
      <label>{t.question}<textarea rows={3} maxLength={6000} value={message} disabled={busy} placeholder={t.placeholder} onChange={event => {setMessage (event.target.value); onDirty (Boolean (event.target.value))}} /></label>
      <button className="primary chat-send" disabled={busy || !message.trim ()}>{t.send}</button>
      <p className="chat-help">{t.boundary}</p>
    </form>
  </section>
}
