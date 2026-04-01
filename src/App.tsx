import { invoke } from '@tauri-apps/api/core'
import { useCallback, useEffect, useMemo, useState } from 'react'
import './App.css'

type PanelKey = 'left' | 'right'
type SortBy = 'name' | 'size' | 'date'
type SortDirection = 'asc' | 'desc'

type FsEntry = {
  name: string
  path: string
  isDir: boolean
  size: number
  modifiedUnix: number | null
  hidden: boolean
}

type DirectoryListing = {
  path: string
  parent: string | null
  entries: FsEntry[]
}

type InitialPaths = {
  leftPath: string
  rightPath: string
}

type PanelState = {
  path: string
  parent: string | null
  entries: FsEntry[]
  selectedPath: string | null
  selectedPaths: string[]
  anchorPath: string | null
  loading: boolean
  error: string | null
}

type SelectOptions = {
  toggle: boolean
  range: boolean
  visiblePaths: string[]
}

type ContextMenuState = {
  panelKey: PanelKey
  x: number
  y: number
}

type BatchResult = {
  successPaths: string[]
  failures: string[]
}

type PanelProps = {
  panelKey: PanelKey
  panel: PanelState
  active: boolean
  searchQuery: string
  showHidden: boolean
  sortBy: SortBy
  sortDirection: SortDirection
  onActivate: (key: PanelKey) => void
  onSelect: (key: PanelKey, path: string, options: SelectOptions) => void
  onOpenParent: (key: PanelKey) => void
  onOpenEntry: (key: PanelKey, entry: FsEntry) => void
  onContextMenu: (key: PanelKey, path: string | null, x: number, y: number) => void
}

const panelName: Record<PanelKey, string> = {
  left: 'Левая',
  right: 'Правая',
}

const emptyPanel = (path = ''): PanelState => ({
  path,
  parent: null,
  entries: [],
  selectedPath: null,
  selectedPaths: [],
  anchorPath: null,
  loading: false,
  error: null,
})

const oppositePanel = (key: PanelKey): PanelKey => (key === 'left' ? 'right' : 'left')

function uniquePaths(paths: string[]): string[] {
  return Array.from(new Set(paths))
}

function formatBytes(bytes: number): string {
  if (bytes <= 0) {
    return '0 Б'
  }

  const units = ['Б', 'КБ', 'МБ', 'ГБ', 'ТБ']
  let size = bytes
  let unitIndex = 0

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024
    unitIndex += 1
  }

  const precision = unitIndex === 0 ? 0 : size < 10 ? 1 : 0
  return `${size.toFixed(precision)} ${units[unitIndex]}`
}

function formatDate(timestamp: number | null): string {
  if (!timestamp) {
    return '—'
  }

  return new Date(timestamp * 1000).toLocaleDateString('ru-RU', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

function getErrorMessage(error: unknown): string {
  if (typeof error === 'string') {
    return error
  }

  if (error instanceof Error) {
    return error.message
  }

  return 'Неизвестная ошибка'
}

function getVisibleEntries(
  entries: FsEntry[],
  query: string,
  showHidden: boolean,
  sortBy: SortBy,
  sortDirection: SortDirection,
): FsEntry[] {
  const normalized = query.trim().toLowerCase()
  const filtered = entries.filter((entry) => {
    if (!showHidden && entry.hidden) {
      return false
    }

    if (!normalized) {
      return true
    }

    return entry.name.toLowerCase().includes(normalized)
  })

  return [...filtered].sort((a, b) => {
    if (a.isDir !== b.isDir) {
      return a.isDir ? -1 : 1
    }

    let result = 0

    if (sortBy === 'name') {
      result = a.name.localeCompare(b.name, 'ru-RU', { sensitivity: 'base' })
    } else if (sortBy === 'size') {
      result = a.size - b.size
    } else {
      result = (a.modifiedUnix ?? 0) - (b.modifiedUnix ?? 0)
    }

    if (result === 0) {
      result = a.name.localeCompare(b.name, 'ru-RU', { sensitivity: 'base' })
    }

    return sortDirection === 'asc' ? result : result * -1
  })
}

function Panel({
  panelKey,
  panel,
  active,
  searchQuery,
  showHidden,
  sortBy,
  sortDirection,
  onActivate,
  onSelect,
  onOpenParent,
  onOpenEntry,
  onContextMenu,
}: PanelProps) {
  const visibleEntries = useMemo(
    () => getVisibleEntries(panel.entries, searchQuery, showHidden, sortBy, sortDirection),
    [panel.entries, searchQuery, showHidden, sortBy, sortDirection],
  )
  const visiblePaths = useMemo(() => visibleEntries.map((entry) => entry.path), [visibleEntries])

  return (
    <section
      className={`panel${active ? ' active' : ''}`}
      onMouseDown={() => onActivate(panelKey)}
      onContextMenu={(event) => {
        event.preventDefault()
        onContextMenu(panelKey, null, event.clientX, event.clientY)
      }}
    >
      <div className="panel-info">
        <span className="current-path" title={panel.path}>
          {panel.path || '...'}
        </span>
        <span className="disk-space">
          {panel.loading ? 'Загрузка...' : `${visibleEntries.length}/${panel.entries.length} объектов`}
        </span>
      </div>

      <div className="file-list">
        <div className="list-header">
          <span>Имя</span>
          <span>Размер</span>
          <span>Дата</span>
        </div>

        {panel.parent && (
          <div
            className="file-item parent"
            onClick={() => onActivate(panelKey)}
            onDoubleClick={() => onOpenParent(panelKey)}
            onContextMenu={(event) => {
              event.preventDefault()
              onContextMenu(panelKey, null, event.clientX, event.clientY)
            }}
          >
            <div className="name-box">
              <span className="icon">📁</span>
              ..
            </div>
            <span className="size">—</span>
            <span className="date">—</span>
          </div>
        )}

        {visibleEntries.map((entry) => (
          <div
            key={entry.path}
            className={`file-item${panel.selectedPaths.includes(entry.path) ? ' selected' : ''}${entry.isDir ? ' directory' : ''}`}
            onClick={(event) => {
              onSelect(panelKey, entry.path, {
                toggle: event.metaKey || event.ctrlKey,
                range: event.shiftKey,
                visiblePaths,
              })
            }}
            onDoubleClick={() => onOpenEntry(panelKey, entry)}
            onContextMenu={(event) => {
              event.preventDefault()
              onContextMenu(panelKey, entry.path, event.clientX, event.clientY)
            }}
          >
            <div className="name-box" title={entry.name}>
              <span className="icon">{entry.isDir ? '📁' : '📄'}</span>
              {entry.name}
            </div>
            <span className="size">{entry.isDir ? '—' : formatBytes(entry.size)}</span>
            <span className="date">{formatDate(entry.modifiedUnix)}</span>
          </div>
        ))}

        {!panel.loading && visibleEntries.length === 0 && (
          <div className="empty-state">Нет объектов по фильтру</div>
        )}
        {panel.error && <div className="panel-error">{panel.error}</div>}
      </div>
    </section>
  )
}

function App() {
  const [panels, setPanels] = useState<Record<PanelKey, PanelState>>({
    left: emptyPanel(),
    right: emptyPanel(),
  })
  const [activePanel, setActivePanel] = useState<PanelKey>('left')
  const [searchQuery, setSearchQuery] = useState('')
  const [showHidden, setShowHidden] = useState(false)
  const [sortBy, setSortBy] = useState<SortBy>('name')
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc')
  const [isBusy, setIsBusy] = useState(false)
  const [statusMessage, setStatusMessage] = useState('Загрузка...')
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)

  const setPanel = useCallback((key: PanelKey, update: (panel: PanelState) => PanelState) => {
    setPanels((prev) => ({ ...prev, [key]: update(prev[key]) }))
  }, [])

  const loadPanel = useCallback(
    async (key: PanelKey, path: string, preferredSelection?: string | string[] | null) => {
      setPanel(key, (panel) => ({ ...panel, loading: true, error: null }))

      try {
        const listing = await invoke<DirectoryListing>('list_directory', { path })
        const existingPaths = new Set(listing.entries.map((entry) => entry.path))

        setPanel(key, (panel) => {
          const requestedSelection = Array.isArray(preferredSelection)
            ? preferredSelection
            : preferredSelection
              ? [preferredSelection]
              : panel.selectedPaths

          let nextSelectedPaths = uniquePaths(requestedSelection).filter((value) =>
            existingPaths.has(value),
          )

          if (nextSelectedPaths.length === 0 && listing.entries[0]) {
            nextSelectedPaths = [listing.entries[0].path]
          }

          const nextSelectedPath =
            (panel.selectedPath && nextSelectedPaths.includes(panel.selectedPath) && panel.selectedPath) ||
            nextSelectedPaths[0] ||
            null

          const nextAnchorPath =
            (panel.anchorPath && nextSelectedPaths.includes(panel.anchorPath) && panel.anchorPath) ||
            nextSelectedPath

          return {
            ...panel,
            path: listing.path,
            parent: listing.parent,
            entries: listing.entries,
            selectedPath: nextSelectedPath,
            selectedPaths: nextSelectedPaths,
            anchorPath: nextAnchorPath,
            loading: false,
            error: null,
          }
        })
      } catch (error) {
        setPanel(key, (panel) => ({
          ...panel,
          loading: false,
          error: getErrorMessage(error),
        }))
      }
    },
    [setPanel],
  )

  const refreshPanel = useCallback(
    async (key: PanelKey, preferredSelection?: string | string[] | null) => {
      const path = panels[key].path
      if (!path) {
        return
      }

      await loadPanel(key, path, preferredSelection)
    },
    [loadPanel, panels],
  )

  useEffect(() => {
    let cancelled = false

    const bootstrap = async () => {
      try {
        const initialPaths = await invoke<InitialPaths>('get_initial_paths')

        if (cancelled) {
          return
        }

        setPanels({
          left: emptyPanel(initialPaths.leftPath),
          right: emptyPanel(initialPaths.rightPath),
        })

        await Promise.all([
          loadPanel('left', initialPaths.leftPath),
          loadPanel('right', initialPaths.rightPath),
        ])

        if (!cancelled) {
          setStatusMessage('Готово')
        }
      } catch (error) {
        if (!cancelled) {
          setStatusMessage(`Ошибка запуска: ${getErrorMessage(error)}`)
        }
      }
    }

    void bootstrap()

    return () => {
      cancelled = true
    }
  }, [loadPanel])

  const activePanelState = panels[activePanel]

  const activeSelectedEntries = useMemo(() => {
    const index = new Map(activePanelState.entries.map((entry) => [entry.path, entry]))
    const selected = activePanelState.selectedPaths
      .map((path) => index.get(path))
      .filter((entry): entry is FsEntry => Boolean(entry))

    if (selected.length > 0) {
      return selected
    }

    if (!activePanelState.selectedPath) {
      return []
    }

    const fallback = index.get(activePanelState.selectedPath)
    return fallback ? [fallback] : []
  }, [activePanelState])

  const activeEntry = useMemo(() => {
    if (!activePanelState.selectedPath) {
      return activeSelectedEntries[0] ?? null
    }

    return (
      activePanelState.entries.find((entry) => entry.path === activePanelState.selectedPath) ??
      activeSelectedEntries[0] ??
      null
    )
  }, [activePanelState, activeSelectedEntries])

  const closeContextMenu = useCallback(() => setContextMenu(null), [])

  useEffect(() => {
    if (!contextMenu) {
      return
    }

    const close = () => closeContextMenu()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeContextMenu()
      }
    }

    window.addEventListener('click', close)
    window.addEventListener('contextmenu', close)
    window.addEventListener('resize', close)
    window.addEventListener('scroll', close, true)
    window.addEventListener('keydown', onKeyDown)

    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('contextmenu', close)
      window.removeEventListener('resize', close)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [closeContextMenu, contextMenu])

  const runBatchOperation = useCallback(
    async (title: string, entries: FsEntry[], operation: (entry: FsEntry) => Promise<string | void>) => {
      if (isBusy) {
        return { successPaths: [], failures: ['Операция уже выполняется'] } satisfies BatchResult
      }

      setIsBusy(true)
      const successPaths: string[] = []
      const failures: string[] = []

      try {
        for (let i = 0; i < entries.length; i += 1) {
          const entry = entries[i]
          setStatusMessage(`${title} ${i + 1}/${entries.length}: ${entry.name}`)

          try {
            const result = await operation(entry)
            if (typeof result === 'string') {
              successPaths.push(result)
            }
          } catch (error) {
            failures.push(`${entry.name}: ${getErrorMessage(error)}`)
          }
        }
      } finally {
        setIsBusy(false)
      }

      if (failures.length > 0) {
        setStatusMessage(`${title}: ${entries.length - failures.length}/${entries.length}, ошибок: ${failures.length}`)
      } else {
        setStatusMessage(`${title}: выполнено (${entries.length})`)
      }

      return { successPaths, failures } satisfies BatchResult
    },
    [isBusy],
  )

  const getEntriesForOperation = useCallback((): FsEntry[] => {
    return activeSelectedEntries.length > 0 ? activeSelectedEntries : activeEntry ? [activeEntry] : []
  }, [activeEntry, activeSelectedEntries])

  const handleCopy = useCallback(() => {
    const entries = getEntriesForOperation()
    if (entries.length === 0) {
      setStatusMessage('Копирование: ничего не выбрано')
      return
    }

    const sourcePanel = activePanel
    const targetPanel = oppositePanel(sourcePanel)
    const sourceSelection = entries.map((entry) => entry.path)
    const targetPath = panels[targetPanel].path

    void (async () => {
      const result = await runBatchOperation('Копирование', entries, async (entry) => {
        return invoke<string>('copy_entry', {
          source: entry.path,
          destination_dir: targetPath,
        })
      })

      await Promise.all([
        refreshPanel(sourcePanel, sourceSelection),
        loadPanel(targetPanel, targetPath, result.successPaths.length > 0 ? result.successPaths : null),
      ])
    })()
  }, [activePanel, getEntriesForOperation, loadPanel, panels, refreshPanel, runBatchOperation])

  const handleMove = useCallback(() => {
    const entries = getEntriesForOperation()
    if (entries.length === 0) {
      setStatusMessage('Перемещение: ничего не выбрано')
      return
    }

    const sourcePanel = activePanel
    const targetPanel = oppositePanel(sourcePanel)
    const sourcePath = panels[sourcePanel].path
    const targetPath = panels[targetPanel].path

    void (async () => {
      const result = await runBatchOperation('Перемещение', entries, async (entry) => {
        return invoke<string>('move_entry', {
          source: entry.path,
          destination_dir: targetPath,
        })
      })

      await Promise.all([
        loadPanel(sourcePanel, sourcePath),
        loadPanel(targetPanel, targetPath, result.successPaths.length > 0 ? result.successPaths : null),
      ])
    })()
  }, [activePanel, getEntriesForOperation, loadPanel, panels, runBatchOperation])

  const handleDelete = useCallback(() => {
    const entries = getEntriesForOperation()
    if (entries.length === 0) {
      setStatusMessage('Удаление: ничего не выбрано')
      return
    }

    const confirmMessage =
      entries.length === 1
        ? `Удалить ${entries[0].isDir ? 'папку' : 'файл'} "${entries[0].name}"?`
        : `Удалить выбранные объекты (${entries.length})?`

    if (!window.confirm(confirmMessage)) {
      return
    }

    void (async () => {
      await runBatchOperation('Удаление', entries, async (entry) => {
        await invoke('delete_entry', { path: entry.path })
      })

      await refreshPanel(activePanel)
    })()
  }, [activePanel, getEntriesForOperation, refreshPanel, runBatchOperation])

  const handleCreateFolder = useCallback(() => {
    const folderName = window.prompt('Имя новой папки:')
    if (folderName === null) {
      return
    }

    void (async () => {
      const result = await runBatchOperation('Создание папки', [{ name: folderName, path: '', isDir: true, size: 0, modifiedUnix: null, hidden: false }], async () => {
        return invoke<string>('create_folder', {
          parent_dir: panels[activePanel].path,
          folder_name: folderName,
        })
      })

      await refreshPanel(activePanel, result.successPaths[0] ?? null)
    })()
  }, [activePanel, panels, refreshPanel, runBatchOperation])

  const handleOpenParent = useCallback(
    (key: PanelKey) => {
      const parent = panels[key].parent
      if (!parent) {
        return
      }

      setActivePanel(key)
      void loadPanel(key, parent)
    },
    [loadPanel, panels],
  )

  const handleOpenEntry = useCallback(
    (key: PanelKey, entry: FsEntry) => {
      setActivePanel(key)
      setPanel(key, (panel) => ({
        ...panel,
        selectedPath: entry.path,
        selectedPaths: [entry.path],
        anchorPath: entry.path,
      }))

      if (entry.isDir) {
        void loadPanel(key, entry.path)
      } else {
        setStatusMessage(`Файл выбран: ${entry.name}`)
      }
    },
    [loadPanel, setPanel],
  )

  const handleSelect = useCallback(
    (key: PanelKey, path: string, options: SelectOptions) => {
      setActivePanel(key)

      setPanel(key, (panel) => {
        const current = uniquePaths(panel.selectedPaths.filter((item) => panel.entries.some((entry) => entry.path === item)))
        let selectedPaths = current
        let anchorPath = panel.anchorPath ?? panel.selectedPath ?? path

        if (options.range) {
          const from = options.visiblePaths.indexOf(anchorPath)
          const to = options.visiblePaths.indexOf(path)

          if (from !== -1 && to !== -1) {
            const start = Math.min(from, to)
            const end = Math.max(from, to)
            selectedPaths = options.visiblePaths.slice(start, end + 1)
          } else {
            selectedPaths = [path]
            anchorPath = path
          }
        } else if (options.toggle) {
          if (selectedPaths.includes(path)) {
            selectedPaths = selectedPaths.filter((item) => item !== path)
          } else {
            selectedPaths = [...selectedPaths, path]
          }
          anchorPath = path
        } else {
          selectedPaths = [path]
          anchorPath = path
        }

        const nextSelectedPath = selectedPaths.includes(path)
          ? path
          : selectedPaths[0] ?? null

        return {
          ...panel,
          selectedPath: nextSelectedPath,
          selectedPaths,
          anchorPath: nextSelectedPath ? anchorPath : null,
        }
      })
    },
    [setPanel],
  )

  const handleContextMenu = useCallback(
    (key: PanelKey, path: string | null, x: number, y: number) => {
      setActivePanel(key)

      if (path) {
        setPanel(key, (panel) => {
          if (panel.selectedPaths.includes(path)) {
            return panel
          }

          return {
            ...panel,
            selectedPath: path,
            selectedPaths: [path],
            anchorPath: path,
          }
        })
      }

      setContextMenu({ panelKey: key, x, y })
    },
    [setPanel],
  )

  const handleOpenSelected = useCallback(() => {
    if (!activeEntry) {
      return
    }

    if (activeEntry.isDir) {
      void loadPanel(activePanel, activeEntry.path)
    } else {
      setStatusMessage(`Файл выбран: ${activeEntry.name}`)
    }
  }, [activeEntry, activePanel, loadPanel])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      const isInput =
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.tagName === 'SELECT' ||
        target?.isContentEditable

      if (isInput) {
        return
      }

      if (event.key === 'Tab') {
        event.preventDefault()
        setActivePanel((current) => oppositePanel(current))
        return
      }

      if (event.key === 'Enter') {
        event.preventDefault()
        handleOpenSelected()
        return
      }

      if (event.key === 'Backspace') {
        event.preventDefault()
        handleOpenParent(activePanel)
        return
      }

      if (event.key.toLowerCase() === 'h' && event.metaKey) {
        event.preventDefault()
        setShowHidden((value) => !value)
        return
      }

      if (isBusy) {
        return
      }

      if (event.key === 'F5') {
        event.preventDefault()
        handleCopy()
      } else if (event.key === 'F6') {
        event.preventDefault()
        handleMove()
      } else if (event.key === 'F7') {
        event.preventDefault()
        handleCreateFolder()
      } else if (event.key === 'F8' || event.key === 'Delete') {
        event.preventDefault()
        handleDelete()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [
    activePanel,
    handleCopy,
    handleCreateFolder,
    handleDelete,
    handleMove,
    handleOpenParent,
    handleOpenSelected,
    isBusy,
  ])

  const selectedFilesSize = activeSelectedEntries.reduce((sum, entry) => sum + (entry.isDir ? 0 : entry.size), 0)
  const selectedSummary =
    activeSelectedEntries.length === 0
      ? 'Ничего не выбрано'
      : `Выбрано: ${activeSelectedEntries.length} (${formatBytes(selectedFilesSize)})`

  return (
    <div className="window">
      <header className="title-bar">
        <div className="window-controls" aria-hidden="true">
          <div className="dot red" />
          <div className="dot" />
          <div className="dot" />
        </div>

        <nav className="toolbar" aria-label="Команды">
          <button
            type="button"
            className="tool-btn"
            onClick={() => handleOpenParent(activePanel)}
            disabled={isBusy || !panels[activePanel].parent}
          >
            Вверх
          </button>
          <button
            type="button"
            className="tool-btn"
            onClick={handleDelete}
            disabled={isBusy || activeSelectedEntries.length === 0}
          >
            Удалить
          </button>
          <button
            type="button"
            className="tool-btn"
            onClick={handleCopy}
            disabled={isBusy || activeSelectedEntries.length === 0}
          >
            Копировать
          </button>
          <button
            type="button"
            className="tool-btn"
            onClick={handleMove}
            disabled={isBusy || activeSelectedEntries.length === 0}
          >
            Переместить
          </button>
          <button type="button" className="tool-btn primary" onClick={handleCreateFolder} disabled={isBusy}>
            Новая папка
          </button>

          <button
            type="button"
            className="tool-btn"
            onClick={() => setShowHidden((value) => !value)}
            disabled={isBusy}
          >
            {showHidden ? 'Скрытые: ON' : 'Скрытые: OFF'}
          </button>

          <select
            className="tool-select"
            value={sortBy}
            onChange={(event) => setSortBy(event.target.value as SortBy)}
            disabled={isBusy}
            aria-label="Сортировка"
          >
            <option value="name">Сорт: Имя</option>
            <option value="size">Сорт: Размер</option>
            <option value="date">Сорт: Дата</option>
          </select>

          <select
            className="tool-select"
            value={sortDirection}
            onChange={(event) => setSortDirection(event.target.value as SortDirection)}
            disabled={isBusy}
            aria-label="Направление сортировки"
          >
            <option value="asc">По возрастанию</option>
            <option value="desc">По убыванию</option>
          </select>
        </nav>

        <input
          type="text"
          className="search-input"
          placeholder="Фильтр файлов..."
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
        />
      </header>

      <main className="workspace">
        <Panel
          panelKey="left"
          panel={panels.left}
          active={activePanel === 'left'}
          searchQuery={searchQuery}
          showHidden={showHidden}
          sortBy={sortBy}
          sortDirection={sortDirection}
          onActivate={setActivePanel}
          onSelect={handleSelect}
          onOpenParent={handleOpenParent}
          onOpenEntry={handleOpenEntry}
          onContextMenu={handleContextMenu}
        />

        <Panel
          panelKey="right"
          panel={panels.right}
          active={activePanel === 'right'}
          searchQuery={searchQuery}
          showHidden={showHidden}
          sortBy={sortBy}
          sortDirection={sortDirection}
          onActivate={setActivePanel}
          onSelect={handleSelect}
          onOpenParent={handleOpenParent}
          onOpenEntry={handleOpenEntry}
          onContextMenu={handleContextMenu}
        />
      </main>

      <footer className="status-bar">
        <div>{selectedSummary}</div>
        <div className="metrics">
          <span>Активная: {panelName[activePanel]}</span>
          <span>Статус: {statusMessage}</span>
        </div>
      </footer>

      {contextMenu && (
        <div
          className="context-menu"
          style={{ top: contextMenu.y, left: contextMenu.x }}
          onClick={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            className="context-menu-item"
            disabled={isBusy || activeSelectedEntries.length === 0}
            onClick={() => {
              closeContextMenu()
              handleCopy()
            }}
          >
            Копировать (F5)
          </button>
          <button
            type="button"
            className="context-menu-item"
            disabled={isBusy || activeSelectedEntries.length === 0}
            onClick={() => {
              closeContextMenu()
              handleMove()
            }}
          >
            Переместить (F6)
          </button>
          <button
            type="button"
            className="context-menu-item danger"
            disabled={isBusy || activeSelectedEntries.length === 0}
            onClick={() => {
              closeContextMenu()
              handleDelete()
            }}
          >
            Удалить (F8)
          </button>
          <button
            type="button"
            className="context-menu-item"
            disabled={isBusy}
            onClick={() => {
              closeContextMenu()
              handleCreateFolder()
            }}
          >
            Новая папка (F7)
          </button>
          <button
            type="button"
            className="context-menu-item"
            disabled={isBusy}
            onClick={() => {
              setShowHidden((value) => !value)
              closeContextMenu()
            }}
          >
            {showHidden ? 'Скрыть скрытые' : 'Показать скрытые'}
          </button>
        </div>
      )}
    </div>
  )
}

export default App
