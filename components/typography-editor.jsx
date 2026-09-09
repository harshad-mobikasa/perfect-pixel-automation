'use client'

import { useEffect, useRef, useState } from 'react'
import defaultTypographyTemplate from '../configs/playwright.typography.json'

const TYPOGRAPHY_BLOCK_OPTIONS = [
  { name: 'HEADINGS', label: 'Headings', matches: 'h1 to h6' },
  { name: 'PARAGRAPH', label: 'Paragraph', matches: 'p' },
  { name: 'ANCHOR', label: 'Anchor', matches: 'a' },
  { name: 'BUTTON', label: 'Button', matches: 'button' },
]

function makeId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function cloneTypographyTemplate() {
  return JSON.parse(JSON.stringify(defaultTypographyTemplate))
}

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value))
}

function setNestedValue(target, path, nextValue) {
  if (path.length === 0) {
    return nextValue
  }

  const [head, ...rest] = path
  return {
    ...target,
    [head]: setNestedValue(target[head], rest, nextValue),
  }
}

function formatFieldLabel(value) {
  return value
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .replace(/\b\w/g, (char) => char.toUpperCase())
}

function getTypographyBlockMeta(name) {
  return TYPOGRAPHY_BLOCK_OPTIONS.find((option) => option.name === name) ?? {
    name,
    label: formatFieldLabel(name),
    matches: 'custom tag mapping',
  }
}

function createTypographyBlocks() {
  const template = cloneTypographyTemplate()
  return TYPOGRAPHY_BLOCK_OPTIONS.filter((option) => template[option.name]).map((option) => ({
    id: makeId(),
    name: option.name,
    value: cloneValue(template[option.name]),
  }))
}

function hydrateTypography(rawBlocks) {
  if (!Array.isArray(rawBlocks) || rawBlocks.length === 0) {
    return createTypographyBlocks()
  }

  return rawBlocks.map((block) => ({
    id: makeId(),
    name: block.name,
    value: cloneValue(block.value ?? {}),
  }))
}

function serializeTypographyBlocks(blocks) {
  return blocks.map((block) => ({
    name: block.name,
    value: cloneValue(block.value),
  }))
}

function buildTypographyObject(blocks) {
  const result = {}

  for (const block of blocks) {
    const blockName = block.name.trim()
    if (!blockName) {
      return { error: 'Each typography block needs a name.' }
    }

    if (result[blockName]) {
      return { error: `Typography block "${blockName}" is duplicated.` }
    }

    result[blockName] = cloneValue(block.value)
  }

  return { value: result }
}

function TypographyFields({ blockId, value, disabled, onChange, path = [], depth = 0 }) {
  const entries = Object.entries(value)
  const allLeafValues = entries.every(
    ([, nestedValue]) =>
      typeof nestedValue !== 'object' || nestedValue === null || Array.isArray(nestedValue),
  )

  return entries.map(([key, nestedValue]) => {
    const fieldPath = [...path, key]
    const fieldId = `${blockId}-${fieldPath.join('-')}`
    const isObject = typeof nestedValue === 'object' && nestedValue !== null && !Array.isArray(nestedValue)

    if (isObject) {
      return (
        <div
          key={fieldId}
          className={`space-y-4 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800 ${
            depth > 0 ? 'bg-zinc-50 dark:bg-zinc-950' : 'bg-white dark:bg-zinc-900'
          }`}
        >
          <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            {formatFieldLabel(key)}
          </div>
          <div
            className={
              allLeafValues ? 'grid gap-3 md:grid-cols-2 xl:grid-cols-3' : 'grid gap-4 xl:grid-cols-2'
            }
          >
            <TypographyFields
              blockId={blockId}
              value={nestedValue}
              disabled={disabled}
              onChange={onChange}
              path={fieldPath}
              depth={depth + 1}
            />
          </div>
        </div>
      )
    }

    return (
      <label key={fieldId} className="space-y-1 rounded-lg">
        <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">{formatFieldLabel(key)}</span>
        <input
          type="text"
          value={nestedValue ?? ''}
          onChange={(event) => onChange(blockId, fieldPath, event.target.value)}
          disabled={disabled}
          className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-950"
        />
      </label>
    )
  })
}

function TypographyEditor({
  blocks,
  onChange,
  disabled = false,
  title = 'Default typography',
  description = 'Each block maps to a real HTML tag group used by the audit.',
}) {
  const [highlightedBlockId, setHighlightedBlockId] = useState(null)
  const [pendingBlockId, setPendingBlockId] = useState(null)
  const blockRefs = useRef({})
  const missingBlocks = TYPOGRAPHY_BLOCK_OPTIONS.filter(
    (option) => !blocks.some((block) => block.name === option.name),
  )

  useEffect(() => {
    if (!pendingBlockId) return

    const node = blockRefs.current[pendingBlockId]
    const clearPendingTimer = setTimeout(() => setPendingBlockId(null), 0)
    if (node) {
      node.scrollIntoView({ behavior: 'smooth', block: 'center' })
      setHighlightedBlockId(pendingBlockId)
    }

    const timer = setTimeout(() => setHighlightedBlockId(null), 1800)
    return () => {
      clearTimeout(clearPendingTimer)
      clearTimeout(timer)
    }
  }, [pendingBlockId, blocks])

  function addBlock(blockName) {
    const template = cloneTypographyTemplate()
    if (!template[blockName]) return

    const newBlock = {
      id: makeId(),
      name: blockName,
      value: cloneValue(template[blockName]),
    }

    if (blocks.some((block) => block.name === blockName)) return
    onChange([...blocks, newBlock])
    setPendingBlockId(newBlock.id)
  }

  function updateBlockValue(blockId, path, value) {
    onChange(
      blocks.map((block) =>
        block.id !== blockId
          ? block
          : {
              ...block,
              value: setNestedValue(block.value, path, value),
            },
      ),
    )
  }

  function removeBlock(blockId) {
    if (blocks.length === 1) return
    onChange(blocks.filter((block) => block.id !== blockId))
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-[#3C3D41]">{title}</h2>
          <p className="text-sm text-[#3C3D41]/70">{description}</p>
        </div>
        <button
          type="button"
          onClick={() => onChange(createTypographyBlocks())}
          disabled={disabled}
          className="rounded-lg border border-[#3C3D41]/20 px-3 py-2 text-sm font-medium disabled:opacity-50 cursor-pointer"
        >
          Reset template
        </button>
      </div>

      <div className="rounded-xl border border-[#3C3D41]/10 bg-[#f7f5f2] p-4 text-sm text-[#3C3D41]/80">
        <div className="font-medium text-[#3C3D41]">Supported tag mapping</div>
        <div className="mt-2 grid gap-2 md:grid-cols-2 xl:grid-cols-4">
          {TYPOGRAPHY_BLOCK_OPTIONS.map((option) => (
            <div key={option.name} className="rounded-lg border border-[#3C3D41]/10 bg-white px-3 py-2">
              <div className="text-sm font-medium">{option.label}</div>
              <div className="text-xs text-[#3C3D41]/60">Matches: {option.matches}</div>
            </div>
          ))}
        </div>
      </div>

      {missingBlocks.length > 0 && (
        <div className="rounded-xl border border-[#3C3D41]/10 p-4">
          <div className="mb-3 text-sm font-medium">Restore a removed block</div>
          <div className="flex flex-wrap gap-2">
            {missingBlocks.map((option) => (
              <button
                key={option.name}
                type="button"
                onClick={() => addBlock(option.name)}
                disabled={disabled}
                className="rounded-lg border border-[#3C3D41]/20 px-3 py-2 text-sm font-medium disabled:opacity-50 cursor-pointer"
              >
                Add {option.label}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="space-y-4">
        {blocks.map((block) => (
          <div
            key={block.id}
            ref={(node) => {
              if (node) {
                blockRefs.current[block.id] = node
              }
            }}
            className={`rounded-xl border p-4 transition ${
              highlightedBlockId === block.id
                ? 'border-[#F58220] ring-2 ring-[#F58220]/30'
                : 'border-[#3C3D41]/10'
            }`}
          >
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold">{getTypographyBlockMeta(block.name).label}</h3>
                <p className="text-xs text-[#3C3D41]/60">
                  Matches: {getTypographyBlockMeta(block.name).matches}
                </p>
              </div>
              <button
                type="button"
                onClick={() => removeBlock(block.id)}
                disabled={disabled || blocks.length === 1}
                className="text-xs text-red-600 disabled:opacity-40 cursor-pointer"
              >
                Remove
              </button>
            </div>
            <div className="space-y-3">
              <TypographyFields
                blockId={block.id}
                value={block.value}
                disabled={disabled}
                onChange={updateBlockValue}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function ProjectDefaultTypography({ project, onSave }) {
  const [blocks, setBlocks] = useState(() => hydrateTypography(project?.config?.typographyBlocks))
  const [saveState, setSaveState] = useState(null)

  async function handleSave() {
    if (!onSave) return
    setSaveState('saving')
    try {
      await onSave(serializeTypographyBlocks(blocks))
      setSaveState('saved')
      setTimeout(() => setSaveState(null), 2000)
    } catch (error) {
      setSaveState(error instanceof Error ? error.message : 'Could not save typography')
    }
  }

  return (
    <div className="rounded-2xl border border-[#3C3D41]/10 bg-white p-6 space-y-4">
      <TypographyEditor
        title="Default typography"
        description="Saved on this project and prefilled in Audit. You can still change typography or the URL for a single run, such as staging, without overwriting this default."
        blocks={blocks}
        onChange={setBlocks}
        disabled={saveState === 'saving'}
      />
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={handleSave}
          disabled={saveState === 'saving'}
          className="rounded-lg bg-[#F58220] px-4 py-2 text-sm font-semibold text-white hover:bg-[#e27518] disabled:opacity-50 cursor-pointer"
        >
          {saveState === 'saving' ? 'Saving…' : saveState === 'saved' ? 'Saved' : 'Save default typography'}
        </button>
        {typeof saveState === 'string' && saveState !== 'saving' && saveState !== 'saved' && (
          <p className="text-sm text-red-600">{saveState}</p>
        )}
      </div>
    </div>
  )
}

export {
  ProjectDefaultTypography,
  TYPOGRAPHY_BLOCK_OPTIONS,
  TypographyEditor,
  buildTypographyObject,
  cloneValue,
  createTypographyBlocks,
  hydrateTypography,
  serializeTypographyBlocks,
}
