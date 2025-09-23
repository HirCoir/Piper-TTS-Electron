// Global variables
let availableModels = [];
let selectedModel = null;
let isConverting = false;
let currentAudio = null;
let currentConversionId = null;
let progressInterval = null;

// DOM elements
let textInput;
let modelSelector;
let modelList;
let modelSearch;
let generateBtn;
let audioPlayer;
let audioContainer;
let progressContainer;
let settingsPanel;
let folderPathsContainer;

// Initialize the application
document.addEventListener('DOMContentLoaded', async () => {
  initializeElements();
  await loadModels();
  setupEventListeners();
  await loadSettings();
  autoResizeTextarea(); // Resize on load if there's saved text
  
  // Clean up on page unload
  window.addEventListener('beforeunload', () => {
    if (currentConversionId) {
      cancelCurrentConversion();
    }
  });
});

function initializeElements() {
  textInput = document.getElementById('text-input');
  modelSelector = document.getElementById('model-selector');
  modelList = document.getElementById('model-list');
  modelSearch = document.getElementById('model-search');
  generateBtn = document.getElementById('generate-btn');
  audioPlayer = document.getElementById('audio-player');
  audioContainer = document.getElementById('audio-container');
  progressContainer = document.getElementById('progress-container');
  settingsPanel = document.getElementById('settings-panel');
  folderPathsContainer = document.getElementById('folder-paths');
}

function setupEventListeners() {
  // Generate button
  generateBtn.addEventListener('click', handleGenerate);

  // Model search
  modelSearch.addEventListener('input', filterModels);
  
  // Settings button
  document.getElementById('settings-btn').addEventListener('click', toggleSettings);

  // Right-click context menu
  document.addEventListener('contextmenu', handleContextMenu);
  
  // Add folder button
  document.getElementById('add-folder-btn').addEventListener('click', addModelFolder);
  
  // Rescan models button
  document.getElementById('rescan-btn').addEventListener('click', rescanModels);
  
  // Close settings
  document.getElementById('close-settings').addEventListener('click', () => {
    settingsPanel.classList.add('hidden');
  });
  
  // Thread settings
  const autoThreadsCheckbox = document.getElementById('auto-threads-setting');
  const maxThreadsInput = document.getElementById('max-threads-setting');
  const manualThreadsContainer = document.getElementById('manual-threads-container');
  
  if (autoThreadsCheckbox) {
    autoThreadsCheckbox.addEventListener('change', () => {
      if (autoThreadsCheckbox.checked) {
        manualThreadsContainer.style.display = 'none';
      } else {
        manualThreadsContainer.style.display = 'block';
      }
      saveThreadSettings();
    });
  }
  
  if (maxThreadsInput) {
    maxThreadsInput.addEventListener('change', saveThreadSettings);
  }
  
  // Text input auto-save, auto-resize, and paste handling
  textInput.addEventListener('input', () => {
    saveTextToStorage();
    autoResizeTextarea();
  });

  textInput.addEventListener('paste', handlePaste);
  
  // Load saved text
  const savedText = localStorage.getItem('tts-text');
  if (savedText) {
    textInput.value = savedText;
  }
}

function autoResizeTextarea() {
  textInput.style.height = 'auto';
  textInput.style.height = `${textInput.scrollHeight}px`;
}

function saveTextToStorage() {
  localStorage.setItem('tts-text', textInput.value);
}

async function loadModels() {
  try {
    showLoading('Cargando modelos...');
    const response = await window.serverAPI.getModels();
    
    if (response.success) {
      availableModels = response.models;
      renderModels();
      updateModelCount();
    } else {
      showError('Error al cargar modelos: ' + response.error);
    }
  } catch (error) {
    console.error('Error loading models:', error);
    showError('Error de conexión al cargar modelos');
  } finally {
    hideLoading();
  }
}

function renderModels() {
  if (!modelList) return;
  
  modelList.innerHTML = '';
  
  if (availableModels.length === 0) {
    modelList.innerHTML = `
      <div class="no-models">
        <i class="fas fa-robot text-4xl text-gray-500 mb-4"></i>
        <p class="text-gray-400">No se encontraron modelos</p>
        <p class="text-sm text-gray-500">Agrega carpetas de modelos en configuración</p>
      </div>
    `;
    return;
  }
  
  availableModels.forEach(model => {
    const modelCard = createModelCard(model);
    modelList.appendChild(modelCard);
  });
}

function createModelCard(model) {
  const card = document.createElement('div');
  card.className = 'model-card';
  card.dataset.modelId = model.id;
  
  // Handle base64 image properly
  let imageHtml;
  if (model.image) {
    // Check if it's already a data URL or just base64 data
    const imageSrc = model.image.startsWith('data:') 
      ? model.image 
      : `data:image/png;base64,${model.image}`;
    imageHtml = `<img src="${imageSrc}" alt="${model.name}" class="model-image">`;
  } else {
    imageHtml = `<div class="model-image-placeholder"><i class="fas fa-robot"></i></div>`;
  }
  
  card.innerHTML = `
    ${imageHtml}
    <div class="model-info">
      <h3 class="model-name">${model.name}</h3>
      <p class="model-description">${model.description}</p>
      <div class="model-meta">
        <span class="model-language">
          <i class="fas fa-language"></i>
          ${model.language}
        </span>
        <span class="model-source">
          <i class="fas fa-folder"></i>
          ${getSourceName(model.source)}
        </span>
      </div>
    </div>
  `;
  
  card.addEventListener('click', () => selectModel(model));
  
  return card;
}

function getSourceName(sourcePath) {
  const parts = sourcePath.split(/[/\\]/);
  return parts[parts.length - 1] || 'Local';
}

function selectModel(model) {
  selectedModel = model;
  
  // Update UI
  document.querySelectorAll('.model-card').forEach(card => {
    card.classList.remove('selected');
  });
  
  document.querySelector(`[data-model-id="${model.id}"]`).classList.add('selected');
  
  // Update selected model display
  const selectedDisplay = document.getElementById('selected-model');
  if (selectedDisplay) {
    let imageHtml;
    if (model.image) {
      const imageSrc = model.image.startsWith('data:') 
        ? model.image 
        : `data:image/png;base64,${model.image}`;
      imageHtml = `<img src="${imageSrc}" alt="${model.name}" class="selected-model-image">`;
    } else {
      imageHtml = `<div class="selected-model-placeholder"><i class="fas fa-robot"></i></div>`;
    }
    
    selectedDisplay.innerHTML = `
      ${imageHtml}
      <div>
        <div class="selected-model-name">${model.name}</div>
        <div class="selected-model-language">${model.language}</div>
      </div>
    `;
  }
  
  // Enable generate button
  generateBtn.disabled = false;
  generateBtn.querySelector('span').textContent = 'Generar Audio';
}

function filterModels() {
  const searchTerm = modelSearch.value.toLowerCase();
  const modelCards = document.querySelectorAll('.model-card');
  
  modelCards.forEach(card => {
    const modelId = card.dataset.modelId;
    const model = availableModels.find(m => m.id === modelId);
    
    if (model) {
      const matchesSearch = 
        model.name.toLowerCase().includes(searchTerm) ||
        model.description.toLowerCase().includes(searchTerm) ||
        model.language.toLowerCase().includes(searchTerm);
      
      // Revert to stylesheet's display property ('flex') when visible, or hide
      card.style.display = matchesSearch ? '' : 'none';
    }
  });
}

function handlePaste(event) {
    // Prevent the default paste action
    event.preventDefault();

    // Get the plain text content from the clipboard, which preserves line breaks
    const pastedText = (event.clipboardData || window.clipboardData).getData('text/plain');
    
    const start = textInput.selectionStart;
    const end = textInput.selectionEnd;

    // Insert the pasted text at the cursor position
    textInput.value = textInput.value.substring(0, start) + pastedText + textInput.value.substring(end);

    // Move the cursor to the end of the inserted text
    const newCursorPosition = start + pastedText.length;
    textInput.selectionStart = newCursorPosition;
    textInput.selectionEnd = newCursorPosition;
    
    // Manually trigger the input event to ensure autosave and resize functions are called
    textInput.dispatchEvent(new Event('input', { bubbles: true }));
}

function handleContextMenu(event) {
  event.preventDefault();
  
  // Store the target element
  const targetElement = event.target;
  
  // Create context menu
  const contextMenu = document.createElement('div');
  contextMenu.className = 'context-menu';
  contextMenu.style.position = 'fixed';
  contextMenu.style.left = event.clientX + 'px';
  contextMenu.style.top = event.clientY + 'px';
  contextMenu.style.zIndex = '10000';
  
  // Check if we're right-clicking on a text input
  const isTextInput = targetElement.tagName === 'TEXTAREA' || targetElement.tagName === 'INPUT';
  
  if (isTextInput) {
    // Create menu items with proper event handlers
    const cutItem = document.createElement('div');
    cutItem.className = 'context-menu-item';
    cutItem.innerHTML = '<i class="fas fa-cut"></i> Cortar';
    cutItem.onclick = () => {
      targetElement.focus();
      document.execCommand('cut');
      removeContextMenu();
    };
    
    const copyItem = document.createElement('div');
    copyItem.className = 'context-menu-item';
    copyItem.innerHTML = '<i class="fas fa-copy"></i> Copiar';
    copyItem.onclick = () => {
      targetElement.focus();
      document.execCommand('copy');
      removeContextMenu();
    };
    
    const pasteItem = document.createElement('div');
    pasteItem.className = 'context-menu-item';
    pasteItem.innerHTML = '<i class="fas fa-paste"></i> Pegar';
    pasteItem.onclick = async () => {
      targetElement.focus();
      try {
        const text = await navigator.clipboard.readText();
        const start = targetElement.selectionStart;
        const end = targetElement.selectionEnd;
        targetElement.value = targetElement.value.substring(0, start) + text + targetElement.value.substring(end);
        targetElement.selectionStart = targetElement.selectionEnd = start + text.length;
        targetElement.dispatchEvent(new Event('input', { bubbles: true }));
      } catch (err) {
        document.execCommand('paste');
      }
      removeContextMenu();
    };
    
    const separator = document.createElement('div');
    separator.className = 'context-menu-separator';
    
    const selectAllItem = document.createElement('div');
    selectAllItem.className = 'context-menu-item';
    selectAllItem.innerHTML = '<i class="fas fa-select-all"></i> Seleccionar todo';
    selectAllItem.onclick = () => {
      targetElement.focus();
      targetElement.select();
      removeContextMenu();
    };
    
    contextMenu.appendChild(cutItem);
    contextMenu.appendChild(copyItem);
    contextMenu.appendChild(pasteItem);
    contextMenu.appendChild(separator);
    contextMenu.appendChild(selectAllItem);
  } else {
    const reloadItem = document.createElement('div');
    reloadItem.className = 'context-menu-item';
    reloadItem.innerHTML = '<i class="fas fa-sync"></i> Recargar';
    reloadItem.onclick = () => {
      window.location.reload();
    };
    
    const settingsItem = document.createElement('div');
    settingsItem.className = 'context-menu-item';
    settingsItem.innerHTML = '<i class="fas fa-cog"></i> Configuración';
    settingsItem.onclick = () => {
      document.getElementById('settings-btn').click();
      removeContextMenu();
    };
    
    contextMenu.appendChild(reloadItem);
    contextMenu.appendChild(settingsItem);
  }
  
  document.body.appendChild(contextMenu);
  
  // Function to remove context menu
  function removeContextMenu() {
    if (contextMenu.parentNode) {
      contextMenu.parentNode.removeChild(contextMenu);
    }
    document.removeEventListener('click', removeMenu);
  }
  
  // Remove menu when clicking elsewhere
  const removeMenu = (e) => {
    if (!contextMenu.contains(e.target)) {
      removeContextMenu();
    }
  };
  
  setTimeout(() => {
    document.addEventListener('click', removeMenu);
  }, 10);
}

async function handleGenerate() {
  if (!selectedModel) {
    showError('Por favor selecciona un modelo');
    return;
  }
  
  const text = textInput.value.trim();
  if (!text) {
    showError('Por favor ingresa el texto a convertir');
    return;
  }
  
  if (isConverting) {
    // If already converting, cancel the current conversion
    await cancelCurrentConversion();
    return;
  }
  
  try {
    isConverting = true;
    updateGenerateButton(true);
    showProgressWithCancel('Iniciando conversión...');
    
    const settings = getAudioSettings();
    
    const response = await window.serverAPI.convertText(text, selectedModel.onnxPath, settings);
    
    if (response.success) {
      currentConversionId = response.conversionId;
      showProgressWithCancel(`Procesando ${response.totalSentences} oraciones...`);
      
      // Start polling for progress
      startProgressPolling();
    } else {
      showError('Error al iniciar conversión: ' + response.error);
      resetConversionState();
    }
  } catch (error) {
    console.error('Error starting conversion:', error);
    showError('Error de conexión al iniciar conversión');
    resetConversionState();
  }
}

function getAudioSettings() {
  return {
    speaker: parseInt(document.getElementById('speaker-setting')?.value || '0'),
    noise_scale: parseFloat(document.getElementById('noise-scale-setting')?.value || '0.667'),
    length_scale: parseFloat(document.getElementById('length-scale-setting')?.value || '1.0'),
    noise_w: parseFloat(document.getElementById('noise-w-setting')?.value || '0.8')
  };
}

function displayAudio(audioData) {
  if (currentAudio) {
    currentAudio.pause();
    currentAudio = null;
  }
  
  audioPlayer.src = audioData;
  audioContainer.classList.remove('hidden');
  
  currentAudio = audioPlayer;
  
  // Auto-play the audio
  audioPlayer.play().catch(error => {
    console.log('Auto-play prevented:', error);
  });
}

function updateGenerateButton(loading) {
  if (loading) {
    generateBtn.innerHTML = `
      <i class="fas fa-stop"></i>
      <span>Cancelar</span>
    `;
    generateBtn.disabled = false;
    generateBtn.classList.add('cancel-mode');
  } else {
    generateBtn.innerHTML = `
      <i class="fas fa-play"></i>
      <span>Generar Audio</span>
    `;
    generateBtn.disabled = !selectedModel;
    generateBtn.classList.remove('cancel-mode');
  }
}

function showProgress(message) {
  if (progressContainer) {
    progressContainer.innerHTML = `
      <div class="progress-message">
        <div class="loading-spinner"></div>
        <span>${message}</span>
      </div>
    `;
    progressContainer.classList.remove('hidden');
  }
}

function showProgressWithCancel(message, progress = null) {
  if (progressContainer) {
    let progressBarHtml = '';
    if (progress) {
      progressBarHtml = `
        <div class="progress-bar-container">
          <div class="progress-bar">
            <div class="progress-bar-fill" style="width: ${progress.percentage}%"></div>
          </div>
          <div class="progress-text">${progress.completed}/${progress.total} oraciones (${progress.percentage}%)</div>
        </div>
      `;
    }
    
    progressContainer.innerHTML = `
      <div class="progress-dialog">
        <div class="progress-header">
          <span>${message}</span>
          <button class="cancel-btn" onclick="cancelCurrentConversion()">
            <i class="fas fa-times"></i>
          </button>
        </div>
        ${progressBarHtml}
        <div class="progress-spinner">
          <div class="loading-spinner"></div>
        </div>
      </div>
    `;
    progressContainer.classList.remove('hidden');
  }
}

function hideProgress() {
  if (progressContainer) {
    progressContainer.classList.add('hidden');
  }
}

function showLoading(message) {
  showProgress(message);
}

function hideLoading() {
  hideProgress();
}

function showError(message) {
  showNotification(message, 'error');
}

function showSuccess(message) {
  showNotification(message, 'success');
}

function showNotification(message, type = 'info') {
  const notification = document.createElement('div');
  notification.className = `notification notification-${type}`;
  
  const icon = type === 'error' ? 'fas fa-exclamation-circle' : 
               type === 'success' ? 'fas fa-check-circle' : 'fas fa-info-circle';
  
  notification.innerHTML = `
    <i class="${icon}"></i>
    <span>${message}</span>
    <button class="notification-close" onclick="this.parentElement.remove()">
      <i class="fas fa-times"></i>
    </button>
  `;
  
  document.body.appendChild(notification);
  
  // Auto-remove after 5 seconds
  setTimeout(() => {
    if (notification.parentElement) {
      notification.remove();
    }
  }, 5000);
}

function toggleSettings() {
  settingsPanel.classList.toggle('hidden');
  if (!settingsPanel.classList.contains('hidden')) {
    loadFolderPaths();
  }
}

async function loadFolderPaths() {
  try {
    const documentsPath = await window.electronAPI.getDocumentsPath();
    const onnxTtsPath = `${documentsPath}\\ONNX-TTS`;
    
    folderPathsContainer.innerHTML = `
      <div class="folder-path-item">
        <div class="folder-info">
          <i class="fas fa-folder"></i>
          <span>${onnxTtsPath}</span>
          <span class="folder-status" id="status-default">Verificando...</span>
        </div>
      </div>
    `;
    
    // Check if default folder exists
    const exists = await window.electronAPI.checkFolderExists(onnxTtsPath);
    const statusElement = document.getElementById('status-default');
    
    if (exists) {
      statusElement.textContent = 'Disponible';
      statusElement.className = 'folder-status status-available';
    } else {
      statusElement.textContent = 'No encontrada';
      statusElement.className = 'folder-status status-missing';
    }
  } catch (error) {
    console.error('Error loading folder paths:', error);
  }
}

async function addModelFolder() {
  try {
    const folderPath = await window.electronAPI.selectFolder();
    
    if (folderPath) {
      // Add to server
      const currentPaths = [folderPath];
      const documentsPath = await window.electronAPI.getDocumentsPath();
      const onnxTtsPath = `${documentsPath}\\ONNX-TTS`;
      currentPaths.push(onnxTtsPath);
      
      await window.serverAPI.setModelPaths(currentPaths);
      
      // Reload models
      await loadModels();
      loadFolderPaths();
      
      showSuccess('Carpeta de modelos agregada exitosamente');
    }
  } catch (error) {
    console.error('Error adding model folder:', error);
    showError('Error al agregar carpeta de modelos');
  }
}

async function rescanModels() {
  try {
    showLoading('Reescaneando modelos...');
    
    const port = await window.electronAPI.getServerPort();
    const response = await fetch(`http://localhost:${port}/rescan-models`);
    const data = await response.json();
    
    if (data.success) {
      await loadModels();
      showSuccess(`Modelos reescaneados: ${data.modelCount} encontrados`);
    } else {
      showError('Error al reescanear modelos: ' + data.error);
    }
  } catch (error) {
    console.error('Error rescanning models:', error);
    showError('Error de conexión al reescanear modelos');
  } finally {
    hideLoading();
  }
}

function updateModelCount() {
  const countElement = document.getElementById('model-count');
  if (countElement) {
    countElement.textContent = `${availableModels.length} modelos disponibles`;
  }
}

async function loadSettings() {
  // Load saved settings from localStorage
  const settings = JSON.parse(localStorage.getItem('tts-settings') || '{}');
  
  // Apply settings to UI elements
  const speakerSetting = document.getElementById('speaker-setting');
  const noiseScaleSetting = document.getElementById('noise-scale-setting');
  const lengthScaleSetting = document.getElementById('length-scale-setting');
  const noiseWSetting = document.getElementById('noise-w-setting');
  
  if (speakerSetting) speakerSetting.value = settings.speaker || '0';
  if (noiseScaleSetting) noiseScaleSetting.value = settings.noise_scale || '0.667';
  if (lengthScaleSetting) lengthScaleSetting.value = settings.length_scale || '1.0';
  if (noiseWSetting) noiseWSetting.value = settings.noise_w || '0.8';
  
  // Add event listeners to save settings
  [speakerSetting, noiseScaleSetting, lengthScaleSetting, noiseWSetting].forEach(element => {
    if (element) {
      element.addEventListener('change', saveSettings);
    }
  });
  
  // Load thread settings from server
  await loadThreadSettings();
  
  // Start queue status updates
  startQueueStatusUpdates();
}

function saveSettings() {
  const settings = {
    speaker: document.getElementById('speaker-setting')?.value || '0',
    noise_scale: document.getElementById('noise-scale-setting')?.value || '0.667',
    length_scale: document.getElementById('length-scale-setting')?.value || '1.0',
    noise_w: document.getElementById('noise-w-setting')?.value || '0.8'
  };
  
  localStorage.setItem('tts-settings', JSON.stringify(settings));
}

// Thread settings functions
async function loadThreadSettings() {
  try {
    const port = await window.electronAPI.getServerPort();
    const response = await fetch(`http://localhost:${port}/settings`);
    const data = await response.json();
    
    if (data.success) {
      const { settings, queueStatus } = data;
      
      // Update UI elements
      const autoThreadsCheckbox = document.getElementById('auto-threads-setting');
      const maxThreadsInput = document.getElementById('max-threads-setting');
      const manualThreadsContainer = document.getElementById('manual-threads-container');
      const cpuCoresSpan = document.getElementById('cpu-cores');
      const recommendedThreadsSpan = document.getElementById('recommended-threads');
      
      if (autoThreadsCheckbox) {
        autoThreadsCheckbox.checked = settings.autoDetectThreads;
      }
      
      if (maxThreadsInput) {
        maxThreadsInput.value = settings.maxThreads;
      }
      
      if (manualThreadsContainer) {
        manualThreadsContainer.style.display = settings.autoDetectThreads ? 'none' : 'block';
      }
      
      if (cpuCoresSpan) {
        cpuCoresSpan.textContent = settings.cpuCores;
      }
      
      if (recommendedThreadsSpan) {
        recommendedThreadsSpan.textContent = settings.recommendedThreads;
      }
      
      updateQueueStatus(queueStatus);
    }
  } catch (error) {
    console.error('Error loading thread settings:', error);
  }
}

async function saveThreadSettings() {
  try {
    const autoThreadsCheckbox = document.getElementById('auto-threads-setting');
    const maxThreadsInput = document.getElementById('max-threads-setting');
    
    const requestData = {
      autoDetectThreads: autoThreadsCheckbox?.checked === true,
      maxThreads: parseInt(maxThreadsInput?.value || '8')
    };
    
    console.log('[UI] Saving thread settings:', requestData);
    
    const port = await window.electronAPI.getServerPort();
    const response = await fetch(`http://localhost:${port}/settings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestData)
    });
    
    const data = await response.json();
    
    if (data.success) {
      updateQueueStatus(data.queueStatus);
      showSuccess('Configuración de hilos actualizada');
    } else {
      showError('Error al actualizar configuración: ' + data.error);
    }
  } catch (error) {
    console.error('Error saving thread settings:', error);
    showError('Error de conexión al guardar configuración');
  }
}

function updateQueueStatus(queueStatus) {
  const queueStatusSpan = document.getElementById('queue-status');
  const runningProcessesSpan = document.getElementById('running-processes');
  const queuedProcessesSpan = document.getElementById('queued-processes');
  
  if (queueStatusSpan) {
    queueStatusSpan.textContent = `${queueStatus.maxConcurrent} máx`;
  }
  
  if (runningProcessesSpan) {
    runningProcessesSpan.textContent = queueStatus.running;
  }
  
  if (queuedProcessesSpan) {
    queuedProcessesSpan.textContent = queueStatus.queued;
  }
}

function startQueueStatusUpdates() {
  // Update queue status every 2 seconds when settings panel is open
  setInterval(async () => {
    if (!settingsPanel.classList.contains('hidden')) {
      try {
        const port = await window.electronAPI.getServerPort();
        const response = await fetch(`http://localhost:${port}/queue-status`);
        const data = await response.json();
        
        if (data.success) {
          updateQueueStatus(data.status);
        }
      } catch (error) {
        // Silently fail - don't spam console with connection errors
      }
    }
  }, 2000);
}

// Progress polling functions
function startProgressPolling() {
  if (progressInterval) {
    clearInterval(progressInterval);
  }
  
  progressInterval = setInterval(async () => {
    if (!currentConversionId) {
      clearInterval(progressInterval);
      return;
    }
    
    try {
      const port = await window.electronAPI.getServerPort();
      const response = await fetch(`http://localhost:${port}/conversion-status/${currentConversionId}`);
      const data = await response.json();
      
      if (data.success) {
        const conversion = data.conversion;
        
        if (conversion.cancelled) {
          showError('Conversión cancelada');
          resetConversionState();
        } else if (conversion.failed) {
          showError('Error en la conversión: ' + (conversion.error || 'Error desconocido'));
          resetConversionState();
        } else if (conversion.completed) {
          // Conversion completed successfully
          displayAudio(conversion.result.audio);
          showSuccess(`Audio generado exitosamente (${conversion.result.sentenceCount} oraciones)`);
          resetConversionState();
        } else {
          // Update progress
          const progress = conversion.progress;
          showProgressWithCancel(
            `Procesando oraciones...`,
            progress
          );
        }
      } else {
        showError('Error al obtener estado de conversión');
        resetConversionState();
      }
    } catch (error) {
      console.error('Error polling conversion status:', error);
      showError('Error de conexión al obtener progreso');
      resetConversionState();
    }
  }, 1000); // Poll every second
}

async function cancelCurrentConversion() {
  if (!currentConversionId) {
    resetConversionState();
    return;
  }
  
  try {
    const port = await window.electronAPI.getServerPort();
    const response = await fetch(`http://localhost:${port}/cancel-conversion/${currentConversionId}`, {
      method: 'POST'
    });
    
    const data = await response.json();
    
    if (data.success) {
      showSuccess('Conversión cancelada');
    } else {
      showError('Error al cancelar: ' + data.error);
    }
  } catch (error) {
    console.error('Error cancelling conversion:', error);
    showError('Error de conexión al cancelar');
  }
  
  resetConversionState();
}

function resetConversionState() {
  isConverting = false;
  currentConversionId = null;
  
  if (progressInterval) {
    clearInterval(progressInterval);
    progressInterval = null;
  }
  
  updateGenerateButton(false);
  hideProgress();
}