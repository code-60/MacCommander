# MacCommander

Черновой каркас аналога Total Commander для macOS на стеке `Tauri + React + TypeScript`.

## Стек

- `Tauri 2` (desktop shell + Rust backend)
- `React 19` + `TypeScript`
- `Vite`

## Команды

```bash
npm install
npm run tauri:dev
```

Сборка frontend:

```bash
npm run build
```

Сборка desktop-приложения:

```bash
npm run tauri:build
```

## Текущее состояние

- Поднят базовый desktop-проект Tauri
- В `src/App.tsx` перенесен макет двухпанельного интерфейса из `template.html`
- Подготовлены скрипты для dev/build

## Следующий этап (MVP)

1. Чтение реальной файловой системы в обе панели
2. Навигация по директориям и выделение
3. Базовые операции: копировать, переместить, удалить, создать папку
4. Горячие клавиши в стиле commander
