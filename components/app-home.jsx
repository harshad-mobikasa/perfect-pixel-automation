'use client'

import Image from 'next/image'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import AuditWizard from './audit-wizard'
import { ProjectDefaultTypography } from './typography-editor.jsx'
import { AssignedProjectChips, ProjectChecklist } from './project-checklist.jsx'
import { PasswordField } from './password-field.jsx'
import {
  RETENTION_OPTIONS,
  ROLE,
  canIssueResetLink,
  canManageProject,
  canManageUsers,
  getProjectRole,
  isAdmin,
  roleLabel,
} from '../lib/roles.js'

const ACTIVITY_PAGE_SIZE = 20
const LAST_PROJECT_STORAGE_KEY = 'audit-last-selected-project'
const BULK_INVITE_LIMIT = 25

const SUITE_LABELS = {
  pixelmatch: 'Perfect Pixel',
  typography: 'Typography',
  seo: 'SEO',
  lighthouse: 'Lighthouse',
  ada: 'ADA',
  responsive: 'Responsive',
}

async function readJson(response) {
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(data.error ?? 'Request failed')
  }
  return data
}

function apiFetch(url, options = {}) {
  return fetch(url, { cache: 'no-store', ...options })
}

const ACTIVITY_LABELS = {
  'user.created': 'User created',
  'user.deleted': 'User deleted',
  'member.added': 'Added to project',
  'member.removed': 'Removed from project',
  'member.assigned': 'Projects updated',
  'member.role_changed': 'Project role changed',
  'user.invite_accepted': 'Invite accepted',
  'user.password_reset': 'Password reset',
  'report.created': 'Report saved',
  'report.deleted': 'Report deleted',
}

let inviteRowId = 0

function createInviteRow(role = ROLE.DEV) {
  inviteRowId += 1
  return {
    id: `invite-row-${inviteRowId}`,
    name: '',
    email: '',
    role,
  }
}

function inviteRowsToUsers(rows) {
  return rows
    .map((row) => ({
      name: row.name.trim(),
      email: row.email.trim(),
      role: row.role,
    }))
    .filter((row) => row.name || row.email)
}

function normalizeInviteResults(data) {
  if (Array.isArray(data.results)) return data.results
  if (data.user) {
    return [
      {
        status: 'ok',
        user: data.user,
        created: data.created,
        emailSent: data.emailSent,
      },
    ]
  }
  return []
}

function inviteResultsNotice(results) {
  const sent = results.filter((result) => result.status === 'ok' && result.emailSent).length
  const assigned = results.filter((result) => result.status === 'ok' && !result.emailSent).length
  const failed = results.filter((result) => result.status === 'error').length
  const parts = []
  if (sent) parts.push(`${sent} invite email${sent === 1 ? '' : 's'} sent`)
  if (assigned) parts.push(`${assigned} existing user${assigned === 1 ? '' : 's'} assigned`)
  if (failed) parts.push(`${failed} failed`)
  return parts.join(', ') || 'No invites processed'
}

function toDateKey(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function formatDateTime(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Unknown'
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}

function expiryText(value) {
  const expiresAt = new Date(value).getTime()
  if (Number.isNaN(expiresAt)) return 'Unknown'
  const days = Math.ceil((expiresAt - Date.now()) / (24 * 60 * 60 * 1000))
  if (days <= 0) return 'Expires today'
  if (days === 1) return 'Expires tomorrow'
  return `Expires in ${days} days`
}

function inDateRange(createdAt, from, to) {
  const key = toDateKey(createdAt)
  if (!key) return false
  if (from && key < from) return false
  if (to && key > to) return false
  return true
}

function projectRoleLabel(user, project) {
  const role = getProjectRole(user, project)
  if (role === ROLE.ADMIN) return 'Admin'
  return roleLabel(role)
}

function InviteStatusBadge({ user }) {
  const pending = user?.inviteStatus === 'pending'
  return (
    <span
      className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ${
        pending ? 'bg-amber-50 text-amber-700' : 'bg-green-50 text-green-700'
      }`}
    >
      {pending ? 'Invite pending' : 'Active'}
    </span>
  )
}

function InviteRowsEditor({ rows, onChange, roleOptions, roleLabel = 'Role' }) {
  function updateRow(rowId, patch) {
    onChange(rows.map((row) => (row.id === rowId ? { ...row, ...patch } : row)))
  }

  function addRow() {
    if (rows.length >= BULK_INVITE_LIMIT) return
    onChange([...rows, createInviteRow(roleOptions[0]?.value ?? ROLE.DEV)])
  }

  function removeRow(rowId) {
    if (rows.length <= 1) return
    onChange(rows.filter((row) => row.id !== rowId))
  }

  return (
    <div className="space-y-3">
      <div className="hidden grid-cols-[1fr_1.2fr_0.8fr_auto] gap-3 text-xs font-semibold uppercase tracking-wide text-[#3C3D41]/50 md:grid">
        <span>Name</span>
        <span>Email</span>
        <span>{roleLabel}</span>
        <span>Action</span>
      </div>
      {rows.map((row, index) => (
        <div key={row.id} className="grid gap-3 rounded-xl border border-[#3C3D41]/10 p-3 md:grid-cols-[1fr_1.2fr_0.8fr_auto] md:items-center">
          <label className="space-y-1 md:space-y-0">
            <span className="text-xs font-medium text-[#3C3D41]/60 md:hidden">Name</span>
            <input
              value={row.name}
              onChange={(event) => updateRow(row.id, { name: event.target.value })}
              placeholder={`User ${index + 1}`}
              className="w-full rounded-lg border border-[#3C3D41]/15 px-3 py-2 outline-none focus:ring-2 focus:ring-[#F58220]"
            />
          </label>
          <label className="space-y-1 md:space-y-0">
            <span className="text-xs font-medium text-[#3C3D41]/60 md:hidden">Email</span>
            <input
              type="email"
              value={row.email}
              onChange={(event) => updateRow(row.id, { email: event.target.value })}
              placeholder="name@example.com"
              className="w-full rounded-lg border border-[#3C3D41]/15 px-3 py-2 outline-none focus:ring-2 focus:ring-[#F58220]"
            />
          </label>
          <label className="space-y-1 md:space-y-0">
            <span className="text-xs font-medium text-[#3C3D41]/60 md:hidden">{roleLabel}</span>
            <select
              value={row.role}
              onChange={(event) => updateRow(row.id, { role: event.target.value })}
              className="w-full rounded-lg border border-[#3C3D41]/15 px-3 py-2 outline-none focus:ring-2 focus:ring-[#F58220]"
            >
              {roleOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={() => removeRow(row.id)}
            disabled={rows.length <= 1}
            className="rounded-lg border border-[#3C3D41]/15 px-3 py-2 text-sm font-medium text-[#3C3D41]/70 disabled:opacity-40 cursor-pointer"
          >
            Remove
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={addRow}
        disabled={rows.length >= BULK_INVITE_LIMIT}
        className="rounded-lg border border-[#F58220]/40 px-4 py-2 text-sm font-semibold text-[#F58220] hover:bg-[#F58220]/5 disabled:opacity-40 cursor-pointer"
      >
        + Add user
      </button>
      <p className="text-xs text-[#3C3D41]/55">Maximum {BULK_INVITE_LIMIT} users at a time.</p>
    </div>
  )
}

export default function AppHome({ initialUser, initialProjects = [], initialUsers = [] }) {
  const router = useRouter()
  const [user, setUser] = useState(initialUser)
  const [projects, setProjects] = useState(initialProjects)
  const [users, setUsers] = useState(initialUsers)
  const [selectedProjectId, setSelectedProjectId] = useState(initialProjects[0]?.id ?? '')
  const [view, setView] = useState('audit')
  const [projectTab, setProjectTab] = useState('audit')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const [projectName, setProjectName] = useState('')
  const [projectMemberIds, setProjectMemberIds] = useState([])

  const [inviteResults, setInviteResults] = useState([])
  const [members, setMembers] = useState([])
  const [membersProjectId, setMembersProjectId] = useState('')
  const [reports, setReports] = useState([])
  const [reportsProjectId, setReportsProjectId] = useState('')
  const [reportsLoading, setReportsLoading] = useState(false)
  const [selectedReportIds, setSelectedReportIds] = useState([])
  const [reportDateFrom, setReportDateFrom] = useState('')
  const [reportDateTo, setReportDateTo] = useState('')
  const [reportSuiteFilter, setReportSuiteFilter] = useState('')
  const [reportUserFilter, setReportUserFilter] = useState('')
  const [activityEvents, setActivityEvents] = useState([])
  const [activityLoading, setActivityLoading] = useState(false)
  const [activityPage, setActivityPage] = useState(1)
  const [activityTotal, setActivityTotal] = useState(0)
  const [activityDateFrom, setActivityDateFrom] = useState('')
  const [activityDateTo, setActivityDateTo] = useState('')
  const [activityRetentionDays, setActivityRetentionDays] = useState(45)
  const [adminJobs, setAdminJobs] = useState([])
  const [adminJobsLoading, setAdminJobsLoading] = useState(false)
  const [assignEditor, setAssignEditor] = useState(null)
  const [assignDraftIds, setAssignDraftIds] = useState([])
  const [assignSaving, setAssignSaving] = useState(false)
  const extrasRequestRef = useRef(0)
  const restoredProjectRef = useRef(false)
  const [creatingUser, setCreatingUser] = useState(false)
  const [projectInviteRows, setProjectInviteRows] = useState([createInviteRow()])
  const [userInviteRows, setUserInviteRows] = useState([createInviteRow()])
  const [userForm, setUserForm] = useState({
    projectIds: [],
  })
  const [passwordForm, setPasswordForm] = useState({
    currentPassword: '',
    password: '',
    confirmPassword: '',
  })
  const [profileForm, setProfileForm] = useState({
    name: initialUser?.name ?? '',
  })

  const admin = isAdmin(user)
  const canManage = canManageUsers(user)

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setInviteResults([])
      setAssignEditor(null)
    }, 0)
    return () => window.clearTimeout(timer)
  }, [view, selectedProjectId, projectTab])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const storedProjectId = window.localStorage.getItem(LAST_PROJECT_STORAGE_KEY)
      if (storedProjectId && projects.some((project) => project.id === storedProjectId)) {
        setSelectedProjectId(storedProjectId)
      }
      restoredProjectRef.current = true
    }, 0)
    return () => window.clearTimeout(timer)
  }, [projects])

  useEffect(() => {
    if (restoredProjectRef.current && selectedProjectId) {
      window.localStorage.setItem(LAST_PROJECT_STORAGE_KEY, selectedProjectId)
    }
  }, [selectedProjectId])

  const selectedProject = useMemo(
    () => projects.find((project) => project.id === selectedProjectId) ?? null,
    [projects, selectedProjectId],
  )
  const canManageSelected = canManageProject(user, selectedProject)
  const assignableUsers = users.filter((entry) => !isAdmin(entry))
  const inviteRoles = admin
    ? [
        { value: ROLE.DEV, label: 'Dev' },
        { value: ROLE.PROJECT_ADMIN, label: 'Project admin' },
        { value: ROLE.ADMIN, label: 'Admin' },
      ]
    : [{ value: ROLE.DEV, label: 'Dev' }]
  const teamRoleOptions = admin
    ? [
        { value: ROLE.DEV, label: 'Dev' },
        { value: ROLE.PROJECT_ADMIN, label: 'Project admin' },
      ]
    : [{ value: ROLE.DEV, label: 'Dev' }]
  const needsProjectAssignment = userInviteRows.some((row) => row.role !== ROLE.ADMIN)
  const selectedProjectReports = useMemo(
    () => (reportsProjectId === selectedProjectId ? reports : []),
    [reports, reportsProjectId, selectedProjectId],
  )
  const visibleReports = useMemo(
    () =>
      selectedProjectReports.filter((report) => {
        if (!inDateRange(report.createdAt, reportDateFrom, reportDateTo)) return false
        if (reportSuiteFilter && report.suite !== reportSuiteFilter) return false
        if (reportUserFilter && report.createdBy?.userId !== reportUserFilter) return false
        return true
      }),
    [selectedProjectReports, reportDateFrom, reportDateTo, reportSuiteFilter, reportUserFilter],
  )
  const reportUsers = useMemo(() => {
    const byId = new Map()
    for (const report of selectedProjectReports) {
      const userId = report.createdBy?.userId
      if (!userId || byId.has(userId)) continue
      byId.set(userId, {
        id: userId,
        name: report.createdBy?.name || report.createdBy?.email || 'Unknown',
      })
    }
    return [...byId.values()].sort((left, right) => left.name.localeCompare(right.name))
  }, [selectedProjectReports])
  const reportsReadyForSelectedProject = Boolean(
    selectedProject && !reportsLoading && reportsProjectId === selectedProject.id,
  )
  const activityTotalPages = Math.max(1, Math.ceil(activityTotal / ACTIVITY_PAGE_SIZE))
  const teamMembers = useMemo(() => {
    if (!selectedProject) return []
    const details = new Map()
    if (membersProjectId === selectedProject.id) {
      for (const entry of members) details.set(entry.id, entry)
    }
    for (const entry of users) details.set(entry.id, entry)
    return (selectedProject.members ?? []).map((member) => {
      const match = details.get(member.userId)
      return {
        id: member.userId,
        name: match?.name ?? 'Unknown',
        email: match?.email ?? '',
        inviteStatus: match?.inviteStatus ?? 'active',
        projectRole: member.role,
      }
    })
  }, [selectedProject, members, membersProjectId, users])

  async function refreshAdminUsers() {
    const userData = await readJson(await apiFetch('/api/admin/users'))
    setUsers(userData.users)
  }

  async function refreshProjects() {
    const projectData = await readJson(await apiFetch('/api/projects'))
    setProjects(projectData.projects)
  }

  async function loadProjectExtras(projectId) {
    const requestId = extrasRequestRef.current + 1
    extrasRequestRef.current = requestId
    if (!projectId) {
      setMembers([])
      setMembersProjectId('')
      setReports([])
      setReportsProjectId('')
      setReportsLoading(false)
      setSelectedReportIds([])
      setReportSuiteFilter('')
      setReportUserFilter('')
      return
    }

    setSelectedReportIds([])
    setReportSuiteFilter('')
    setReportUserFilter('')
    setReportsProjectId(projectId)
    setReports([])
    setReportsLoading(true)
    try {
      const [memberData, reportData] = await Promise.all([
        readJson(await apiFetch(`/api/projects/${projectId}/members`)),
        readJson(await apiFetch(`/api/projects/${projectId}/reports`)),
      ])
      if (requestId !== extrasRequestRef.current) return
      setMembers(memberData.members ?? [])
      setMembersProjectId(projectId)
      setReports(reportData.reports ?? [])
    } finally {
      if (requestId === extrasRequestRef.current) setReportsLoading(false)
    }
  }

  async function loadActivity(options = {}) {
    const page = options.page ?? activityPage
    const from = options.from ?? activityDateFrom
    const to = options.to ?? activityDateTo
    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(ACTIVITY_PAGE_SIZE),
    })
    if (from) params.set('from', from)
    if (to) params.set('to', to)

    setActivityPage(page)
    setActivityLoading(true)
    try {
      const data = await readJson(await apiFetch(`/api/activity?${params.toString()}`))
      setActivityEvents(data.events ?? [])
      setActivityRetentionDays(data.retentionDays ?? 45)
      setActivityTotal(data.total ?? 0)
      setActivityPage(data.page ?? page)
    } finally {
      setActivityLoading(false)
    }
  }

  async function openActivity() {
    setView('activity')
    try {
      await loadActivity({ page: 1 })
    } catch (loadError) {
      setError(loadError.message)
    }
  }

  async function handleActivityFilter(event) {
    event.preventDefault()
    setError('')
    try {
      await loadActivity({ page: 1 })
    } catch (loadError) {
      setError(loadError.message)
    }
  }

  async function clearActivityFilter() {
    setActivityDateFrom('')
    setActivityDateTo('')
    setError('')
    try {
      await loadActivity({ page: 1, from: '', to: '' })
    } catch (loadError) {
      setError(loadError.message)
    }
  }

  async function changeActivityPage(page) {
    if (page < 1 || page > activityTotalPages || activityLoading) return
    setError('')
    try {
      await loadActivity({ page })
    } catch (loadError) {
      setError(loadError.message)
    }
  }

  async function loadAdminJobs() {
    if (!admin) return
    setAdminJobsLoading(true)
    try {
      const data = await readJson(await apiFetch('/api/admin/audit-jobs'))
      setAdminJobs(Array.isArray(data.jobs) ? data.jobs : [])
    } finally {
      setAdminJobsLoading(false)
    }
  }

  async function openAdminJobs() {
    setView('jobs')
    setError('')
    try {
      await loadAdminJobs()
    } catch (loadError) {
      setError(loadError.message)
    }
  }

  async function handleAdminJobAction(jobId, action) {
    setNotice('')
    setError('')
    try {
      await readJson(
        await apiFetch('/api/admin/audit-jobs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jobId, action }),
        }),
      )
      await loadAdminJobs()
      setNotice(action === 'retry' ? 'Audit job queued again' : 'Audit job removed')
    } catch (submitError) {
      setError(submitError.message)
    }
  }

  async function signOut() {
    await apiFetch('/api/auth/logout', { method: 'POST' })
    router.replace('/login')
    router.refresh()
  }

  function openProject(projectId, tab = 'audit') {
    const switchingProjects = selectedProjectId !== projectId
    setSelectedProjectId(projectId)
    setView('audit')
    setProjectTab(tab)
    if (switchingProjects) {
      setMembers([])
      setMembersProjectId('')
      setReports([])
      setReportsProjectId(projectId)
      setReportsLoading(true)
      setSelectedReportIds([])
        setReportSuiteFilter('')
        setReportUserFilter('')
    }
    loadProjectExtras(projectId).catch((loadError) => setError(loadError.message))
  }

  async function handleCreateProject(event) {
    event.preventDefault()
    setNotice('')
    setError('')
    try {
      const data = await readJson(
        await apiFetch('/api/projects', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: projectName,
            memberIds: projectMemberIds,
          }),
        }),
      )
      setProjects((current) => [data.project, ...current])
      setSelectedProjectId(data.project.id)
      setProjectName('')
      setProjectMemberIds([])
      setView('audit')
      setProjectTab('audit')
      setNotice('Project created')
    } catch (submitError) {
      setError(submitError.message)
    }
  }

  async function handleSaveProjectConfig(config) {
    if (!selectedProject) return
    const data = await readJson(
      await apiFetch(`/api/projects/${selectedProject.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config }),
      }),
    )
    setProjects((current) => current.map((project) => (project.id === data.project.id ? data.project : project)))
  }

  async function handleSaveTypographyDefaults(typographyBlocks) {
    if (!selectedProject) return
    await handleSaveProjectConfig({
      ...selectedProject.config,
      typographyBlocks,
    })
    setNotice('Default typography saved for this project')
  }

  async function handleRetentionChange(retentionDays) {
    if (!selectedProject) return
    setError('')
    try {
      const data = await readJson(
        await apiFetch(`/api/projects/${selectedProject.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ retentionDays }),
        }),
      )
      setProjects((current) => current.map((project) => (project.id === data.project.id ? data.project : project)))
      setNotice('Report retention updated')
    } catch (submitError) {
      setError(submitError.message)
    }
  }

  async function handleInviteMember(event) {
    event.preventDefault()
    if (!selectedProject) return
    setNotice('')
    setError('')
    setInviteResults([])
    const usersToInvite = inviteRowsToUsers(projectInviteRows)
    if (usersToInvite.length === 0) {
      setError('Enter at least one email to invite')
      return
    }
    try {
      const data = await readJson(
        await apiFetch(`/api/projects/${selectedProject.id}/members`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            users: usersToInvite,
          }),
        }),
      )
      const results = normalizeInviteResults(data)
      setInviteResults(results)
      setProjectInviteRows([createInviteRow()])
      await refreshProjects()
      await loadProjectExtras(selectedProject.id)
      if (canManage) await refreshAdminUsers()
      setNotice(inviteResultsNotice(results))
    } catch (submitError) {
      setError(submitError.message)
    }
  }

  async function handleMemberRoleChange(userId, role) {
    if (!selectedProject) return
    setError('')
    try {
      await readJson(
        await apiFetch(`/api/projects/${selectedProject.id}/members`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId, role }),
        }),
      )
      await refreshProjects()
      await loadProjectExtras(selectedProject.id)
      setNotice('Project role updated')
    } catch (submitError) {
      setError(submitError.message)
    }
  }

  async function handleRemoveMember(entry) {
    if (!selectedProject) return
    if (!window.confirm(`Remove ${entry.name} from ${selectedProject.name}? They stay in the system.`)) return
    setError('')
    try {
      await readJson(
        await apiFetch(`/api/projects/${selectedProject.id}/members?userId=${encodeURIComponent(entry.id)}`, {
          method: 'DELETE',
        }),
      )
      await refreshProjects()
      await loadProjectExtras(selectedProject.id)
      if (canManage) await refreshAdminUsers()
      setNotice(`${entry.email} was removed from this project`)
    } catch (submitError) {
      setError(submitError.message)
    }
  }

  async function handleCreateUser(event) {
    event.preventDefault()
    if (creatingUser) return
    setNotice('')
    setError('')
    setInviteResults([])
    const usersToInvite = inviteRowsToUsers(userInviteRows)
    if (usersToInvite.length === 0) {
      setError('Enter at least one email to invite')
      return
    }
    setCreatingUser(true)
    try {
      const data = await readJson(
        await apiFetch('/api/admin/users', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            users: usersToInvite,
            projectIds: userForm.projectIds,
          }),
        }),
      )
      const results = normalizeInviteResults(data)
      const savedUsers = results.filter((result) => result.status === 'ok' && result.user).map((result) => result.user)
      setUsers((current) => {
        let next = [...current]
        for (const savedUser of savedUsers) {
          next = next.some((entry) => entry.id === savedUser.id)
            ? next.map((entry) => (entry.id === savedUser.id ? savedUser : entry))
            : [...next, savedUser]
        }
        return next
      })
      setUserForm({
        projectIds: [],
      })
      setUserInviteRows([createInviteRow()])
      setInviteResults(results)
      setNotice(inviteResultsNotice(results))
      refreshAdminUsers().catch((loadError) => setError(loadError.message))
      refreshProjects().catch((loadError) => setError(loadError.message))
    } catch (submitError) {
      setError(submitError.message)
    } finally {
      setCreatingUser(false)
    }
  }

  async function handleDeleteUser(entry) {
    if (!window.confirm(`Delete ${entry.name} (${entry.email}) from the system?`)) return
    setNotice('')
    setError('')
    try {
      await readJson(await apiFetch(`/api/admin/users/${entry.id}`, { method: 'DELETE' }))
      setUsers((current) => current.filter((userEntry) => userEntry.id !== entry.id))
      await refreshProjects()
      setNotice('User deleted')
    } catch (submitError) {
      setError(submitError.message)
    }
  }

  async function handleAssignUserProjects(entry, projectIds) {
    setNotice('')
    setError('')
    setAssignSaving(true)
    try {
      const data = await readJson(
        await apiFetch(`/api/admin/users/${entry.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ projectIds }),
        }),
      )
      const saved = data.user
      setUsers((current) => current.map((userEntry) => (userEntry.id === saved.id ? saved : userEntry)))
      setProjects((current) =>
        current.map((project) => {
          const nextMembers = (project.members ?? []).filter((member) => member.userId !== saved.id)
          if ((saved.projectIds ?? []).includes(project.id)) {
            const existing = (project.members ?? []).find((member) => member.userId === saved.id)
            nextMembers.push({ userId: saved.id, role: existing?.role ?? ROLE.DEV })
          }
          return {
            ...project,
            members: nextMembers,
            memberIds: nextMembers.map((member) => member.userId),
          }
        }),
      )
      setAssignEditor(null)
      setNotice(`Projects updated for ${entry.email}`)
      refreshAdminUsers().catch((loadError) => setError(loadError.message))
      refreshProjects().catch((loadError) => setError(loadError.message))
    } catch (submitError) {
      setError(submitError.message)
    } finally {
      setAssignSaving(false)
    }
  }

  async function handleAssignPassword(entry) {
    const pending = entry.inviteStatus === 'pending'
    if (!window.confirm(`${pending ? 'Resend invite' : 'Send a password reset email'} to ${entry.email}?`)) return
    setNotice('')
    setError('')
    setInviteResults([])
    try {
      await readJson(
        await apiFetch(`/api/admin/users/${entry.id}/password`, { method: 'POST' }),
      )
      setNotice(`${pending ? 'Invite' : 'Password reset'} email sent to ${entry.email}`)
    } catch (submitError) {
      setError(submitError.message)
    }
  }

  async function handleUpdateProfile(event) {
    event.preventDefault()
    setNotice('')
    setError('')
    try {
      const data = await readJson(
        await apiFetch('/api/auth/me', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(profileForm),
        }),
      )
      setUser(data.user)
      setUsers((current) => current.map((entry) => (entry.id === data.user.id ? data.user : entry)))
      setProfileForm({ name: data.user.name })
      setNotice('Profile updated')
    } catch (submitError) {
      setError(submitError.message)
    }
  }

  async function handleChangeOwnPassword(event) {
    event.preventDefault()
    setNotice('')
    setError('')
    try {
      await readJson(
        await apiFetch('/api/auth/change-password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(passwordForm),
        }),
      )
      setPasswordForm({ currentPassword: '', password: '', confirmPassword: '' })
      setNotice('Your password was updated')
    } catch (submitError) {
      setError(submitError.message)
    }
  }

  function toggleValue(list, value) {
    return list.includes(value) ? list.filter((entry) => entry !== value) : [...list, value]
  }

  function toggleReportSelection(reportId) {
    setSelectedReportIds((current) => toggleValue(current, reportId))
  }

  function selectVisibleReports() {
    setSelectedReportIds(visibleReports.map((report) => report.id))
  }

  function selectReportsOnDate(dateKey) {
    if (!dateKey) return
    setSelectedReportIds(
      selectedProjectReports.filter((report) => toDateKey(report.createdAt) === dateKey).map((report) => report.id),
    )
  }

  async function handleDeleteSelectedReports() {
    if (!selectedProject || selectedReportIds.length === 0) return
    if (!window.confirm(`Delete ${selectedReportIds.length} report(s) from this project?`)) return
    setNotice('')
    setError('')
    try {
      const data = await readJson(
        await apiFetch(`/api/projects/${selectedProject.id}/reports`, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ runIds: selectedReportIds }),
        }),
      )
      await loadProjectExtras(selectedProject.id)
      if (canManage) await loadActivity()
      setNotice(`${data.deleted} report(s) deleted`)
    } catch (submitError) {
      setError(submitError.message)
    }
  }

  const tabs = [
    { id: 'audit', label: 'Audit' },
    { id: 'team', label: 'Team' },
    { id: 'reports', label: 'Reports' },
    { id: 'settings', label: 'Settings' },
  ]

  return (
    <div className="min-h-screen bg-[#f7f5f2] text-[#3C3D41]">
      <div className="flex min-h-screen">
        <aside className="flex w-72 shrink-0 flex-col bg-[#3C3D41] text-white">
          <div className="border-b border-white/10 px-5 py-6">
            <div className="inline-flex rounded-2xl bg-white px-3 py-2">
              <Image src="/mobikasa.png" alt="Mobikasa" width={140} height={40} className="h-9 w-auto" />
            </div>
            <p className="mt-4 text-xs font-semibold uppercase tracking-[0.22em] text-[#F58220]">
              Audit Tool
            </p>
            <p className="mt-1 text-sm text-white/70">Internal storefront QA</p>
          </div>

          <nav className="flex-1 space-y-1 px-3 py-4">
            <p className="px-2 pb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-white/40">
              Projects
            </p>
            {projects.length === 0 && (
              <p className="px-2 text-sm text-white/60">No projects assigned yet.</p>
            )}
            {projects.map((project) => (
              <button
                key={project.id}
                type="button"
                onClick={() => openProject(project.id)}
                className={`w-full rounded-lg px-3 py-2 text-left text-sm cursor-pointer ${
                  selectedProjectId === project.id && view === 'audit'
                    ? 'bg-[#F58220] text-white'
                    : 'text-white/80 hover:bg-white/10'
                }`}
              >
                <span className="block">{project.name}</span>
                <span className="mt-0.5 block text-[11px] opacity-70">{projectRoleLabel(user, project)}</span>
              </button>
            ))}

            {canManage && (
              <>
                <p className="px-2 pb-2 pt-5 text-[11px] font-semibold uppercase tracking-[0.16em] text-white/40">
                  {admin ? 'Admin' : 'Project admin'}
                </p>
                {admin && (
                  <button
                    type="button"
                    onClick={() => setView('projects')}
                    className={`w-full rounded-lg px-3 py-2 text-left text-sm cursor-pointer ${
                      view === 'projects' ? 'bg-white/15 text-white' : 'text-white/80 hover:bg-white/10'
                    }`}
                  >
                    Manage projects
                  </button>
                )}
                {admin && (
                  <button
                    type="button"
                    onClick={() => openAdminJobs()}
                    className={`w-full rounded-lg px-3 py-2 text-left text-sm cursor-pointer ${
                      view === 'jobs' ? 'bg-white/15 text-white' : 'text-white/80 hover:bg-white/10'
                    }`}
                  >
                    Audit jobs
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setView('users')}
                  className={`w-full rounded-lg px-3 py-2 text-left text-sm cursor-pointer ${
                    view === 'users' ? 'bg-white/15 text-white' : 'text-white/80 hover:bg-white/10'
                  }`}
                >
                  Manage users
                </button>
                <button
                  type="button"
                  onClick={() => openActivity()}
                  className={`w-full rounded-lg px-3 py-2 text-left text-sm cursor-pointer ${
                    view === 'activity' ? 'bg-white/15 text-white' : 'text-white/80 hover:bg-white/10'
                  }`}
                >
                  Activity log
                </button>
              </>
            )}
            <p className="px-2 pb-2 pt-5 text-[11px] font-semibold uppercase tracking-[0.16em] text-white/40">
              You
            </p>
            <button
              type="button"
              onClick={() => setView('account')}
              className={`w-full rounded-lg px-3 py-2 text-left text-sm cursor-pointer ${
                view === 'account' ? 'bg-white/15 text-white' : 'text-white/80 hover:bg-white/10'
              }`}
            >
              Account
            </button>
          </nav>

          <div className="border-t border-white/10 px-5 py-4">
            <div className="text-sm font-medium">{user?.name}</div>
            <div className="mt-1 text-xs text-white/60">
              {user?.email} · {isAdmin(user) ? 'Admin' : 'User'}
            </div>
            <button
              type="button"
              onClick={signOut}
              className="mt-3 text-sm text-[#F58220] hover:underline cursor-pointer"
            >
              Sign out
            </button>
          </div>
        </aside>

        <main className="min-w-0 flex-1 p-6 lg:p-8">
          {error && (
            <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          )}
          {notice && (
            <div className="mb-4 rounded-xl border border-[#F58220]/20 bg-white px-4 py-3 text-sm text-[#3C3D41]">
              {notice}
            </div>
          )}
          {inviteResults.length > 0 && (
            <div className="mb-4 rounded-xl border border-[#3C3D41]/10 bg-white px-4 py-3 text-sm">
              <p className="font-semibold">Invite results</p>
              <ul className="mt-2 space-y-1">
                {inviteResults.map((result, index) => (
                  <li
                    key={`${result.user?.id ?? result.email ?? 'invite'}-${index}`}
                    className={result.status === 'error' ? 'text-red-600' : 'text-[#3C3D41]/75'}
                  >
                    {result.status === 'error'
                      ? `${result.email || 'User'}: ${result.error}`
                      : `${result.user.email}: ${result.emailSent ? 'invite email sent' : 'existing user assigned'}`}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {view === 'audit' && selectedProject && (
            <div className="space-y-6">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#F58220]">Project</p>
                <h1 className="mt-1 text-2xl font-semibold">{selectedProject.name}</h1>
                <p className="mt-1 text-sm text-[#3C3D41]/70">
                  Your role here is {projectRoleLabel(user, selectedProject)}. Saved URL and typography are the
                  project defaults. You can still change them for one run, such as staging.
                </p>
              </div>

              <div className="flex flex-wrap gap-2">
                {tabs.map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => {
                      setProjectTab(tab.id)
                      if (tab.id === 'team' || tab.id === 'reports') {
                        loadProjectExtras(selectedProject.id).catch((loadError) => setError(loadError.message))
                      }
                    }}
                    className={`rounded-lg px-3 py-2 text-sm cursor-pointer ${
                      projectTab === tab.id
                        ? 'bg-[#3C3D41] text-white'
                        : 'bg-white text-[#3C3D41] hover:bg-white/80'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              {projectTab === 'audit' && (
                <AuditWizard
                  key={`${selectedProject.id}-${selectedProject.updatedAt}`}
                  project={selectedProject}
                  onSaveConfig={handleSaveProjectConfig}
                />
              )}

              {projectTab === 'team' && (
                <div className="space-y-6">
                  {canManageSelected && (
                    <form onSubmit={handleInviteMember} className="rounded-2xl border border-[#3C3D41]/10 bg-white p-6 space-y-4">
                      <h2 className="text-lg font-semibold">Invite to this project</h2>
                      <p className="text-sm text-[#3C3D41]/70">
                        Add one or more users, choose the project role for each person, and send secure invite emails.
                        {admin ? '' : ' Project admins can only add Dev users.'}
                      </p>
                      <InviteRowsEditor
                        rows={projectInviteRows}
                        onChange={setProjectInviteRows}
                        roleOptions={teamRoleOptions}
                        roleLabel="Project role"
                      />
                      <button
                        type="submit"
                        className="rounded-lg bg-[#F58220] px-4 py-2 text-sm font-semibold text-white hover:bg-[#e27518] cursor-pointer"
                      >
                        Invite
                      </button>
                    </form>
                  )}

                  <div className="overflow-hidden rounded-2xl border border-[#3C3D41]/10 bg-white">
                    <table className="w-full text-left text-sm">
                      <thead className="bg-[#f7f5f2] text-xs uppercase tracking-wide text-[#3C3D41]/60">
                        <tr>
                          <th className="px-4 py-3">Name</th>
                          <th className="px-4 py-3">Email</th>
                          <th className="px-4 py-3">Status</th>
                          <th className="px-4 py-3">Role on this project</th>
                          {canManageSelected && <th className="px-4 py-3">Actions</th>}
                        </tr>
                      </thead>
                      <tbody>
                        {teamMembers.map((entry) => (
                          <tr key={entry.id} className="border-t border-[#3C3D41]/10">
                            <td className="px-4 py-3 font-medium">{entry.name}</td>
                            <td className="px-4 py-3">{entry.email}</td>
                            <td className="px-4 py-3"><InviteStatusBadge user={entry} /></td>
                            <td className="px-4 py-3">
                              {canManageSelected && entry.id !== user.id && admin ? (
                                <select
                                  value={entry.projectRole}
                                  onChange={(event) => handleMemberRoleChange(entry.id, event.target.value)}
                                  className="rounded-lg border border-[#3C3D41]/15 px-2 py-1"
                                >
                                  {teamRoleOptions.map((option) => (
                                    <option key={option.value} value={option.value}>
                                      {option.label}
                                    </option>
                                  ))}
                                </select>
                              ) : (
                                roleLabel(entry.projectRole)
                              )}
                            </td>
                            {canManageSelected && (
                              <td className="px-4 py-3">
                                {entry.id !== user.id && (
                                  <button
                                    type="button"
                                    onClick={() => handleRemoveMember(entry)}
                                    className="text-red-600 hover:underline cursor-pointer"
                                  >
                                    Remove from project
                                  </button>
                                )}
                              </td>
                            )}
                          </tr>
                        ))}
                        {teamMembers.length === 0 && (
                          <tr>
                            <td className="px-4 py-6 text-[#3C3D41]/60" colSpan={canManageSelected ? 5 : 4}>
                              No project members yet.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {projectTab === 'reports' && (
                <div className="overflow-hidden rounded-2xl border border-[#3C3D41]/10 bg-white">
                  <div className="border-b border-[#3C3D41]/10 px-6 py-4 space-y-4">
                    <div>
                      <h2 className="text-lg font-semibold">Saved reports</h2>
                      <p className="mt-1 text-sm text-[#3C3D41]/70">
                        PDFs are stored in Shopify Files and kept on this project until the retention window ends.
                        Current window: {selectedProject.retentionDays} days.
                      </p>
                    </div>
                    {canManageSelected && (
                      <div className="flex flex-wrap items-end gap-3">
                        <label className="space-y-1 text-sm">
                          <span className="font-medium">From</span>
                          <input
                            type="date"
                            value={reportDateFrom}
                            onChange={(event) => setReportDateFrom(event.target.value)}
                            className="block rounded-lg border border-[#3C3D41]/15 px-3 py-2"
                          />
                        </label>
                        <label className="space-y-1 text-sm">
                          <span className="font-medium">To</span>
                          <input
                            type="date"
                            value={reportDateTo}
                            onChange={(event) => setReportDateTo(event.target.value)}
                            className="block rounded-lg border border-[#3C3D41]/15 px-3 py-2"
                          />
                        </label>
                        <label className="space-y-1 text-sm">
                          <span className="font-medium">Audit type</span>
                          <select
                            value={reportSuiteFilter}
                            onChange={(event) => setReportSuiteFilter(event.target.value)}
                            className="block rounded-lg border border-[#3C3D41]/15 px-3 py-2"
                          >
                            <option value="">All audits</option>
                            {Object.entries(SUITE_LABELS).map(([suite, label]) => (
                              <option key={suite} value={suite}>
                                {label}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="space-y-1 text-sm">
                          <span className="font-medium">Run by</span>
                          <select
                            value={reportUserFilter}
                            onChange={(event) => setReportUserFilter(event.target.value)}
                            className="block rounded-lg border border-[#3C3D41]/15 px-3 py-2"
                          >
                            <option value="">All users</option>
                            {reportUsers.map((entry) => (
                              <option key={entry.id} value={entry.id}>
                                {entry.name}
                              </option>
                            ))}
                          </select>
                        </label>
                        <button
                          type="button"
                          onClick={selectVisibleReports}
                          className="rounded-lg border border-[#3C3D41]/15 px-3 py-2 text-sm cursor-pointer"
                        >
                          Select all
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setReportDateFrom('')
                            setReportDateTo('')
                            setReportSuiteFilter('')
                            setReportUserFilter('')
                            setSelectedReportIds([])
                          }}
                          className="rounded-lg border border-[#3C3D41]/15 px-3 py-2 text-sm cursor-pointer"
                        >
                          Clear filters
                        </button>
                        <button
                          type="button"
                          onClick={() => selectReportsOnDate(reportDateFrom || toDateKey(Date.now()))}
                          className="rounded-lg border border-[#3C3D41]/15 px-3 py-2 text-sm cursor-pointer"
                        >
                          Select from date
                        </button>
                        <button
                          type="button"
                          onClick={handleDeleteSelectedReports}
                          disabled={selectedReportIds.length === 0}
                          className="rounded-lg bg-red-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-40 cursor-pointer"
                        >
                          Delete selected ({selectedReportIds.length})
                        </button>
                      </div>
                    )}
                  </div>
                  <table className="w-full text-left text-sm">
                    <thead className="bg-[#f7f5f2] text-xs uppercase tracking-wide text-[#3C3D41]/60">
                      <tr>
                        {canManageSelected && (
                          <th className="px-4 py-3">
                            <input
                              type="checkbox"
                              checked={visibleReports.length > 0 && visibleReports.every((report) => selectedReportIds.includes(report.id))}
                              onChange={(event) => {
                                if (event.target.checked) selectVisibleReports()
                                else setSelectedReportIds([])
                              }}
                            />
                          </th>
                        )}
                        <th className="px-4 py-3">Date</th>
                        <th className="px-4 py-3">Suite</th>
                        <th className="px-4 py-3">Run by</th>
                        <th className="px-4 py-3">Expires</th>
                        <th className="px-4 py-3">Files</th>
                      </tr>
                    </thead>
                    <tbody>
                      {reportsReadyForSelectedProject && visibleReports.map((report) => (
                        <tr key={report.id} className="border-t border-[#3C3D41]/10">
                          {canManageSelected && (
                            <td className="px-4 py-3">
                              <input
                                type="checkbox"
                                checked={selectedReportIds.includes(report.id)}
                                onChange={() => toggleReportSelection(report.id)}
                              />
                            </td>
                          )}
                          <td className="px-4 py-3">{formatDateTime(report.createdAt)}</td>
                          <td className="px-4 py-3">{SUITE_LABELS[report.suite] ?? report.suite}</td>
                          <td className="px-4 py-3">
                            {report.createdBy?.name || 'Unknown'}
                            {report.createdBy?.email ? ` (${report.createdBy.email})` : ''}
                          </td>
                          <td className="px-4 py-3">
                            <div>{formatDateTime(report.expiresAt)}</div>
                            <div className="text-xs text-[#3C3D41]/55">{expiryText(report.expiresAt)}</div>
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex flex-col gap-1">
                              {(report.files ?? []).map((file) => (
                                <a
                                  key={file.fileName}
                                  href={`/api/projects/${selectedProject.id}/reports/${report.id}/download?file=${encodeURIComponent(file.fileName)}`}
                                  className="text-[#F58220] hover:underline"
                                >
                                  {file.fileName}
                                </a>
                              ))}
                            </div>
                          </td>
                        </tr>
                      ))}
                      {(!reportsReadyForSelectedProject || visibleReports.length === 0) && (
                        <tr>
                          <td className="px-4 py-6 text-[#3C3D41]/60" colSpan={canManageSelected ? 6 : 5}>
                            {!reportsReadyForSelectedProject
                              ? 'Loading reports for this project...'
                              : selectedProjectReports.length === 0
                              ? 'No reports stored yet. Run an audit to save one.'
                              : 'No reports match these filters.'}
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}

              {projectTab === 'settings' && (
                <div className="space-y-6">
                  <ProjectDefaultTypography
                    key={`${selectedProject.id}-${selectedProject.updatedAt}`}
                    project={selectedProject}
                    onSave={handleSaveTypographyDefaults}
                  />
                  {canManageSelected && (
                    <div className="rounded-2xl border border-[#3C3D41]/10 bg-white p-6 space-y-4">
                      <h2 className="text-lg font-semibold">Report retention</h2>
                      <p className="text-sm text-[#3C3D41]/70">
                        After this window, this project’s reports are removed from Shopify Files and from project history.
                        Default is 30 days. Only project admins can change this.
                      </p>
                      <label className="block max-w-xs space-y-1">
                        <span className="text-sm font-medium">Keep reports for</span>
                        <select
                          value={selectedProject.retentionDays}
                          onChange={(event) => handleRetentionChange(Number(event.target.value))}
                          className="w-full rounded-lg border border-[#3C3D41]/15 px-3 py-2 outline-none focus:ring-2 focus:ring-[#F58220]"
                        >
                          {RETENTION_OPTIONS.map((days) => (
                            <option key={days} value={days}>
                              {days} days
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {view === 'audit' && !selectedProject && (
            <div className="rounded-2xl border border-[#3C3D41]/10 bg-white p-8">
              <h1 className="text-2xl font-semibold">No project selected</h1>
              <p className="mt-2 text-sm text-[#3C3D41]/70">
                {admin
                  ? 'Create a project to store storefront URL, typography, and page setup.'
                  : 'Ask an admin or project admin to invite you to a project before running audits.'}
              </p>
            </div>
          )}

          {admin && view === 'projects' && (
            <div className="space-y-6">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#F58220]">Admin</p>
                <h1 className="mt-1 text-2xl font-semibold">Projects</h1>
                <p className="mt-1 text-sm text-[#3C3D41]/70">
                  Create a project for each storefront. Membership and roles are managed on the project Team tab.
                </p>
              </div>

              <form onSubmit={handleCreateProject} className="rounded-2xl border border-[#3C3D41]/10 bg-white p-6 space-y-4">
                <h2 className="text-lg font-semibold">New project</h2>
                <label className="block space-y-1">
                  <span className="text-sm font-medium">Project name</span>
                  <input
                    value={projectName}
                    onChange={(event) => setProjectName(event.target.value)}
                    placeholder="Acme Storefront"
                    className="w-full rounded-lg border border-[#3C3D41]/15 px-3 py-2 outline-none focus:ring-2 focus:ring-[#F58220]"
                  />
                </label>
                <fieldset className="space-y-2">
                  <legend className="text-sm font-medium">Optional starting members (as Dev)</legend>
                  {assignableUsers.length === 0 && (
                    <p className="text-sm text-[#3C3D41]/60">No users yet. Invite them after creating the project.</p>
                  )}
                  {assignableUsers.map((entry) => (
                    <label key={entry.id} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={projectMemberIds.includes(entry.id)}
                        onChange={() => setProjectMemberIds((current) => toggleValue(current, entry.id))}
                      />
                      {entry.name} ({entry.email})
                    </label>
                  ))}
                </fieldset>
                <button
                  type="submit"
                  className="rounded-lg bg-[#F58220] px-4 py-2 text-sm font-semibold text-white hover:bg-[#e27518] cursor-pointer"
                >
                  Create project
                </button>
              </form>

              <div className="space-y-4">
                {projects.map((project) => (
                  <div key={project.id} className="rounded-2xl border border-[#3C3D41]/10 bg-white p-6">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <h2 className="text-lg font-semibold">{project.name}</h2>
                        <p className="mt-1 text-sm text-[#3C3D41]/60">
                          {project.config?.url || 'No storefront URL saved yet'}
                        </p>
                        <p className="mt-1 text-sm text-[#3C3D41]/60">
                          Retention {project.retentionDays} days · {(project.members ?? []).length} members
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => openProject(project.id, 'team')}
                        className="text-sm font-medium text-[#F58220] hover:underline cursor-pointer"
                      >
                        Open project
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {canManage && view === 'users' && (
            <div className="space-y-6">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#F58220]">
                  {admin ? 'Admin' : 'Project admin'}
                </p>
                <h1 className="mt-1 text-2xl font-semibold">Users</h1>
                <p className="mt-1 text-sm text-[#3C3D41]/70">
                  {admin
                    ? 'Platform admins can create any account. Prefer inviting from a project Team tab so they join that project automatically. You can still assign projects here after create.'
                    : 'Invite people from a project Team tab. They appear here too. Removing them from a project does not delete their account.'}
                </p>
              </div>

              {admin && (
                <form onSubmit={handleCreateUser} className="rounded-2xl border border-[#3C3D41]/10 bg-white p-6 space-y-4">
                  <h2 className="text-lg font-semibold">Invite users</h2>
                  <p className="text-sm text-[#3C3D41]/70">
                    Add users one by one, choose a role for each, then send secure invite emails.
                  </p>
                  <InviteRowsEditor
                    rows={userInviteRows}
                    onChange={(rows) => {
                      setUserInviteRows(rows)
                      if (rows.every((row) => row.role === ROLE.ADMIN)) {
                        setUserForm((current) => ({ ...current, projectIds: [] }))
                      }
                    }}
                    roleOptions={inviteRoles}
                    roleLabel="Platform role"
                  />
                  {needsProjectAssignment && (
                    <div className="space-y-2">
                      <span className="text-sm font-medium">Assign to projects</span>
                      <ProjectChecklist
                        projects={projects}
                        selectedIds={userForm.projectIds}
                        onChange={(projectIds) => setUserForm((current) => ({ ...current, projectIds }))}
                      />
                    </div>
                  )}
                  <button
                    type="submit"
                    disabled={creatingUser}
                    className="rounded-lg bg-[#F58220] px-4 py-2 text-sm font-semibold text-white hover:bg-[#e27518] cursor-pointer disabled:opacity-40"
                  >
                    {creatingUser ? 'Sending invites...' : 'Send invites'}
                  </button>
                </form>
              )}

              <div className="overflow-hidden rounded-2xl border border-[#3C3D41]/10 bg-white">
                <table className="w-full text-left text-sm">
                  <thead className="bg-[#f7f5f2] text-xs uppercase tracking-wide text-[#3C3D41]/60">
                    <tr>
                      <th className="px-4 py-3">Name</th>
                      <th className="px-4 py-3">Email</th>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3">Projects</th>
                      <th className="px-4 py-3">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.map((entry) => (
                      <tr key={entry.id} className="border-t border-[#3C3D41]/10">
                        <td className="px-4 py-3 font-medium">{entry.name}</td>
                        <td className="px-4 py-3">{entry.email}</td>
                        <td className="px-4 py-3"><InviteStatusBadge user={entry} /></td>
                        <td className="px-4 py-3">
                          {isAdmin(entry) ? (
                            'All projects'
                          ) : (
                            <div className="flex flex-col items-start gap-2">
                              <AssignedProjectChips
                                projects={projects}
                                projectIds={entry.projectIds ?? []}
                              />
                              {admin && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setAssignEditor(entry)
                                    setAssignDraftIds(entry.projectIds ?? [])
                                  }}
                                  className="text-xs font-medium text-[#F58220] hover:underline cursor-pointer"
                                >
                                  Manage projects
                                </button>
                              )}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          {(admin || canIssueResetLink(user, entry)) && entry.id !== user.id && (
                            <div className="flex flex-wrap gap-3">
                              <button
                                type="button"
                                onClick={() => handleAssignPassword(entry)}
                                className="text-[#F58220] hover:underline cursor-pointer"
                              >
                                {entry.inviteStatus === 'pending' ? 'Resend invite' : 'Send reset email'}
                              </button>
                              {admin && (
                                <button
                                  type="button"
                                  onClick={() => handleDeleteUser(entry)}
                                  className="text-red-600 hover:underline cursor-pointer"
                                >
                                  Delete account
                                </button>
                              )}
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {admin && view === 'jobs' && (
            <div className="space-y-6">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#F58220]">Admin</p>
                  <h1 className="mt-1 text-2xl font-semibold">Audit jobs</h1>
                  <p className="mt-1 text-sm text-[#3C3D41]/70">
                    Review recent queued, completed, and failed audits. Retry failed jobs or remove stale entries.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => loadAdminJobs().catch((loadError) => setError(loadError.message))}
                  disabled={adminJobsLoading}
                  className="rounded-lg border border-[#3C3D41]/15 px-4 py-2 text-sm font-medium disabled:opacity-50 cursor-pointer"
                >
                  {adminJobsLoading ? 'Refreshing...' : 'Refresh'}
                </button>
              </div>

              <div className="overflow-hidden rounded-2xl border border-[#3C3D41]/10 bg-white">
                <table className="w-full text-left text-sm">
                  <thead className="bg-[#f7f5f2] text-xs uppercase tracking-wide text-[#3C3D41]/60">
                    <tr>
                      <th className="px-4 py-3">Created</th>
                      <th className="px-4 py-3">Project</th>
                      <th className="px-4 py-3">Audit</th>
                      <th className="px-4 py-3">User</th>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3">Email</th>
                      <th className="px-4 py-3">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {adminJobs.map((job) => (
                      <tr key={job.id} className="border-t border-[#3C3D41]/10">
                        <td className="px-4 py-3">{formatDateTime(job.createdAt)}</td>
                        <td className="px-4 py-3">{job.projectName}</td>
                        <td className="px-4 py-3">{SUITE_LABELS[job.suite] ?? job.suite}</td>
                        <td className="px-4 py-3">
                          {job.requester?.name || 'Unknown'}
                          {job.requester?.email ? <span className="block text-xs text-[#3C3D41]/55">{job.requester.email}</span> : null}
                        </td>
                        <td className="px-4 py-3">
                          <span className="rounded-full bg-[#f7f5f2] px-2 py-1 text-xs font-medium">{job.status}</span>
                          {job.error ? <span className="mt-1 block max-w-xs truncate text-xs text-red-600">{job.error}</span> : null}
                        </td>
                        <td className="px-4 py-3">
                          {job.emailNotificationError ? (
                            <span className="text-red-600">Failed</span>
                          ) : job.emailNotificationSentAt ? (
                            <span className="text-green-700">Sent</span>
                          ) : (
                            <span className="text-[#3C3D41]/55">Pending</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap gap-3">
                            <button
                              type="button"
                              onClick={() => handleAdminJobAction(job.id, 'retry')}
                              disabled={!['failed', 'queued'].includes(job.status)}
                              className="text-[#F58220] hover:underline disabled:text-[#3C3D41]/30 disabled:no-underline cursor-pointer"
                            >
                              Retry
                            </button>
                            <button
                              type="button"
                              onClick={() => handleAdminJobAction(job.id, 'delete')}
                              className="text-red-600 hover:underline cursor-pointer"
                            >
                              Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                    {!adminJobsLoading && adminJobs.length === 0 && (
                      <tr>
                        <td className="px-4 py-6 text-[#3C3D41]/60" colSpan={7}>
                          No recent audit jobs found.
                        </td>
                      </tr>
                    )}
                    {adminJobsLoading && (
                      <tr>
                        <td className="px-4 py-6 text-[#3C3D41]/60" colSpan={7}>
                          Loading audit jobs...
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {canManage && view === 'activity' && (
            <div className="space-y-6">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#F58220]">
                  {admin ? 'Admin' : 'Project admin'}
                </p>
                <h1 className="mt-1 text-2xl font-semibold">Activity log</h1>
                <p className="mt-1 text-sm text-[#3C3D41]/70">
                  User and report changes are kept for {activityRetentionDays} days.
                  {admin ? '' : ' You only see events for projects you admin.'}
                </p>
              </div>
              <form
                onSubmit={handleActivityFilter}
                className="flex flex-wrap items-end gap-3 rounded-2xl border border-[#3C3D41]/10 bg-white p-4"
              >
                <label className="space-y-1 text-sm">
                  <span className="font-medium">From</span>
                  <input
                    type="date"
                    value={activityDateFrom}
                    onChange={(event) => setActivityDateFrom(event.target.value)}
                    className="block rounded-lg border border-[#3C3D41]/15 px-3 py-2"
                  />
                </label>
                <label className="space-y-1 text-sm">
                  <span className="font-medium">To</span>
                  <input
                    type="date"
                    value={activityDateTo}
                    onChange={(event) => setActivityDateTo(event.target.value)}
                    className="block rounded-lg border border-[#3C3D41]/15 px-3 py-2"
                  />
                </label>
                <button
                  type="submit"
                  disabled={activityLoading}
                  className="rounded-lg bg-[#F58220] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 cursor-pointer"
                >
                  Apply
                </button>
                <button
                  type="button"
                  onClick={clearActivityFilter}
                  disabled={activityLoading || (!activityDateFrom && !activityDateTo)}
                  className="rounded-lg border border-[#3C3D41]/15 px-4 py-2 text-sm font-medium disabled:opacity-50 cursor-pointer"
                >
                  Clear
                </button>
                <p className="text-sm text-[#3C3D41]/60">
                  {activityLoading
                    ? 'Loading activity...'
                    : `Showing page ${activityPage} of ${activityTotalPages} · ${activityTotal} event${activityTotal === 1 ? '' : 's'}`}
                </p>
              </form>
              <div className="overflow-hidden rounded-2xl border border-[#3C3D41]/10 bg-white">
                <table className="w-full text-left text-sm">
                  <thead className="bg-[#f7f5f2] text-xs uppercase tracking-wide text-[#3C3D41]/60">
                    <tr>
                      <th className="px-4 py-3">When</th>
                      <th className="px-4 py-3">Who</th>
                      <th className="px-4 py-3">Action</th>
                      <th className="px-4 py-3">Detail</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activityLoading ? (
                      <tr>
                        <td className="px-4 py-6 text-[#3C3D41]/60" colSpan={4}>
                          Loading activity...
                        </td>
                      </tr>
                    ) : activityEvents.map((event) => (
                      <tr key={event.id} className="border-t border-[#3C3D41]/10">
                        <td className="px-4 py-3">{formatDateTime(event.at)}</td>
                        <td className="px-4 py-3">
                          {event.actor?.name || 'Unknown'}
                          {event.actor?.email ? ` (${event.actor.email})` : ''}
                        </td>
                        <td className="px-4 py-3">{ACTIVITY_LABELS[event.action] ?? event.action}</td>
                        <td className="px-4 py-3">
                          {event.detail}
                          {event.target?.email ? ` · ${event.target.email}` : ''}
                          {event.projectName ? ` · ${event.projectName}` : ''}
                        </td>
                      </tr>
                    ))}
                    {!activityLoading && activityEvents.length === 0 && (
                      <tr>
                        <td className="px-4 py-6 text-[#3C3D41]/60" colSpan={4}>
                          No activity in this date range.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              <div className="flex items-center justify-between rounded-2xl border border-[#3C3D41]/10 bg-white px-4 py-3">
                <p className="text-sm text-[#3C3D41]/60">
                  Page {activityPage} of {activityTotalPages}
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => changeActivityPage(activityPage - 1)}
                    disabled={activityLoading || activityPage <= 1}
                    className="rounded-lg border border-[#3C3D41]/15 px-4 py-2 text-sm font-medium disabled:opacity-50 cursor-pointer"
                  >
                    Previous
                  </button>
                  <button
                    type="button"
                    onClick={() => changeActivityPage(activityPage + 1)}
                    disabled={activityLoading || activityPage >= activityTotalPages}
                    className="rounded-lg border border-[#3C3D41]/15 px-4 py-2 text-sm font-medium disabled:opacity-50 cursor-pointer"
                  >
                    Next
                  </button>
                </div>
              </div>
            </div>
          )}

          {view === 'account' && (
            <div className="space-y-6">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#F58220]">Account</p>
                <h1 className="mt-1 text-2xl font-semibold">Profile settings</h1>
                <p className="mt-1 text-sm text-[#3C3D41]/70">
                  Update your display name and keep your password secure.
                </p>
              </div>

              <div className="grid gap-6 xl:grid-cols-2">
                <form onSubmit={handleUpdateProfile} className="rounded-2xl border border-[#3C3D41]/10 bg-white p-6 space-y-4">
                  <h2 className="text-lg font-semibold">Profile</h2>
                  <label className="space-y-1">
                    <span className="text-sm font-medium">Name</span>
                    <input
                      value={profileForm.name}
                      onChange={(event) => setProfileForm((current) => ({ ...current, name: event.target.value }))}
                      className="w-full rounded-lg border border-[#3C3D41]/15 px-3 py-2 outline-none focus:ring-2 focus:ring-[#F58220]"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-sm font-medium">Email</span>
                    <input
                      value={user.email}
                      readOnly
                      className="w-full rounded-lg border border-[#3C3D41]/15 bg-[#f7f5f2] px-3 py-2 text-[#3C3D41]/70"
                    />
                  </label>
                  <button
                    type="submit"
                    className="mt-3 rounded-lg bg-[#F58220] px-4 py-2 text-sm font-semibold text-white hover:bg-[#e27518] cursor-pointer"
                  >
                    Save profile
                  </button>
                </form>

                <form onSubmit={handleChangeOwnPassword} className="rounded-2xl border border-[#3C3D41]/10 bg-white p-6 space-y-4">
                  <h2 className="text-lg font-semibold">Change password</h2>
                  <PasswordField
                    className="mt-0"
                    label="Current password"
                    autoComplete="current-password"
                    value={passwordForm.currentPassword}
                    onChange={(event) =>
                      setPasswordForm((current) => ({ ...current, currentPassword: event.target.value }))
                    }
                  />
                  <PasswordField
                    label="New password"
                    autoComplete="new-password"
                    value={passwordForm.password}
                    onChange={(event) => setPasswordForm((current) => ({ ...current, password: event.target.value }))}
                  />
                  <PasswordField
                    label="Confirm new password"
                    autoComplete="new-password"
                    value={passwordForm.confirmPassword}
                    onChange={(event) =>
                      setPasswordForm((current) => ({ ...current, confirmPassword: event.target.value }))
                    }
                  />
                  <button
                    type="submit"
                    className="mt-3 rounded-lg bg-[#F58220] px-4 py-2 text-sm font-semibold text-white hover:bg-[#e27518] cursor-pointer"
                  >
                    Update password
                  </button>
                </form>
              </div>
            </div>
          )}
        </main>
      </div>

      {assignEditor && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#3C3D41]/40 p-4"
          onClick={() => {
            if (!assignSaving) setAssignEditor(null)
          }}
        >
          <div
            className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 className="text-lg font-semibold">Assign projects</h2>
            <p className="mt-1 text-sm text-[#3C3D41]/70">
              {assignEditor.name} ({assignEditor.email})
            </p>
            <div className="mt-4">
              <ProjectChecklist projects={projects} selectedIds={assignDraftIds} onChange={setAssignDraftIds} />
            </div>
            <div className="mt-5 flex justify-end gap-3">
              <button
                type="button"
                disabled={assignSaving}
                onClick={() => setAssignEditor(null)}
                className="rounded-lg border border-[#3C3D41]/15 px-4 py-2 text-sm cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={assignSaving}
                onClick={() => handleAssignUserProjects(assignEditor, assignDraftIds)}
                className="rounded-lg bg-[#F58220] px-4 py-2 text-sm font-semibold text-white hover:bg-[#e27518] cursor-pointer disabled:opacity-40"
              >
                {assignSaving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
