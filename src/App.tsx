import { invoke } from '@tauri-apps/api/core'
import { useCallback, useEffect, useMemo, useState } from 'react'
import './App.css'

type PanelKey = 'left' | 'right'

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
  loading: boolean
  error: string | null
}

type PanelProps = {
  panelKey: PanelKey
  panel: PanelState
  active: boolean
  searchQuery: string
  onActivate: (key: PanelKey) => void
  onSelect: (key: PanelKey, path: string) => void
  onOpenParent: (key: PanelKey) => void
  onOpenEntry: (key: PanelKey, entry: FsEntry) => void
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
  loading: false,
  error: null,
})

const oppositePanel = (key: PanelKey): PanelKey => (key === 'left' ? 'right' : 'left')

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

function filterEntries(entries: FsEntry[], query: string): FsEntry[] {
  const normalized = query.trim().toLowerCase()

  if (!normalized) {
    return entries
  }

  return entries.filter((entry) => entry.name.toLowerCase().includes(normalized))
}

function Panel({
  panelKey,
  panel,
  active,
  searchQuery,
  onActivate,
  onSelect,
  onOpenParent,
  onOpenEntry,
}: PanelProps) {
  const visibleEntries = useMemo(
    () => filterEntries(panel.entries, searchQuery),
    [panel.entries, searchQuery],
  )

  return (
    <section className={`panel${active ? ' active' : ''}`} onMouseDown={() => onActivate(panelKey)}>
      <div className="panel-info">
        <span className="current-path" title={panel.path}>
          {panel.path || '...'}
        </span>
        <span className="disk-space">{panel.loading ? 'Загрузка...' : `${panel.entries.length} объектов`}</span>
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
            className={`file-item${panel.selectedPath === entry.path ? ' selected' : ''}${entry.isDir ? ' directory' : ''}`}
            onClick={() => onSelect(panelKey, entry.path)}
            onDoubleClick={() => onOpenEntry(panelKey, entry)}
          >
            <div className="name-box" title={entry.name}>
              <span className="icon">{entry.isDir ? '📁' : '📄'}</span>
              {entry.name}
            </div>
            <span className="size">{entry.isDir ? '—' : formatBytes(entry.size)}</span>
            <span className="date">{formatDate(entry.modifiedUnix)}</span>
          </div>
        ))}

        {!panel.loading && visibleEntries.length === 0 && <div className="empty-state">Нет объектов по фильтру</div>}
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
  const [isBusy, setIsBusy] = useState(false)
  const [statusMessage, setStatusMessage] = useState('Загрузка...')

  const setPanel = useCallback((key: PanelKey, update: (panel: PanelState) => PanelState) => {
    setPanels((prev) => ({ ...prev, [key]: update(prev[key]) }))
  }, [])

  const loadPanel = useCallback(
    async (key: PanelKey, path: string, preferredSelection?: string | null) => {
      setPanel(key, (panel) => ({ ...panel, loading: true, error: null }))

      try {
        const listing = await invoke<DirectoryListing>('list_directory', { path })

        setPanel(key, (panel) => {
          let nextSelection = preferredSelection === undefined ? panel.selectedPath : preferredSelection

          if (!nextSelection || !listing.entries.some((entry) => entry.path === nextSelection)) {
            nextSelection = listing.entries[0]?.path ?? null
          }

          return {
            ...panel,
            path: listing.path,
            parent: listing.parent,
            entries: listing.entries,
            selectedPath: nextSelection,
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
    async (key: PanelKey, preferredSelection?: string | null) => {
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

  const activeEntry = useMemo(() => {
    const panel = panels[activePanel]
    return panel.entries.find((entry) => entry.path === panel.selectedPath) ?? null
  }, [activePanel, panels])

  const runOperation = useCallback(
    async (title: string, action: () => Promise<void>) => {
      if (isBusy) {
        return
      }

      setIsBusy(true)
      setStatusMessage(`${title}...`)

      try {
        await action()
        setStatusMessage(`${title}: выполнено`)
      } catch (error) {
        setStatusMessage(`${title}: ${getErrorMessage(error)}`)
      } finally {
        setIsBusy(false)
      }
    },
    [isBusy],
  )

  const handleCopy = useCallback(() => {
    if (!activeEntry) {
      setStatusMessage('Копирование: ничего не выбрано')
      return
    }

    const sourcePanel = activePanel
    const targetPanel = oppositePanel(sourcePanel)
    const targetPath = panels[targetPanel].path

    void runOperation('Копирование', async () => {
      const copiedPath = await invoke<string>('copy_entry', {
        source: activeEntry.path,
        destination_dir: targetPath,
      })

      await Promise.all([
        refreshPanel(sourcePanel, activeEntry.path),
        loadPanel(targetPanel, targetPath, copiedPath),
      ])
    })
  }, [activeEntry, activePanel, loadPanel, panels, refreshPanel, runOperation])

  const handleMove = useCallback(() => {
    if (!activeEntry) {
      setStatusMessage('Перемещение: ничего не выбрано')
      return
    }

    const sourcePanel = activePanel
    const targetPanel = oppositePanel(sourcePanel)
    const sourcePath = panels[sourcePanel].path
    const targetPath = panels[targetPanel].path

    void runOperation('Перемещение', async () => {
      const movedPath = await invoke<string>('move_entry', {
        source: activeEntry.path,
        destination_dir: targetPath,
      })

      await Promise.all([
        loadPanel(sourcePanel, sourcePath),
        loadPanel(targetPanel, targetPath, movedPath),
      ])
    })
  }, [activeEntry, activePanel, loadPanel, panels, runOperation])

  const handleDelete = useCallback(() => {
    if (!activeEntry) {
      setStatusMessage('Удаление: ничего не выбрано')
      return
    }

    if (!window.confirm(`Удалить ${activeEntry.isDir ? 'папку' : 'файл'} "${activeEntry.name}"?`)) {
      return
    }

    void runOperation('Удаление', async () => {
      await invoke('delete_entry', { path: activeEntry.path })
      await refreshPanel(activePanel)
    })
  }, [activeEntry, activePanel, refreshPanel, runOperation])

  const handleCreateFolder = useCallback(() => {
    const folderName = window.prompt('Имя новой папки:')
    if (folderName === null) {
      return
    }

    void runOperation('Создание папки', async () => {
      const createdPath = await invoke<string>('create_folder', {
        parent_dir: panels[activePanel].path,
        folder_name: folderName,
      })

      await refreshPanel(activePanel, createdPath)
    })
  }, [activePanel, panels, refreshPanel, runOperation])

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
      setPanel(key, (panel) => ({ ...panel, selectedPath: entry.path }))

      if (entry.isDir) {
        void loadPanel(key, entry.path)
      } else {
        setStatusMessage(`Файл выбран: ${entry.name}`)
      }
    },
    [loadPanel, setPanel],
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

  const selectedSummary = activeEntry
    ? `${activeEntry.isDir ? 'Папка' : 'Файл'}: ${activeEntry.name}${activeEntry.isDir ? '' : ` (${formatBytes(activeEntry.size)})`}`
    : 'Ничего не выбрано'

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
          <button type="button" className="tool-btn" onClick={handleDelete} disabled={isBusy || !activeEntry}>
            Удалить
          </button>
          <button type="button" className="tool-btn" onClick={handleCopy} disabled={isBusy || !activeEntry}>
            Копировать
          </button>
          <button type="button" className="tool-btn" onClick={handleMove} disabled={isBusy || !activeEntry}>
            Переместить
          </button>
          <button type="button" className="tool-btn primary" onClick={handleCreateFolder} disabled={isBusy}>
            Новая папка
          </button>
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
          onActivate={setActivePanel}
          onSelect={(key, path) => {
            setActivePanel(key)
            setPanel(key, (panel) => ({ ...panel, selectedPath: path }))
          }}
          onOpenParent={handleOpenParent}
          onOpenEntry={handleOpenEntry}
        />

        <Panel
          panelKey="right"
          panel={panels.right}
          active={activePanel === 'right'}
          searchQuery={searchQuery}
          onActivate={setActivePanel}
          onSelect={(key, path) => {
            setActivePanel(key)
            setPanel(key, (panel) => ({ ...panel, selectedPath: path }))
          }}
          onOpenParent={handleOpenParent}
          onOpenEntry={handleOpenEntry}
        />
      </main>

      <footer className="status-bar">
        <div>{selectedSummary}</div>
        <div className="metrics">
          <span>Активная: {panelName[activePanel]}</span>
          <span>Статус: {statusMessage}</span>
        </div>
      </footer>
    </div>
  )
}

export default App
