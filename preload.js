const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  getDocumentsPath: () => ipcRenderer.invoke('get-documents-path'),
  selectFolder: () => ipcRenderer.invoke('select-folder'),
  checkFolderExists: (folderPath) => ipcRenderer.invoke('check-folder-exists', folderPath),
  scanModels: (folderPath) => ipcRenderer.invoke('scan-models', folderPath),
  getAppPath: () => ipcRenderer.invoke('get-app-path'),
  getPiperPath: () => ipcRenderer.invoke('get-piper-path'),
  getFfmpegPath: () => ipcRenderer.invoke('get-ffmpeg-path')
});

// Expose API for server communication
contextBridge.exposeInMainWorld('serverAPI', {
  convertText: async (text, modelPath, settings) => {
    try {
      const response = await fetch('http://localhost:3000/convert', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text: text,
          modelPath: modelPath,
          settings: settings
        })
      });
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      return await response.json();
    } catch (error) {
      console.error('Error converting text:', error);
      throw error;
    }
  },
  
  getModels: async () => {
    try {
      const response = await fetch('http://localhost:3000/models');
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      return await response.json();
    } catch (error) {
      console.error('Error getting models:', error);
      throw error;
    }
  },
  
  setModelPaths: async (paths) => {
    try {
      const response = await fetch('http://localhost:3000/set-model-paths', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ paths })
      });
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      return await response.json();
    } catch (error) {
      console.error('Error setting model paths:', error);
      throw error;
    }
  }
});
