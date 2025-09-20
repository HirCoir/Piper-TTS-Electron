const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs-extra');
const os = require('os');
const { spawn } = require('child_process');

// Keep a global reference of the window object
let mainWindow;
let serverProcess;

function createWindow() {
  // Create the browser window
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      enableRemoteModule: false,
      preload: path.join(__dirname, 'preload.js')
    },
    icon: path.join(__dirname, 'assets', 'icon.ico'),
    show: false,
    titleBarStyle: 'default',
    autoHideMenuBar: true // Hide the menu bar (File, Edit, View, etc.)
  });

  // Load the app
  mainWindow.loadFile('index.html');

  // Remove default menu completely
  mainWindow.setMenu(null);

  // Show window when ready to prevent visual flash
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // Open DevTools in development
  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools();
  }

  // Emitted when the window is closed
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// Start the Node.js server
function startServer() {
  try {
    // Import and start the server directly in the main process
    const serverPath = path.join(__dirname, 'server.js');
    console.log('Starting integrated server from:', serverPath);
    
    // Set environment variable to indicate we're in packaged mode
    process.env.ELECTRON_IS_PACKAGED = app.isPackaged ? 'true' : 'false';
    
    // Require the server module directly
    require(serverPath);
    
    console.log('Server started successfully in main process');
  } catch (error) {
    console.error('Failed to start integrated server:', error);
  }
}

// Stop the server
function stopServer() {
  // Server is now integrated, no separate process to kill
  console.log('Server shutdown handled by main process exit');
}

// App event listeners
app.whenReady().then(() => {
  createWindow();
  startServer();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  stopServer();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  stopServer();
});

// IPC handlers
ipcMain.handle('get-documents-path', () => {
  return path.join(os.homedir(), 'Documents');
});

ipcMain.handle('select-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: 'Seleccionar carpeta de modelos Piper PRO'
  });
  
  if (!result.canceled && result.filePaths.length > 0) {
    return result.filePaths[0];
  }
  return null;
});

ipcMain.handle('check-folder-exists', async (event, folderPath) => {
  try {
    const stats = await fs.stat(folderPath);
    return stats.isDirectory();
  } catch (error) {
    return false;
  }
});

ipcMain.handle('scan-models', async (event, folderPath) => {
  try {
    const files = await fs.readdir(folderPath);
    const models = [];

    for (const file of files) {
      if (file.endsWith('.onnx.json')) {
        const jsonPath = path.join(folderPath, file);
        const onnxPath = path.join(folderPath, file.replace('.onnx.json', '.onnx'));
        
        // Check if corresponding .onnx file exists
        if (await fs.pathExists(onnxPath)) {
          try {
            const modelData = await fs.readJson(jsonPath);
            const modelcard = modelData.modelcard || {};
            
            models.push({
              id: modelcard.id || file.replace('.onnx.json', ''),
              name: modelcard.name || file.replace('.onnx.json', ''),
              description: modelcard.description || 'No description available',
              language: modelcard.language || 'Unknown',
              voiceprompt: modelcard.voiceprompt || 'Not available',
              jsonPath: jsonPath,
              onnxPath: onnxPath,
              image: modelcard.image || null
            });
          } catch (error) {
            console.error(`Error reading model ${file}:`, error);
          }
        }
      }
    }

    return models;
  } catch (error) {
    console.error('Error scanning models:', error);
    return [];
  }
});

ipcMain.handle('get-app-path', () => {
  return app.getAppPath();
});

ipcMain.handle('get-piper-path', () => {
  // In packaged app, resources are in a different location
  if (app.isPackaged) {
    const resourcesPath = process.resourcesPath;
    const piperExe = process.platform === 'win32' ? 'piper.exe' : 'piper';
    return path.join(resourcesPath, 'piper', piperExe);
  } else {
    const appPath = app.getAppPath();
    const piperExe = process.platform === 'win32' ? 'piper.exe' : 'piper';
    return path.join(appPath, 'piper', piperExe);
  }
});

ipcMain.handle('get-ffmpeg-path', () => {
  // In packaged app, resources are in a different location
  if (app.isPackaged) {
    const resourcesPath = process.resourcesPath;
    return path.join(resourcesPath, 'ffmpeg.exe');
  } else {
    const appPath = app.getAppPath();
    return path.join(appPath, 'ffmpeg.exe');
  }
});
