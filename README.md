# MacCommander

MVP аналога Total Commander для macOS на стеке `Tauri + React + TypeScript`.

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

## Что уже работает

- Две независимые панели с чтением реальной файловой системы
- Навигация по папкам (`..`, двойной клик, `Enter`, `Backspace`)
- Операции: копировать, переместить, удалить, создать папку
- Переключение активной панели через `Tab`
- Горячие клавиши commander-стиля:
  - `F5` копировать
  - `F6` переместить
  - `F7` новая папка
  - `F8` / `Delete` удалить
