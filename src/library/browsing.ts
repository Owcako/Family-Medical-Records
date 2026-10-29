import type {Dimension, MedicalFile, Profile} from '../import/types'

export const requiredDimensions: Dimension[] = ['member', 'date', 'department']
export type MemberOption = {id: string; name: string}
export type FileGroup = {id: string; value: string; placement: 'confirmed' | 'unknown' | 'tentative'; files: MedicalFile[]}
export type FileBranch = FileGroup & {kind?: 'year' | 'month' | 'unknown-month'; children?: FileBranch[]}

// Parse only explicit year-first dates. Other printed wording stays intact in
// its own branch instead of relying on the browser's ambiguous date parser.
export function dateParts (value: string)
{
  const match = /^(\d{4})(?:(?:[-/.](\d{1,2})(?:[-/.](\d{1,2}))?)|(?:年(?:(\d{1,2})月(?:(\d{1,2})日)?)?))?$/.exec (value.trim ())
  if (!match) return null
  const month = Number (match[2] ?? match[4])
  const day = Number (match[3] ?? match[5])
  if (month && (month < 1 || month > 12)) return null
  if ((match[2] ?? match[4]) && !month) return null
  if ((match[3] ?? match[5]) && (!day || day > new Date (Number (match[1]), month, 0).getDate ())) return null
  return {year: match[1], month: month ? String (month).padStart (2, '0') : ''}
}

export function fileBranches (groups: FileGroup[], dimension: Dimension): FileBranch[]
{
  if (dimension !== 'date') return groups
  const years = new Map<string, FileBranch> ()
  const other: FileBranch[] = []
  for (const group of groups)
  {
    const date = group.placement === 'confirmed' ? dateParts (group.value) : null
    if (!date) {other.push (group); continue}
    if (!years.has (date.year)) years.set (date.year, {id: `year:${date.year}`, value: date.year, placement: 'confirmed', kind: 'year', files: [], children: []})
    const year = years.get (date.year)!
    const id = `month:${date.year}:${date.month}`
    let month = year.children!.find (item => item.id === id)
    if (!month)
    {
      month = {id, value: date.month, placement: 'confirmed', kind: date.month ? 'month' : 'unknown-month', files: []}
      year.children!.push (month)
    }
    for (const file of group.files)
    {
      if (!year.files.some (item => item.id === file.id)) year.files.push (file)
      if (!month.files.some (item => item.id === file.id)) month.files.push (file)
    }
  }
  for (const year of years.values ()) year.children!.sort ((a, b) => b.value.localeCompare (a.value))
  return [...years.values ()].sort ((a, b) => b.value.localeCompare (a.value)).concat (other)
}

export function unresolvedFields (file: MedicalFile)
{
  return requiredDimensions.filter (key => file.metadata?.[key].status !== 'known' || !file.metadata[key].values.length)
}

export function needsAttention (file: MedicalFile)
{
  return unresolvedFields (file).length > 0 || file.status !== 'filed' || file.extraction_status === 'failed' ||
    file.concerns.length > 0 || file.check_status !== 'checked' || file.archive.index_state !== 'current'
}

// Only confirmed patient names can link a report to a profile. An exact name/alias
// must identify a single profile; ambiguous patient candidates never match a filter.
export function memberIdentity (file: MedicalFile, profiles: Profile[])
{
  const field = file.metadata?.member
  if (field?.status !== 'known' || field.values.length !== 1) return ''
  const value = field.values[0]
  const normalized = (name: string) => name.trim ().replace (/\s+/g, ' ').toLowerCase ()
  const matches = profiles.filter (profile => [profile.name, ...profile.aliases].some (name => normalized (name) === normalized (value.value)))
  const profile = profiles.find (profile => profile.id === value.profile_id) ?? (matches.length === 1 ? matches[0] : undefined)
  return profile ? `profile:${profile.id}` : ''
}

export function needsMemberReview (file: MedicalFile, profiles: Profile[])
{
  return file.status === 'filed' && file.metadata?.member.status === 'known' && file.metadata.member.values.length === 1 && !memberIdentity (file, profiles)
}

export function memberReviewKey (file: MedicalFile)
{
  return JSON.stringify ([file.id, file.metadata?.member.values[0]?.value])
}

export function memberOptions (profiles: Profile[]): MemberOption[]
{
  return profiles.map (profile => ({id: `profile:${profile.id}`, name: profile.name})).sort ((a, b) => a.name.localeCompare (b.name))
}

export function groupFiles (files: MedicalFile[], dimension: Dimension, profiles: Profile[] = []): FileGroup[]
{
  const groups = new Map<string, FileGroup> ()
  function add (file: MedicalFile, value: string, placement: FileGroup['placement'], identity = value)
  {
    const id = JSON.stringify ([placement, identity])
    if (!groups.has (id)) groups.set (id, {id, value, placement, files: []})
    const group = groups.get (id)!
    if (!group.files.some (item => item.id === file.id)) group.files.push (file)
  }
  for (const file of files)
  {
    if (dimension === 'member')
    {
      const identity = memberIdentity (file, profiles)
      const profile = profiles.find (profile => identity === `profile:${profile.id}`)
      add (file, profile?.name ?? '', profile ? 'confirmed' : 'unknown', identity)
      continue
    }
    const field = file.metadata?.[dimension]
    if (field?.status === 'known' && field.values.length)
    {
      for (const value of field.values) add (file, value.value, 'confirmed')
    }
    else
    {
      add (file, '', 'unknown')
      // Dates remain outside the confirmed chronology, including candidate dates.
      for (const value of field?.candidates ?? []) add (file, value.value, 'tentative')
    }
  }
  const order = {confirmed: 0, unknown: 1, tentative: 2}
  return [...groups.values ()].sort ((a, b) => order[a.placement] - order[b.placement] ||
    // Preserve printed precision and wording; do not parse partial dates into days.
    (dimension === 'date' && a.placement === 'confirmed' ? b.value.localeCompare (a.value) : a.value.localeCompare (b.value)))
}
