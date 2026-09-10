'use client'

import { useMemo, useState } from 'react'

function ProjectChecklist({ projects, selectedIds, onChange }) {
  const [query, setQuery] = useState('')
  const selected = useMemo(() => new Set(selectedIds), [selectedIds])
  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase()
    if (!term) return projects
    return projects.filter((project) => project.name.toLowerCase().includes(term))
  }, [projects, query])

  function toggle(projectId) {
    const next = selected.has(projectId)
      ? selectedIds.filter((id) => id !== projectId)
      : [...selectedIds, projectId]
    onChange(next)
  }

  return (
    <div className="space-y-2">
      {projects.length > 6 && (
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search projects"
          className="w-full rounded-lg border border-[#3C3D41]/15 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#F58220]"
        />
      )}
      <div className="max-h-52 overflow-y-auto rounded-xl border border-[#3C3D41]/10">
        {filtered.map((project) => (
          <label
            key={project.id}
            className="flex cursor-pointer items-center gap-2 border-b border-[#3C3D41]/5 px-3 py-2 text-sm last:border-b-0 hover:bg-[#f7f5f2]"
          >
            <input
              type="checkbox"
              checked={selected.has(project.id)}
              onChange={() => toggle(project.id)}
            />
            <span className="truncate">{project.name}</span>
          </label>
        ))}
        {filtered.length === 0 && (
          <p className="px-3 py-4 text-sm text-[#3C3D41]/60">
            {projects.length === 0 ? 'No projects yet.' : 'No matching projects.'}
          </p>
        )}
      </div>
      <p className="text-xs text-[#3C3D41]/60">{selectedIds.length} selected</p>
    </div>
  )
}

function AssignedProjectChips({ projects, projectIds, limit = 2 }) {
  const assigned = projects.filter((project) => projectIds.includes(project.id))
  if (assigned.length === 0) {
    return <span className="text-[#3C3D41]/60">None</span>
  }

  const shown = assigned.slice(0, limit)
  const extra = assigned.length - shown.length

  return (
    <div className="flex flex-wrap items-center gap-1">
      {shown.map((project) => (
        <span
          key={project.id}
          className="inline-flex max-w-[10rem] truncate rounded-full bg-[#f7f5f2] px-2 py-0.5 text-xs text-[#3C3D41]"
          title={project.name}
        >
          {project.name}
        </span>
      ))}
      {extra > 0 && (
        <span className="text-xs text-[#3C3D41]/60">+{extra} more</span>
      )}
    </div>
  )
}

export { AssignedProjectChips, ProjectChecklist }
