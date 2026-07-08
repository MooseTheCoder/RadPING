'use strict';

const { app, BrowserWindow, ipcMain, Menu, dialog, safeStorage } = require('electron');
const fs = require('fs');
const path = require('path');
const client = require('../src/radius/client');
const dict = require('../src/radius/dictionary');
const vendors = require('../src/radius/vendors');
const { parseDictionary } = require('../src/radius/dictparser');
const { createProfileStore } = require('../src/store/profiles');
const { createDictionaryStore } = require('../src/store/dictionaries');

let mainWindow = null;
let profileStore = null;
let dictionaryStore = null;

/**
 * Re-apply the vendor dictionary layer: built-ins first, then every stored
 * imported dictionary. Called at startup and after any import/remove so the
 * live decoder matches what's persisted.
 */
function applyStoredDictionaries() {
  vendors.reset();
  for (const entry of dictionaryStore.listFull()) {
    vendors.register(entry.vendors);
  }
}

/**
 * Encrypt profile secrets at rest using the OS keychain when available
 * (Keychain on macOS, DPAPI on Windows, libsecret on Linux). Falls back to
 * plaintext storage if the platform has no secure backend (e.g. a headless
 * Linux box with no keyring).
 */
function makeSecretCipher() {
  let available = false;
  try {
    available = safeStorage.isEncryptionAvailable();
  } catch (_) {
    available = false;
  }
  if (!available) return null;
  return {
    encrypt: (plaintext) => safeStorage.encryptString(plaintext).toString('base64'),
    decrypt: (stored) => safeStorage.decryptString(Buffer.from(stored, 'base64'))
  };
}

function createWindow() {
  // Window icon (used on Windows/Linux; macOS uses the packaged .app icon).
  const iconPath = path.join(__dirname, '..', 'assets', 'icon.png');

  mainWindow = new BrowserWindow({
    width: 1040,
    height: 760,
    minWidth: 820,
    minHeight: 600,
    title: 'RadPING',
    backgroundColor: '#0f1420',
    ...(fs.existsSync(iconPath) ? { icon: iconPath } : {}),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  // Hide the in-window menu bar on Windows/Linux (macOS keeps its global menu
  // bar, which is expected there). The menu is left set so its keyboard
  // shortcuts still work; autoHideMenuBar stays false so Alt won't reveal it.
  if (process.platform !== 'darwin') {
    mainWindow.setMenuBarVisibility(false);
  }

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// --- IPC: send a RADIUS request ---------------------------------------------
ipcMain.handle('radius:send', async (_event, config) => {
  try {
    return await client.send(config);
  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : String(err) };
  }
});

// --- IPC: expose the dictionary to the renderer -----------------------------
ipcMain.handle('radius:dictionary', async () => {
  return {
    attributes: dict.ATTRIBUTES,
    values: dict.VALUES,
    codes: dict.CODES
  };
});

// --- IPC: RADIUS server profiles --------------------------------------------
ipcMain.handle('profiles:list', async () => profileStore.list());
ipcMain.handle('profiles:save', async (_event, profile) => profileStore.save(profile));
ipcMain.handle('profiles:delete', async (_event, id) => profileStore.remove(id));

// --- IPC: vendor dictionaries -----------------------------------------------
ipcMain.handle('dictionaries:list', async () => ({
  builtins: vendors.builtinNames(),
  imported: dictionaryStore.list()
}));

ipcMain.handle('dictionaries:import', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Import vendor dictionary',
    message: 'Choose a FreeRADIUS-format dictionary file',
    properties: ['openFile'],
    // FreeRADIUS dictionaries are conventionally named dictionary.<vendor>
    // (e.g. dictionary.cisco) — the extension is the vendor name, not a fixed
    // one — so lead with "All files" and offer common extensions as a filter.
    filters: [
      { name: 'All files', extensions: ['*'] },
      { name: 'Dictionary files', extensions: ['dict', 'dictionary', 'txt'] }
    ]
  });
  if (result.canceled || !result.filePaths.length) return { canceled: true };

  const filePath = result.filePaths[0];
  let text;
  try {
    text = fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    return { error: `Could not read file: ${err.message}` };
  }

  // Resolve $INCLUDE relative to the chosen file's directory.
  const baseDir = path.dirname(filePath);
  const resolveInclude = (name) => {
    try {
      return fs.readFileSync(path.resolve(baseDir, name), 'utf8');
    } catch (_) {
      return null;
    }
  };

  const parsed = parseDictionary(text, { resolveInclude });
  if (parsed.attrCount === 0) {
    return {
      error: 'No vendor attributes found in that file. It may be a base dictionary or an unsupported format.',
      warnings: parsed.warnings
    };
  }

  const meta = dictionaryStore.add({
    name: path.basename(filePath),
    vendors: parsed.vendors,
    vendorCount: parsed.vendorCount,
    attrCount: parsed.attrCount,
    importedAt: new Date().toISOString()
  });
  applyStoredDictionaries();

  return { imported: meta, warnings: parsed.warnings };
});

ipcMain.handle('dictionaries:remove', async (_event, id) => {
  const res = dictionaryStore.remove(id);
  applyStoredDictionaries();
  return res;
});

app.whenReady().then(() => {
  profileStore = createProfileStore(
    path.join(app.getPath('userData'), 'radping-profiles.json'),
    makeSecretCipher()
  );
  dictionaryStore = createDictionaryStore(
    path.join(app.getPath('userData'), 'radping-dictionaries.json')
  );
  applyStoredDictionaries();

  // Show the app icon in the macOS dock during development (the packaged .app
  // carries its own icon; this only affects `npm start` from source).
  const dockIcon = path.join(__dirname, '..', 'assets', 'icon.png');
  if (process.platform === 'darwin' && app.dock && fs.existsSync(dockIcon)) {
    app.dock.setIcon(dockIcon);
  }

  Menu.setApplicationMenu(buildMenu());
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

function buildMenu() {
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    { role: 'fileMenu' },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    { role: 'windowMenu' }
  ];
  return Menu.buildFromTemplate(template);
}
