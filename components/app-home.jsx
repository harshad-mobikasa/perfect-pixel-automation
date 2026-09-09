'use client'

import Image from 'next/image'
import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import AuditWizard from './audit-wizard'

function roleLabel(role) {
  return role === 'admin' ? 'Admin' : 'Project user'
}

async function readJson(response) {
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(data.error ?? 'Request failed')
  }
  return data
}

export default function AppHome({ initialUser, initialProjects = [], initialUsers = [] }) {
  const router = useRouter()
  const [user] = useState(initialUser)
  const [projects, setProjects] = useState(initialProjects)
  const [users, setUsers] = useState(initialUsers)
  const [selectedProjectId, setSelectedProjectId] = useState(initialProjects[0]?.id ?? '')
  const [view, setView] = useState('audit')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const [projectName, setProjectName] = useState('')
  const [projectMemberIds, setProjectMemberIds] = useState([])

  const [userForm, setUserForm] = useState({
    name: '',
    email: '',
    password: '',
    role: 'member',
    projectIds: [],
  })

  const isAdmin = user?.role === 'admin'
  const selectedProject = useMemo(
    () => projects.find((project) => project.id === selectedProjectId) ?? null,
    [projects, selectedProjectId],
  )
  const memberUsers = users.filter((entry) => entry.role === 'member')

  async function refreshAdminUsers() {
    const userData = await readJson(await fetch('/api/admin/users'))
    setUsers(userData.users)
  }

  async function signOut() {
    await fetch('/api/auth/logout', { method: 'POST' })
    router.replace('/login')
    router.refresh()
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

  async function handleAssignMembers(projectId, memberIds) {
    setError('')
    try {
      const data = await readJson(
        await fetch(`/api/projects/${projectId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ memberIds }),
        }),
      )
      setProjects((current) => current.map((project) => (project.id === data.project.id ? data.project : project)))
      const userData = await readJson(await fetch('/api/admin/users'))
      setUsers(userData.users)
      setNotice('Project members updated')
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
        password: '',
        role: 'member',
        projectIds: [],
      })
      await refreshAdminUsers()
      const projectData = await readJson(await fetch('/api/projects'))
      setProjects(projectData.projects)
      setNotice('User created')
    } catch (submitError) {
      setError(submitError.message)
    }
  }

  function toggleValue(list, value) {
    return list.includes(value) ? list.filter((entry) => entry !== value) : [...list, value]
  }

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
                onClick={() => {
                  setSelectedProjectId(project.id)
                  setView('audit')
                }}
                className={`w-full rounded-lg px-3 py-2 text-left text-sm cursor-pointer ${
                  selectedProjectId === project.id && view === 'audit'
                    ? 'bg-[#F58220] text-white'
                    : 'text-white/80 hover:bg-white/10'
                }`}
              >
                {project.name}
              </button>
            ))}

            {isAdmin && (
              <>
                <p className="px-2 pb-2 pt-5 text-[11px] font-semibold uppercase tracking-[0.16em] text-white/40">
                  Admin
                </p>
                <button
                  type="button"
                  onClick={() => setView('projects')}
                  className={`w-full rounded-lg px-3 py-2 text-left text-sm cursor-pointer ${
                    view === 'projects' ? 'bg-white/15 text-white' : 'text-white/80 hover:bg-white/10'
                  }`}
                >
                  Manage projects
                </button>
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
          </nav>

          <div className="border-t border-white/10 px-5 py-4">
            <div className="text-sm font-medium">{user?.name}</div>
            <div className="mt-1 text-xs text-white/60">
              {user?.email} · {roleLabel(user?.role)}
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

          {view === 'audit' && selectedProject && (
            <AuditWizard
              key={selectedProject.id}
              project={selectedProject}
              onSaveConfig={handleSaveProjectConfig}
            />
          )}

          {view === 'audit' && !selectedProject && (
            <div className="rounded-2xl border border-[#3C3D41]/10 bg-white p-8">
              <h1 className="text-2xl font-semibold">No project selected</h1>
              <p className="mt-2 text-sm text-[#3C3D41]/70">
                {isAdmin
                  ? 'Create a project to store storefront URL, typography, and page setup.'
                  : 'Ask an admin to assign you to a project before running audits.'}
              </p>
            </div>
          )}

          {isAdmin && view === 'projects' && (
            <div className="space-y-6">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#F58220]">Admin</p>
                <h1 className="mt-1 text-2xl font-semibold">Projects</h1>
                <p className="mt-1 text-sm text-[#3C3D41]/70">
                  Create a project for each storefront. Project users can save URL, typography, and page config.
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
                  <legend className="text-sm font-medium">Assign project users</legend>
                  {memberUsers.length === 0 && (
                    <p className="text-sm text-[#3C3D41]/60">No project users yet. Create them in Manage users.</p>
                  )}
                  {memberUsers.map((entry) => (
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
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedProjectId(project.id)
                          setView('audit')
                        }}
                        className="text-sm font-medium text-[#F58220] hover:underline cursor-pointer"
                      >
                        Open audit
                      </button>
                    </div>
                    <fieldset className="mt-4 space-y-2">
                      <legend className="text-sm font-medium">Project users</legend>
                      {memberUsers.map((entry) => (
                        <label key={entry.id} className="flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={project.memberIds.includes(entry.id)}
                            onChange={() => {
                              const next = toggleValue(project.memberIds, entry.id)
                              handleAssignMembers(project.id, next)
                            }}
                          />
                          {entry.name} ({entry.email})
                        </label>
                      ))}
                    </fieldset>
                  </div>
                ))}
              </div>
            </div>
          )}

          {isAdmin && view === 'users' && (
            <div className="space-y-6">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#F58220]">Admin</p>
                <h1 className="mt-1 text-2xl font-semibold">Users</h1>
                <p className="mt-1 text-sm text-[#3C3D41]/70">
                  Admins can see every project. Project users only work in the projects you assign.
                </p>
              </div>

              <form onSubmit={handleCreateUser} className="rounded-2xl border border-[#3C3D41]/10 bg-white p-6 space-y-4">
                <h2 className="text-lg font-semibold">Invite user</h2>
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
                    <span className="text-sm font-medium">Temporary password</span>
                    <input
                      type="password"
                      value={userForm.password}
                      onChange={(event) => setUserForm((current) => ({ ...current, password: event.target.value }))}
                      className="w-full rounded-lg border border-[#3C3D41]/15 px-3 py-2 outline-none focus:ring-2 focus:ring-[#F58220]"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-sm font-medium">Role</span>
                    <select
                      value={userForm.role}
                      onChange={(event) => setUserForm((current) => ({ ...current, role: event.target.value }))}
                      className="w-full rounded-lg border border-[#3C3D41]/15 px-3 py-2 outline-none focus:ring-2 focus:ring-[#F58220]"
                    >
                      <option value="member">Project user</option>
                      <option value="admin">Admin</option>
                    </select>
                  </label>
                </div>
                {userForm.role === 'member' && (
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

              <div className="overflow-hidden rounded-2xl border border-[#3C3D41]/10 bg-white">
                <table className="w-full text-left text-sm">
                  <thead className="bg-[#f7f5f2] text-xs uppercase tracking-wide text-[#3C3D41]/60">
                    <tr>
                      <th className="px-4 py-3">Name</th>
                      <th className="px-4 py-3">Email</th>
                      <th className="px-4 py-3">Role</th>
                      <th className="px-4 py-3">Projects</th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.map((entry) => (
                      <tr key={entry.id} className="border-t border-[#3C3D41]/10">
                        <td className="px-4 py-3 font-medium">{entry.name}</td>
                        <td className="px-4 py-3">{entry.email}</td>
                        <td className="px-4 py-3">{roleLabel(entry.role)}</td>
                        <td className="px-4 py-3">
                          {entry.role === 'admin'
                            ? 'All projects'
                            : projects
                                .filter((project) => entry.projectIds.includes(project.id))
                                .map((project) => project.name)
                                .join(', ') || 'None'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  )
}
