use serde::Serialize;
use std::{
  cmp::Ordering,
  env,
  fs,
  io,
  path::{Path, PathBuf},
  time::UNIX_EPOCH,
};

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct FsEntry {
  name: String,
  path: String,
  is_dir: bool,
  size: u64,
  modified_unix: Option<u64>,
  hidden: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DirectoryListing {
  path: String,
  parent: Option<String>,
  entries: Vec<FsEntry>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct InitialPaths {
  left_path: String,
  right_path: String,
}

fn path_to_string(path: &Path) -> String {
  path.to_string_lossy().into_owned()
}

fn to_absolute_path(path: &Path) -> PathBuf {
  if path.is_absolute() {
    path.to_path_buf()
  } else {
    match env::current_dir() {
      Ok(current) => current.join(path),
      Err(_) => path.to_path_buf(),
    }
  }
}

fn normalize_path(path: &Path) -> PathBuf {
  fs::canonicalize(path).unwrap_or_else(|_| to_absolute_path(path))
}

fn ensure_dir(path: &Path) -> Result<(), String> {
  if !path.exists() {
    return Err(format!("Папка не найдена: {}", path_to_string(path)));
  }

  if !path.is_dir() {
    return Err(format!("Это не папка: {}", path_to_string(path)));
  }

  Ok(())
}

fn file_name(path: &Path) -> Result<String, String> {
  path
    .file_name()
    .map(|name| name.to_string_lossy().into_owned())
    .ok_or_else(|| format!("Не удалось получить имя объекта: {}", path_to_string(path)))
}

fn io_ctx(action: &str, path: &Path, error: &io::Error) -> String {
  format!("{} '{}': {}", action, path_to_string(path), error)
}

fn read_entries(path: &Path) -> Result<Vec<FsEntry>, String> {
  let mut entries = Vec::new();

  for entry_result in fs::read_dir(path).map_err(|err| io_ctx("Ошибка чтения папки", path, &err))? {
    let entry = entry_result.map_err(|err| io_ctx("Ошибка чтения элемента папки", path, &err))?;
    let entry_path = entry.path();
    let metadata =
      fs::symlink_metadata(&entry_path).map_err(|err| io_ctx("Ошибка чтения метаданных", &entry_path, &err))?;
    let name = entry.file_name().to_string_lossy().into_owned();
    let is_dir = metadata.is_dir();

    entries.push(FsEntry {
      name: name.clone(),
      path: path_to_string(&entry_path),
      is_dir,
      size: if is_dir { 0 } else { metadata.len() },
      modified_unix: metadata
        .modified()
        .ok()
        .and_then(|timestamp| timestamp.duration_since(UNIX_EPOCH).ok().map(|value| value.as_secs())),
      hidden: name.starts_with('.'),
    });
  }

  entries.sort_by(|a, b| match (a.is_dir, b.is_dir) {
    (true, false) => Ordering::Less,
    (false, true) => Ordering::Greater,
    _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
  });

  Ok(entries)
}

fn copy_directory_recursive(source: &Path, destination: &Path) -> Result<(), String> {
  fs::create_dir(destination).map_err(|err| io_ctx("Не удалось создать папку", destination, &err))?;

  for entry_result in fs::read_dir(source).map_err(|err| io_ctx("Ошибка чтения папки", source, &err))? {
    let entry = entry_result.map_err(|err| io_ctx("Ошибка чтения элемента папки", source, &err))?;
    let source_path = entry.path();
    let destination_path = destination.join(entry.file_name());
    let metadata =
      fs::symlink_metadata(&source_path).map_err(|err| io_ctx("Ошибка чтения метаданных", &source_path, &err))?;

    if metadata.is_dir() {
      copy_directory_recursive(&source_path, &destination_path)?;
    } else {
      fs::copy(&source_path, &destination_path)
        .map_err(|err| io_ctx("Не удалось скопировать файл", &source_path, &err))?;
    }
  }

  Ok(())
}

fn remove_entry(path: &Path) -> Result<(), String> {
  let metadata = fs::symlink_metadata(path).map_err(|err| io_ctx("Ошибка чтения метаданных", path, &err))?;

  if metadata.is_dir() {
    fs::remove_dir_all(path).map_err(|err| io_ctx("Не удалось удалить папку", path, &err))
  } else {
    fs::remove_file(path).map_err(|err| io_ctx("Не удалось удалить файл", path, &err))
  }
}

#[tauri::command]
fn get_initial_paths() -> InitialPaths {
  let home = env::var("HOME").unwrap_or_else(|_| String::from("/"));

  InitialPaths {
    left_path: home,
    right_path: String::from("/"),
  }
}

#[tauri::command]
fn list_directory(path: String) -> Result<DirectoryListing, String> {
  let normalized = normalize_path(Path::new(&path));
  ensure_dir(&normalized)?;

  let entries = read_entries(&normalized)?;
  let parent = normalized.parent().map(path_to_string);

  Ok(DirectoryListing {
    path: path_to_string(&normalized),
    parent,
    entries,
  })
}

#[tauri::command]
fn copy_entry(source: String, destination_dir: String) -> Result<String, String> {
  let source_path = normalize_path(Path::new(&source));
  let destination_base = normalize_path(Path::new(&destination_dir));

  ensure_dir(&destination_base)?;

  if !source_path.exists() {
    return Err(format!("Источник не найден: {}", path_to_string(&source_path)));
  }

  let destination_path = destination_base.join(file_name(&source_path)?);

  if destination_path.exists() {
    return Err(format!("Объект уже существует: {}", path_to_string(&destination_path)));
  }

  let metadata =
    fs::symlink_metadata(&source_path).map_err(|err| io_ctx("Ошибка чтения метаданных", &source_path, &err))?;

  if metadata.is_dir() {
    copy_directory_recursive(&source_path, &destination_path)?;
  } else {
    fs::copy(&source_path, &destination_path)
      .map_err(|err| io_ctx("Не удалось скопировать файл", &source_path, &err))?;
  }

  Ok(path_to_string(&destination_path))
}

#[tauri::command]
fn move_entry(source: String, destination_dir: String) -> Result<String, String> {
  let source_path = normalize_path(Path::new(&source));
  let destination_base = normalize_path(Path::new(&destination_dir));

  ensure_dir(&destination_base)?;

  if !source_path.exists() {
    return Err(format!("Источник не найден: {}", path_to_string(&source_path)));
  }

  let destination_path = destination_base.join(file_name(&source_path)?);

  if destination_path.exists() {
    return Err(format!("Объект уже существует: {}", path_to_string(&destination_path)));
  }

  match fs::rename(&source_path, &destination_path) {
    Ok(_) => Ok(path_to_string(&destination_path)),
    Err(err) => {
      if err.raw_os_error() == Some(18) {
        let metadata = fs::symlink_metadata(&source_path)
          .map_err(|meta_err| io_ctx("Ошибка чтения метаданных", &source_path, &meta_err))?;

        if metadata.is_dir() {
          copy_directory_recursive(&source_path, &destination_path)?;
        } else {
          fs::copy(&source_path, &destination_path)
            .map_err(|copy_err| io_ctx("Не удалось скопировать файл", &source_path, &copy_err))?;
        }

        remove_entry(&source_path)?;
        Ok(path_to_string(&destination_path))
      } else {
        Err(io_ctx("Не удалось переместить объект", &source_path, &err))
      }
    }
  }
}

#[tauri::command]
fn delete_entry(path: String) -> Result<(), String> {
  let target = normalize_path(Path::new(&path));

  if !target.exists() {
    return Err(format!("Объект не найден: {}", path_to_string(&target)));
  }

  remove_entry(&target)
}

#[tauri::command]
fn create_folder(parent_dir: String, folder_name: String) -> Result<String, String> {
  let parent = normalize_path(Path::new(&parent_dir));
  ensure_dir(&parent)?;

  let folder_name = folder_name.trim();

  if folder_name.is_empty() {
    return Err(String::from("Имя папки не может быть пустым"));
  }

  if folder_name == "." || folder_name == ".." || folder_name.contains('/') {
    return Err(String::from("Некорректное имя папки"));
  }

  let target = parent.join(folder_name);

  if target.exists() {
    return Err(format!("Папка уже существует: {}", path_to_string(&target)));
  }

  fs::create_dir(&target).map_err(|err| io_ctx("Не удалось создать папку", &target, &err))?;

  Ok(path_to_string(&target))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .invoke_handler(tauri::generate_handler![
      get_initial_paths,
      list_directory,
      copy_entry,
      move_entry,
      delete_entry,
      create_folder
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
