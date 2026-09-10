'use client'

import Image from 'next/image'
import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import AuditWizard from './audit-wizard'
import { ProjectDefaultTypography } from './typography-editor.jsx'
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

function formatDateTime(value) {
  if (!value) return '—'
  return new Date(value).toLocaleString()
}

function projectRoleLabel(user, project) {
  const role = getProjectRole(user, project)
  if (role === ROLE.ADMIN) return 'Admin'
  return roleLabel(role)
}

export default function AppHome({ initialUser, initialProjects = [], initialUsers = [] }) {
  const router = useRouter()
  const [user] = useState(initialUser)
  const [projects, setProjects] = useState(initialProjects)
  const [users, setUsers] = useState(initialUsers)
  const [selectedProjectId, setSelectedProjectId] = useState(initialProjects[0]?.id ?? '')
  const [view, setView] = useState('audit')
  const [projectTab, setProjectTab] = useState('audit')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const [projectName, setProjectName] = useState('')
  const [projectMemberIds, setProjectMemberIds] = useState([])

  const [generatedPassword, setGeneratedPassword] = useState('')
  const [members, setMembers] = useState([])
  const [reports, setReports] = useState([])
  const [inviteForm, setInviteForm] = useState({
    name: '',
    email: '',
    role: ROLE.DEV,
  })

  const [userForm, setUserForm] = useState({
    name: '',
    email: '',
    role: ROLE.DEV,
    projectIds: [],
  })
  const [passwordForm, setPasswordForm] = useState({
    currentPassword: '',
    password: '',
    confirmPassword: '',
  })

  const admin = isAdmin(user)
  const canManage = canManageUsers(user)
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
  const needsProjectAssignment = userForm.role === ROLE.DEV || userForm.role === ROLE.PROJECT_ADMIN

  async function refreshAdminUsers() {
    const userData = await readJson(await fetch('/api/admin/users'))
    setUsers(userData.users)
  }

  async function refreshProjects() {
    const projectData = await readJson(await fetch('/api/projects'))
    setProjects(projectData.projects)
  }

  async function loadProjectExtras(projectId) {
    if (!projectId) {
      setMembers([])
      setReports([])
      return
    }

    const [memberData, reportData] = await Promise.all([
      readJson(await fetch(`/api/projects/${projectId}/members`)),
      readJson(await fetch(`/api/projects/${projectId}/reports`)),
    ])
    setMembers(memberData.members ?? [])
    setReports(reportData.reports ?? [])
  }

  async function signOut() {
    await fetch('/api/auth/logout', { method: 'POST' })
    router.replace('/login')
    router.refresh()
  }

  function openProject(projectId, tab = 'audit') {
    setSelectedProjectId(projectId)
    setView('audit')
    setProjectTab(tab)
    loadProjectExtras(projectId).catch((loadError) => setError(loadError.message))
  }

  async function handleCreateProject(event) {
    event.preventDefault()
    setNotice('')
    setError('')
    try {
      const data = await readJson(
        await fetch('/api/projects', {
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
      await fetch(`/api/projects/${selectedProject.id}`, {
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
        await fetch(`/api/projects/${selectedProject.id}`, {
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
    setGeneratedPassword('')
    try {
      const data = await readJson(
        await fetch(`/api/projects/${selectedProject.id}/members`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(inviteForm),
        }),
      )
      setInviteForm({ name: '', email: '', role: ROLE.DEV })
      if (data.temporaryPassword) setGeneratedPassword(data.temporaryPassword)
      await refreshProjects()
      await loadProjectExtras(selectedProject.id)
      if (canManage) await refreshAdminUsers()
      setNotice(
        data.created
          ? `${data.user.email} was added. Copy the generated password below and send it to them yourself.`
          : `${data.user.email} was added to this project.`,
      )
    } catch (submitError) {
      setError(submitError.message)
    }
  }

  async function handleMemberRoleChange(userId, role) {
    if (!selectedProject) return
    setError('')
    try {
      await readJson(
        await fetch(`/api/projects/${selectedProject.id}/members`, {
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
        await fetch(`/api/projects/${selectedProject.id}/members?userId=${encodeURIComponent(entry.id)}`, {
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
    setNotice('')
    setError('')
    try {
      const data = await readJson(
        await fetch('/api/admin/users', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(userForm),
        }),
      )
      setUsers((current) => [...current, data.user])
      setUserForm({
        name: '',
        email: '',
        role: ROLE.DEV,
        projectIds: [],
      })
      if (data.temporaryPassword) setGeneratedPassword(data.temporaryPassword)
      await refreshAdminUsers()
      await refreshProjects()
      setNotice(
        data.temporaryPassword
          ? `${data.user.email} was created. Copy the generated password below and send it to them yourself.`
          : 'User created',
      )
    } catch (submitError) {
      setError(submitError.message)
    }
  }

  async function handleDeleteUser(entry) {
    if (!window.confirm(`Delete ${entry.name} (${entry.email}) from the system?`)) return
    setNotice('')
    setError('')
    try {
      await readJson(await fetch(`/api/admin/users/${entry.id}`, { method: 'DELETE' }))
      setUsers((current) => current.filter((userEntry) => userEntry.id !== entry.id))
      await refreshProjects()
      setNotice('User deleted')
    } catch (submitError) {
      setError(submitError.message)
    }
  }

  async function handleAssignPassword(entry) {
    if (!window.confirm(`Generate a new password for ${entry.email}? Their current password will stop working.`)) return
    setNotice('')
    setError('')
    setGeneratedPassword('')
    try {
      const data = await readJson(
        await fetch(`/api/admin/users/${entry.id}/password`, { method: 'POST' }),
      )
      setGeneratedPassword(data.temporaryPassword)
      setNotice(`New password generated for ${entry.email}. Copy it below and send it to them yourself.`)
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
        await fetch('/api/auth/change-password', {
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
                <button
                  type="button"
                  onClick={() => setView('users')}
                  className={`w-full rounded-lg px-3 py-2 text-left text-sm cursor-pointer ${
                    view === 'users' ? 'bg-white/15 text-white' : 'text-white/80 hover:bg-white/10'
                  }`}
                >
                  Manage users
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
          {generatedPassword && (
            <div className="mb-4 rounded-xl border border-[#F58220]/30 bg-white px-4 py-3 text-sm">
              <p className="font-medium">Generated password — send this yourself</p>
              <p className="mt-2 break-all font-mono text-[#3C3D41]">{generatedPassword}</p>
              <p className="mt-2 text-xs text-[#3C3D41]/60">This is shown once. They can change it after signing in.</p>
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
                        A new person is added only to this project. We generate a password for them — copy it and send
                        it yourself. An existing person is added here without changing their password.
                      </p>
                      <div className="grid gap-4 md:grid-cols-2">
                        <label className="space-y-1">
                          <span className="text-sm font-medium">Name</span>
                          <input
                            value={inviteForm.name}
                            onChange={(event) => setInviteForm((current) => ({ ...current, name: event.target.value }))}
                            className="w-full rounded-lg border border-[#3C3D41]/15 px-3 py-2 outline-none focus:ring-2 focus:ring-[#F58220]"
                          />
                        </label>
                        <label className="space-y-1">
                          <span className="text-sm font-medium">Email</span>
                          <input
                            type="email"
                            value={inviteForm.email}
                            onChange={(event) => setInviteForm((current) => ({ ...current, email: event.target.value }))}
                            className="w-full rounded-lg border border-[#3C3D41]/15 px-3 py-2 outline-none focus:ring-2 focus:ring-[#F58220]"
                          />
                        </label>
                        <label className="space-y-1">
                          <span className="text-sm font-medium">Role on this project</span>
                          <select
                            value={inviteForm.role}
                            onChange={(event) => setInviteForm((current) => ({ ...current, role: event.target.value }))}
                            className="w-full rounded-lg border border-[#3C3D41]/15 px-3 py-2 outline-none focus:ring-2 focus:ring-[#F58220]"
                          >
                            <option value={ROLE.DEV}>Dev</option>
                            <option value={ROLE.PROJECT_ADMIN}>Project admin</option>
                          </select>
                        </label>
                      </div>
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
                          <th className="px-4 py-3">Role on this project</th>
                          {canManageSelected && <th className="px-4 py-3">Actions</th>}
                        </tr>
                      </thead>
                      <tbody>
                        {members.map((entry) => (
                          <tr key={entry.id} className="border-t border-[#3C3D41]/10">
                            <td className="px-4 py-3 font-medium">{entry.name}</td>
                            <td className="px-4 py-3">{entry.email}</td>
                            <td className="px-4 py-3">
                              {canManageSelected && entry.id !== user.id ? (
                                <select
                                  value={entry.projectRole}
                                  onChange={(event) => handleMemberRoleChange(entry.id, event.target.value)}
                                  className="rounded-lg border border-[#3C3D41]/15 px-2 py-1"
                                >
                                  <option value={ROLE.DEV}>Dev</option>
                                  <option value={ROLE.PROJECT_ADMIN}>Project admin</option>
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
                        {members.length === 0 && (
                          <tr>
                            <td className="px-4 py-6 text-[#3C3D41]/60" colSpan={canManageSelected ? 4 : 3}>
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
                  <div className="border-b border-[#3C3D41]/10 px-6 py-4">
                    <h2 className="text-lg font-semibold">Saved reports</h2>
                    <p className="mt-1 text-sm text-[#3C3D41]/70">
                      PDFs are stored in Shopify Files and kept on this project until the retention window ends.
                      Current window: {selectedProject.retentionDays} days.
                    </p>
                  </div>
                  <table className="w-full text-left text-sm">
                    <thead className="bg-[#f7f5f2] text-xs uppercase tracking-wide text-[#3C3D41]/60">
                      <tr>
                        <th className="px-4 py-3">Date</th>
                        <th className="px-4 py-3">Suite</th>
                        <th className="px-4 py-3">Run by</th>
                        <th className="px-4 py-3">Expires</th>
                        <th className="px-4 py-3">Files</th>
                      </tr>
                    </thead>
                    <tbody>
                      {reports.map((report) => (
                        <tr key={report.id} className="border-t border-[#3C3D41]/10">
                          <td className="px-4 py-3">{formatDateTime(report.createdAt)}</td>
                          <td className="px-4 py-3">{SUITE_LABELS[report.suite] ?? report.suite}</td>
                          <td className="px-4 py-3">
                            {report.createdBy?.name || 'Unknown'}
                            {report.createdBy?.email ? ` (${report.createdBy.email})` : ''}
                          </td>
                          <td className="px-4 py-3">{formatDateTime(report.expiresAt)}</td>
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
                      {reports.length === 0 && (
                        <tr>
                          <td className="px-4 py-6 text-[#3C3D41]/60" colSpan={5}>
                            No reports stored yet. Run an audit to save one.
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
                    ? 'Platform admins can create any account. Prefer inviting people from a project Team tab so they join only that project.'
                    : 'Invite people from a project Team tab. Removing them from a project does not delete their account.'}
                </p>
              </div>

              {admin && (
                <form onSubmit={handleCreateUser} className="rounded-2xl border border-[#3C3D41]/10 bg-white p-6 space-y-4">
                  <h2 className="text-lg font-semibold">Create user</h2>
                  <div className="grid gap-4 md:grid-cols-2">
                    <label className="space-y-1">
                      <span className="text-sm font-medium">Name</span>
                      <input
                        value={userForm.name}
                        onChange={(event) => setUserForm((current) => ({ ...current, name: event.target.value }))}
                        className="w-full rounded-lg border border-[#3C3D41]/15 px-3 py-2 outline-none focus:ring-2 focus:ring-[#F58220]"
                      />
                    </label>
                    <label className="space-y-1">
                      <span className="text-sm font-medium">Email</span>
                      <input
                        type="email"
                        value={userForm.email}
                        onChange={(event) => setUserForm((current) => ({ ...current, email: event.target.value }))}
                        className="w-full rounded-lg border border-[#3C3D41]/15 px-3 py-2 outline-none focus:ring-2 focus:ring-[#F58220]"
                      />
                    </label>
                    <label className="space-y-1">
                      <span className="text-sm font-medium">Platform role</span>
                      <select
                        value={userForm.role}
                        onChange={(event) =>
                          setUserForm((current) => ({ ...current, role: event.target.value, projectIds: [] }))
                        }
                        className="w-full rounded-lg border border-[#3C3D41]/15 px-3 py-2 outline-none focus:ring-2 focus:ring-[#F58220]"
                      >
                        {inviteRoles.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  {needsProjectAssignment && (
                    <fieldset className="space-y-2">
                      <legend className="text-sm font-medium">Assign to projects</legend>
                      {projects.map((project) => (
                        <label key={project.id} className="flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={userForm.projectIds.includes(project.id)}
                            onChange={() =>
                              setUserForm((current) => ({
                                ...current,
                                projectIds: toggleValue(current.projectIds, project.id),
                              }))
                            }
                          />
                          {project.name}
                        </label>
                      ))}
                    </fieldset>
                  )}
                  <button
                    type="submit"
                    className="rounded-lg bg-[#F58220] px-4 py-2 text-sm font-semibold text-white hover:bg-[#e27518] cursor-pointer"
                  >
                    Create user
                  </button>
                </form>
              )}

              <div className="overflow-hidden rounded-2xl border border-[#3C3D41]/10 bg-white">
                <table className="w-full text-left text-sm">
                  <thead className="bg-[#f7f5f2] text-xs uppercase tracking-wide text-[#3C3D41]/60">
                    <tr>
                      <th className="px-4 py-3">Name</th>
                      <th className="px-4 py-3">Email</th>
                      <th className="px-4 py-3">Projects</th>
                      <th className="px-4 py-3">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.map((entry) => (
                      <tr key={entry.id} className="border-t border-[#3C3D41]/10">
                        <td className="px-4 py-3 font-medium">{entry.name}</td>
                        <td className="px-4 py-3">{entry.email}</td>
                        <td className="px-4 py-3">
                          {isAdmin(entry)
                            ? 'All projects'
                            : projects
                                .filter((project) => entry.projectIds.includes(project.id))
                                .map((project) => `${project.name} (${roleLabel(entry.projectRoles?.[project.id] ?? ROLE.DEV)})`)
                                .join(', ') || 'None'}
                        </td>
                        <td className="px-4 py-3">
                          {(admin || canIssueResetLink(user, entry)) && entry.id !== user.id && (
                            <div className="flex flex-wrap gap-3">
                              <button
                                type="button"
                                onClick={() => handleAssignPassword(entry)}
                                className="text-[#F58220] hover:underline cursor-pointer"
                              >
                                New password
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

          {view === 'account' && (
            <div className="space-y-6">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#F58220]">Account</p>
                <h1 className="mt-1 text-2xl font-semibold">Change password</h1>
                <p className="mt-1 text-sm text-[#3C3D41]/70">
                  There is no forgot-password email. After you are signed in, you can set a new password here. An
                  admin can generate a new password for someone else and send it manually.
                </p>
              </div>
              <form onSubmit={handleChangeOwnPassword} className="max-w-md rounded-2xl border border-[#3C3D41]/10 bg-white p-6 space-y-4">
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
                  className="rounded-lg bg-[#F58220] px-4 py-2 text-sm font-semibold text-white hover:bg-[#e27518] cursor-pointer"
                >
                  Update password
                </button>
              </form>
            </div>
          )}
        </main>
      </div>
    </div>
  )
}
