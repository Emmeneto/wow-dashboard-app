// ============================================================================
// WoW Dashboard - Electron Main Process
// ============================================================================
// Creates the app window, starts the Express server, manages the system tray,
// and handles addon installation + background data sync.
// ============================================================================

const { app, BrowserWindow, Tray, Menu, dialog, shell, nativeImage } = require("electron");
const path = require("path");
const fs = require("fs");

// Keep references to prevent garbage collection
let mainWindow = null;
let tray = null;
let server = null;

const PORT = 3000;
const APP_DATA = path.join(app.getPath("userData"), "data");

// ── Ensure data directory exists ──
if (!fs.existsSync(APP_DATA)) fs.mkdirSync(APP_DATA, { recursive: true });

// ── Auto-detect WoW installation ──
function findWoWPath() {
  const home = process.env.HOME || process.env.USERPROFILE || "";
  const common = [
    // Windows
    "C:/Program Files (x86)/World of Warcraft/_retail_",
    "C:/Program Files/World of Warcraft/_retail_",
    "D:/World of Warcraft/_retail_",
    "D:/Games/World of Warcraft/_retail_",
    "E:/World of Warcraft/_retail_",
    // Mac
    "/Applications/World of Warcraft/_retail_",
    path.join(home, "Applications/World of Warcraft/_retail_"),
  ];
  for (const p of common) {
    if (fs.existsSync(path.join(p, "WTF"))) return p;
  }
  return null;
}

// ── Install addon to WoW ──
function installAddon(wowPath) {
  const addonsDir = path.join(wowPath, "Interface", "AddOns", "WoWDashboard");
  const sourceDir = path.join(__dirname, "addon", "WoWDashboard");

  // Use extraResources path if running from packaged app
  const resourceDir = path.join(process.resourcesPath, "addon", "WoWDashboard");
  const source = fs.existsSync(resourceDir) ? resourceDir : sourceDir;

  if (!fs.existsSync(source)) {
    console.error("Addon source not found at:", source);
    return false;
  }

  try {
    if (!fs.existsSync(addonsDir)) fs.mkdirSync(addonsDir, { recursive: true });
    const files = fs.readdirSync(source);
    for (const file of files) {
      fs.copyFileSync(path.join(source, file), path.join(addonsDir, file));
    }
    console.log("Addon installed to:", addonsDir);
    return true;
  } catch (err) {
    console.error("Failed to install addon:", err.message);
    return false;
  }
}

// ── Start Express server ──
function startServer() {
  // Set environment for the server
  process.env.MODE = "local";

  // Point the server to the right directories
  const serverPath = path.join(__dirname, "server.js");
  if (!fs.existsSync(serverPath)) {
    console.error("server.js not found");
    return;
  }

  // Clear require cache and load server
  delete require.cache[require.resolve("./server.js")];
  server = require("./server.js");
  console.log(`Server started on port ${PORT}`);
}

// ── Background sync (file watcher) ──
let syncDebounce = null;

function startSync(wowPath) {
  const accountDir = path.join(wowPath, "WTF", "Account");
  if (!fs.existsSync(accountDir)) return;

  try {
    const accounts = fs.readdirSync(accountDir);
    for (const account of accounts) {
      const svDir = path.join(accountDir, account, "SavedVariables");
      if (!fs.existsSync(svDir)) continue;

      fs.watch(svDir, (eventType, filename) => {
        if (!filename || !filename.includes("WoWDashboard")) return;
        if (syncDebounce) clearTimeout(syncDebounce);
        syncDebounce = setTimeout(() => {
          console.log("SavedVariables changed — refreshing dashboard");
          if (mainWindow) mainWindow.webContents.reload();
        }, 3000);
      });
      console.log("Watching:", svDir);
    }
  } catch (err) {
    console.error("Sync watch error:", err.message);
  }
}

// ── Create main window ──
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 850,
    minWidth: 900,
    minHeight: 600,
    title: "WoW Dashboard",
    backgroundColor: "#080810",
    icon: path.join(__dirname, "public", "icon.png"),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
    titleBarStyle: "hiddenInset", // sleek title bar on Mac
    autoHideMenuBar: true,       // hide menu bar on Windows
  });

  mainWindow.loadURL(`http://localhost:${PORT}`);

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  // Open external links in browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
}

// ── System tray ──
function createTray() {
  const iconPath = path.join(__dirname, "public", "icon.png");
  let trayIcon;
  if (fs.existsSync(iconPath)) {
    trayIcon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
  } else {
    trayIcon = nativeImage.createEmpty();
  }

  tray = new Tray(trayIcon);
  tray.setToolTip("WoW Dashboard");

  const contextMenu = Menu.buildFromTemplate([
    {
      label: "Open Dashboard",
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        } else {
          createWindow();
        }
      },
    },
    {
      label: "Install/Update Addon",
      click: () => {
        const wowPath = findWoWPath();
        if (wowPath) {
          const success = installAddon(wowPath);
          dialog.showMessageBox({
            type: success ? "info" : "error",
            message: success
              ? "Addon installed! Type /reload in WoW."
              : "Failed to install addon. Check WoW is installed.",
          });
        } else {
          dialog.showMessageBox({
            type: "error",
            message: "Could not find WoW installation.",
          });
        }
      },
    },
    { type: "separator" },
    {
      label: "Open in Browser",
      click: () => shell.openExternal(`http://localhost:${PORT}`),
    },
    { type: "separator" },
    {
      label: "Quit",
      click: () => {
        app.isQuitting = true;
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);
  tray.on("click", () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    } else {
      createWindow();
    }
  });
}

// ── App lifecycle ──
app.whenReady().then(() => {
  const wowPath = findWoWPath();

  // Start the Express server
  startServer();

  // Create window and tray
  createWindow();
  createTray();

  // Auto-install addon if WoW found
  if (wowPath) {
    installAddon(wowPath);
    startSync(wowPath);
    console.log("WoW found at:", wowPath);
  } else {
    console.log("WoW not found — addon install skipped");
  }

  // macOS: re-create window when dock icon clicked
  app.on("activate", () => {
    if (mainWindow === null) createWindow();
  });
});

// Minimize to tray instead of quitting
app.on("window-all-closed", () => {
  if (process.platform !== "darwin" && !app.isQuitting) {
    // Keep running in tray
  }
});

app.on("before-quit", () => {
  app.isQuitting = true;
});
