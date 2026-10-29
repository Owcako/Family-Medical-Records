import {useEffect, useRef} from 'react'
import type {MedicalFile} from '../import/types'
import type {Labels} from '../import/strings'

export function MemberReview ({file, labels: t, onMistake, onNew, onLater}: {
  file: MedicalFile; labels: Labels; onMistake: () => void; onNew: () => void; onLater: () => void
})
{
  const dialog = useRef<HTMLDialogElement> (null)
  useEffect (() => {dialog.current?.showModal ()}, [])
  return <dialog ref={dialog} className="modal profile-dialog" aria-labelledby="member-review-title" onCancel={onLater}>
    <h2 id="member-review-title">{t.reviewMember}</h2>
    <p><strong>{file.title}</strong></p>
    <p className="detected-member">{t.detectedMember}: <strong>{file.metadata?.member.values[0]?.value}</strong></p>
    <p>{t.memberQuestion}</p>
    <div className="actions"><button onClick={onMistake}>{t.memberMistake}</button><button className="primary" onClick={onNew}>{t.memberNew}</button><button onClick={onLater}>{t.reviewLater}</button></div>
  </dialog>
}
