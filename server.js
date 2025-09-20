const express = require('express');
const fs = require('fs-extra');
const path = require('path');
const { spawn } = require('child_process');
const os = require('os');
const crypto = require('crypto');

// Get CPU core count for parallel processing
const CPU_CORES = os.cpus().length;

// Process queue configuration
class ProcessQueue {
  constructor(maxConcurrent = null) {
    this.maxConcurrent = maxConcurrent || Math.min(32, CPU_CORES * 2); // Default: 2x CPU cores
    this.running = new Set();
    this.queue = [];
    console.log(`[QUEUE] Initialized with max ${this.maxConcurrent} concurrent processes (CPU cores: ${CPU_CORES})`);
  }

  setMaxConcurrent(max) {
    this.maxConcurrent = Math.max(1, Math.min(32, max));
    console.log(`[QUEUE] Max concurrent processes updated to ${this.maxConcurrent}`);
    this.processQueue();
  }

  async add(task) {
    return new Promise((resolve, reject) => {
      const queueItem = {
        task,
        resolve,
        reject,
        id: Math.random().toString(36).substr(2, 9)
      };
      
      this.queue.push(queueItem);
      console.log(`[QUEUE] Added task ${queueItem.id} to queue. Queue size: ${this.queue.length}, Running: ${this.running.size}`);
      
      this.processQueue();
    });
  }

  async processQueue() {
    while (this.queue.length > 0 && this.running.size < this.maxConcurrent) {
      const queueItem = this.queue.shift();
      this.running.add(queueItem.id);
      
      console.log(`[QUEUE] Starting task ${queueItem.id}. Running: ${this.running.size}/${this.maxConcurrent}`);
      
      // Execute the task
      queueItem.task()
        .then(result => {
          this.running.delete(queueItem.id);
          console.log(`[QUEUE] Completed task ${queueItem.id}. Running: ${this.running.size}/${this.maxConcurrent}`);
          queueItem.resolve(result);
          this.processQueue(); // Process next item in queue
        })
        .catch(error => {
          this.running.delete(queueItem.id);
          console.log(`[QUEUE] Failed task ${queueItem.id}. Running: ${this.running.size}/${this.maxConcurrent}`);
          queueItem.reject(error);
          this.processQueue(); // Process next item in queue
        });
    }
  }

  getStatus() {
    return {
      maxConcurrent: this.maxConcurrent,
      running: this.running.size,
      queued: this.queue.length,
      cpuCores: CPU_CORES
    };
  }
}

// Global process queue instance
const processQueue = new ProcessQueue();

// Settings for user configuration
let userSettings = {
  maxThreads: processQueue.maxConcurrent,
  autoDetectThreads: true
};

const app = express();
const PORT = 3000;

// Middleware
const cors = require('cors');
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static('public'));

// Global variables
let modelPaths = [];
let availableModels = [];
let piperPath, ffmpegPath, ffprobePath;

// Default model paths
const onnxTtsPath = path.join(os.homedir(), 'Documents', 'onnx-tts');

// Initialize paths - handle both development and packaged app
function initializePaths() {
  const isPackaged = process.env.ELECTRON_IS_PACKAGED === 'true';
  
  if (isPackaged) {
    // In packaged app, resources are in process.resourcesPath
    const resourcesPath = process.resourcesPath;
    piperPath = path.join(resourcesPath, 'piper', 'piper.exe');
    ffmpegPath = path.join(resourcesPath, 'ffmpeg.exe');
    ffprobePath = path.join(resourcesPath, 'ffprobe.exe');
  } else {
    // In development, use current directory
    piperPath = path.join(__dirname, 'piper', 'piper.exe');
    ffmpegPath = path.join(__dirname, 'ffmpeg.exe');
    ffprobePath = path.join(__dirname, 'ffprobe.exe');
  }
  
  console.log(`[PATHS] Packaged: ${isPackaged}`);
  console.log(`[PATHS] Piper: ${piperPath}`);
  console.log(`[PATHS] FFmpeg: ${ffmpegPath}`);
  console.log(`[PATHS] FFprobe: ${ffprobePath}`);
}

// Initialize paths on startup
try {
  initializePaths();
} catch (error) {
  // Fallback to development paths if electron is not available
  piperPath = path.join(__dirname, 'piper', 'piper.exe');
  ffmpegPath = path.join(__dirname, 'ffmpeg.exe');
  ffprobePath = path.join(__dirname, 'ffprobe.exe');
}

// Initialize model paths
modelPaths = [onnxTtsPath];
console.log('Initialized model paths:', modelPaths);

// Scan models from specified directories
async function scanModels() {
  availableModels = [];
  
  for (const modelPath of modelPaths) {
    try {
      if (await fs.pathExists(modelPath)) {
        const files = await fs.readdir(modelPath);
        
        for (const file of files) {
          if (file.endsWith('.onnx.json')) {
            const jsonPath = path.join(modelPath, file);
            const onnxPath = path.join(modelPath, file.replace('.onnx.json', '.onnx'));
            
            // Check if corresponding .onnx file exists
            if (await fs.pathExists(onnxPath)) {
              try {
                const modelData = await fs.readJson(jsonPath);
                const modelcard = modelData.modelcard || {};
                
                // Get model-specific replacements, convert to tuples if needed
                let modelReplacements = modelcard.replacements || [['\n', ' . '], ['*', ''], [')', ',']];
                if (modelReplacements.length > 0 && Array.isArray(modelReplacements[0])) {
                  // Already in correct format
                } else if (modelReplacements.length > 0 && typeof modelReplacements[0] === 'object') {
                  // Convert objects to arrays
                  modelReplacements = modelReplacements.map(item => [item[0], item[1]]);
                }
                
                // Extract and process base64 image if it exists
                let imageBase64 = null;
                if (modelcard.image) {
                  try {
                    let imageData = modelcard.image;
                    let imgFormat = 'png'; // default format
                    
                    // Extract image format and data from base64 string
                    if (imageData.includes('base64,')) {
                      const [header, data] = imageData.split('base64,', 2);
                      imgFormat = header.split('/')[1]?.split(';')[0] || 'png';
                      imageData = data;
                    }
                    
                    // Validate base64 data
                    if (imageData && /^[A-Za-z0-9+/]*={0,2}$/.test(imageData)) {
                      imageBase64 = imageData;
                      console.log(`Extracted base64 image for model: ${modelcard.id || file.replace('.onnx.json', '')} (${imgFormat})`);
                    }
                  } catch (error) {
                    console.error(`Error processing image for model ${modelcard.id || file.replace('.onnx.json', '')}:`, error);
                  }
                }
                
                const model = {
                  id: modelcard.id || file.replace('.onnx.json', ''),
                  name: modelcard.name || file.replace('.onnx.json', ''),
                  description: modelcard.description || 'No description available',
                  language: modelcard.language || 'Unknown',
                  voiceprompt: modelcard.voiceprompt || 'Not available',
                  jsonPath: jsonPath,
                  onnxPath: onnxPath,
                  image: imageBase64,
                  replacements: modelReplacements,
                  source: modelPath
                };
                
                availableModels.push(model);
                console.log(`Found model: ${model.name} (${model.id})`);
              } catch (error) {
                console.error(`Error reading model ${file}:`, error);
              }
            }
          }
        }
      } else {
        console.log(`Model path does not exist: ${modelPath}`);
      }
    } catch (error) {
      console.error(`Error scanning path ${modelPath}:`, error);
    }
  }
  
  console.log(`Total models found: ${availableModels.length}`);
}

// Generate random string for temporary files
function generateRandomString(length = 8) {
  return crypto.randomBytes(length).toString('hex');
}

// Apply text replacements with proper word boundary handling
function applyReplacements(text, replacements) {
  if (!text || !replacements || replacements.length === 0) {
    return text;
  }
  
  console.log(`[REPLACEMENTS] Starting text: '${text.substring(0, 100)}${text.length > 100 ? '...' : ''}'`);
  const originalText = text;
  let processedText = text;
  
  for (const [find, replace] of replacements) {
    if (!find) continue; // Skip empty find strings
    
    const beforeCount = (processedText.match(new RegExp(find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
    
    // Special handling for abbreviations ending with period
    if (find.endsWith('.')) {
      const pattern = new RegExp(`\\b${find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'gi');
      processedText = processedText.replace(pattern, replace);
    }
    // Multi-word phrases
    else if (find.includes(' ')) {
      const pattern = new RegExp(`\\b${find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
      processedText = processedText.replace(pattern, replace);
    }
    // Single words/numbers
    else {
      if (/^\d+$/.test(find)) {
        // Don't replace if number is part of larger number, decimal, or comma-separated
        // BUT allow replacement when followed by period (enumeration context)
        const pattern = new RegExp(`\\b${find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![0-9,]|\\.(?!\\s))`, 'gi');
        processedText = processedText.replace(pattern, replace);
      } else {
        // Standard word boundaries for non-numeric replacements
        const pattern = new RegExp(`\\b${find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
        processedText = processedText.replace(pattern, replace);
      }
    }
    
    const afterCount = (processedText.match(new RegExp(find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
    const replacementsMade = beforeCount - afterCount;
    
    if (replacementsMade > 0) {
      console.log(`[REPLACEMENTS] '${find}' → '${replace}' (${replacementsMade} replacements)`);
    }
  }
  
  if (processedText !== originalText) {
    console.log(`[REPLACEMENTS] Final text: '${processedText.substring(0, 100)}${processedText.length > 100 ? '...' : ''}'`);
  } else {
    console.log('[REPLACEMENTS] No changes made to text');
  }
  
  return processedText;
}

// Filter code blocks
function filterCodeBlocks(text) {
  return text.replace(/```[^`\n]*\n.*?```/gs, '');
}

// Process line breaks - Fixed to preserve text integrity
function processLineBreaks(text) {
  console.log(`[LINE_BREAKS] Original text: "${text.substring(0, 200)}${text.length > 200 ? '...' : ''}"`);
  
  // Don't split by lines aggressively - preserve the original text structure
  // Only handle obvious paragraph breaks
  let processedText = text;
  
  // Handle paragraph breaks (double line breaks) - these become sentence breaks
  processedText = processedText.replace(/\n\s*\n/g, '. ');
  
  // Handle single line breaks more carefully - they become spaces unless at end of sentence
  processedText = processedText.replace(/([.!?¿¡…])\s*\n/g, '$1 '); // Punctuation + line break = punctuation + space
  processedText = processedText.replace(/([^.!?¿¡…])\s*\n\s*([A-ZÁÉÍÓÚÑÜ])/g, '$1. $2'); // No punctuation + line break + capital = add period
  processedText = processedText.replace(/\n/g, ' '); // Remaining line breaks become spaces
  
  // Clean up spacing
  processedText = processedText.replace(/\s+/g, ' ').trim();
  
  // Handle special cases for better speech flow
  processedText = processedText.replace(/([a-zA-Z])\s*:\s*/g, '$1: '); // Normalize colons
  
  // Clean up multiple periods but be careful not to break ellipsis
  processedText = processedText.replace(/\.{4,}/g, '...'); // 4+ periods become ellipsis
  processedText = processedText.replace(/\.{2}(?!\.)/g, '.'); // Double periods become single (preserve ellipsis)
  
  console.log(`[LINE_BREAKS] Final processed text: "${processedText.substring(0, 200)}${processedText.length > 200 ? '...' : ''}"`);
  
  return processedText;
}

// Advanced sentence splitting with natural speech pattern handling - Enhanced for punctuation pairs
function splitSentences(text) {
  if (!text || !text.trim()) {
    return [];
  }
  
  console.log(`[SPLIT] Original text: "${text}"`);
  
  // Common abbreviations in multiple languages
  const abbreviations = [
    'Sr', 'Sra', 'Srta', 'Dr', 'Dra', 'Prof', 'Profa', 'Lic', 'Licda', 
    'Ing', 'Inga', 'Arq', 'Arqa', 'Mtro', 'Mtra', 'etc', 'vs', 'p.ej', 
    'i.e', 'cf', 'vol', 'cap', 'art', 'núm', 'pág', 'ed', 'op.cit',
    'Mr', 'Mrs', 'Ms', 'Miss', 'Inc', 'Ltd', 'Corp', 'Co', 'e.g'
  ];
  
  // Step 1: Normalize and fix incomplete punctuation patterns
  let normalizedText = normalizeTextForTTS(text);
  
  // Step 2: Protect abbreviations by temporarily replacing them
  let protectedText = normalizedText;
  const protectionMap = new Map();
  let protectionCounter = 0;
  
  for (const abbrev of abbreviations) {
    const regex = new RegExp(`\\b${abbrev.replace('.', '\\.')}\\b`, 'gi');
    protectedText = protectedText.replace(regex, (match) => {
      const placeholder = `__ABBREV_${protectionCounter}__`;
      protectionMap.set(placeholder, match);
      protectionCounter++;
      return placeholder;
    });
  }
  
  // Step 3: Improved sentence splitting using regex patterns
  const sentences = [];
  
  // Use a more reliable regex-based approach for sentence splitting
  // This pattern looks for sentence endings followed by whitespace and capital letters or sentence starters
  const sentencePattern = /([.!?]+)\s+(?=[A-ZÁÉÍÓÚÑÜ¡¿]|$)/g;
  
  let lastIndex = 0;
  let match;
  
  while ((match = sentencePattern.exec(protectedText)) !== null) {
    const sentenceEnd = match.index + match[1].length;
    const sentence = protectedText.substring(lastIndex, sentenceEnd).trim();
    
    if (sentence.length > 0) {
      sentences.push(sentence);
      console.log(`[SPLIT] Extracted sentence: "${sentence}"`);
    }
    
    lastIndex = sentenceEnd;
  }
  
  // Add any remaining text as the last sentence
  if (lastIndex < protectedText.length) {
    const remainingSentence = protectedText.substring(lastIndex).trim();
    if (remainingSentence.length > 0) {
      sentences.push(remainingSentence);
      console.log(`[SPLIT] Extracted final sentence: "${remainingSentence}"`);
    }
  }
  
  // If no sentences were found using regex, split by major punctuation as fallback
  if (sentences.length === 0) {
    const fallbackSentences = protectedText.split(/(?<=[.!?])\s+(?=[A-ZÁÉÍÓÚÑÜ¡¿])/);
    sentences.push(...fallbackSentences.filter(s => s.trim().length > 0));
    console.log(`[SPLIT] Used fallback splitting, found ${sentences.length} sentences`);
  }
  
  // Step 4: Process and clean sentences
  const processedSentences = [];
  for (let sentence of sentences) {
    // Restore abbreviations
    for (const [placeholder, original] of protectionMap) {
      sentence = sentence.replace(new RegExp(placeholder, 'g'), original);
    }
    
    // Clean and enhance sentence for TTS
    sentence = enhanceSentenceForTTS(sentence);
    
    if (sentence && sentence.length > 3) {
      // Handle very long sentences by splitting at natural pauses
      if (sentence.length > 400) {
        const chunks = splitLongSentence(sentence);
        processedSentences.push(...chunks);
      } else {
        processedSentences.push(sentence);
      }
    }
  }
  
  // Step 5: Merge very short fragments with adjacent sentences
  const finalSentences = mergeShortFragments(processedSentences);
  
  // Log the divided text
  if (finalSentences.length > 0) {
    console.log(`[SPLIT] Text divided into ${finalSentences.length} segments:`);
    finalSentences.forEach((sentence, i) => {
      console.log(`[SPLIT] ${i + 1}: "${sentence}"`);
    });
  }
  
  return finalSentences;
}

// Helper function to determine if a punctuation mark is a natural sentence boundary
function isNaturalSentenceBoundary(text, position) {
  const nextChar = text[position + 1];
  const nextTwoChars = text.substring(position + 1, position + 3);
  
  // End of text is always a boundary
  if (position >= text.length - 1) {
    return true;
  }
  
  // Skip whitespace to find next meaningful character
  let nextMeaningfulPos = position + 1;
  while (nextMeaningfulPos < text.length && /\s/.test(text[nextMeaningfulPos])) {
    nextMeaningfulPos++;
  }
  
  if (nextMeaningfulPos >= text.length) {
    return true;
  }
  
  const nextMeaningfulChar = text[nextMeaningfulPos];
  const nextMeaningfulTwoChars = text.substring(nextMeaningfulPos, nextMeaningfulPos + 2);
  
  // Check for uppercase letter or sentence starters
  if (/[A-ZÁÉÍÓÚÑÜ¡¿]/.test(nextMeaningfulChar)) {
    return true;
  }
  
  // Check for common sentence starters
  if (/^(El|La|Los|Las|Un|Una|Este|Esta|Estos|Estas|Pero|Sin|Con|Por|Para|Cuando|Donde|Como|Que|Si|No|Y|O|Entonces|Así|Ahora|Luego|Después|Antes|Mientras|Aunque|Porque|Ya|Dado|Puesto)\s/i.test(text.substring(nextMeaningfulPos))) {
    return true;
  }
  
  return false;
}

// Helper function to check if a period is part of an abbreviation or number
function isAbbreviationOrNumber(text, position) {
  const beforeChar = text[position - 1];
  const afterChar = text[position + 1];
  
  // Check for decimal numbers
  if (/\d/.test(beforeChar) && /\d/.test(afterChar)) {
    return true;
  }
  
  // Check for common abbreviation patterns
  const beforeTwoChars = text.substring(position - 2, position);
  if (/^[A-Z][a-z]$/.test(beforeTwoChars) || /^[A-Z]{2}$/.test(beforeTwoChars)) {
    return true;
  }
  
  return false;
}

// Normalize text for better TTS output - Fixed for proper text handling
function normalizeTextForTTS(text) {
  console.log(`[NORMALIZE] Starting normalization: "${text.substring(0, 100)}${text.length > 100 ? '...' : ''}"`);
  
  let normalized = text;
  
  // First, preserve the original structure and fix basic issues
  // Handle line breaks more carefully - preserve paragraph structure
  normalized = normalized.replace(/\n\s*\n/g, '. '); // Double line breaks become sentence breaks
  normalized = normalized.replace(/\n/g, ' '); // Single line breaks become spaces, not periods
  
  // Remove special characters that piper.exe doesn't handle well
  normalized = normalized.replace(/[""'']/g, '"'); // Normalize quotes
  normalized = normalized.replace(/[–—]/g, '-'); // Normalize dashes
  normalized = normalized.replace(/[…]/g, '...'); // Normalize ellipsis
  
  // Fix malformed punctuation combinations - CRITICAL FIX
  normalized = normalized.replace(/¿¡/g, '¿'); // Remove duplicate opening punctuation
  normalized = normalized.replace(/¡¿/g, '¡'); // Remove duplicate opening punctuation
  normalized = normalized.replace(/\?!/g, '?'); // Remove duplicate closing punctuation
  normalized = normalized.replace(/!\?/g, '!'); // Remove duplicate closing punctuation
  
  // Ensure proper question format
  normalized = normalized.replace(/¿([^?]*?)\?/g, (match, content) => {
    return `¿${content.trim()}?`;
  });
  
  // Ensure proper exclamation format
  normalized = normalized.replace(/¡([^!]*?)!/g, (match, content) => {
    return `¡${content.trim()}!`;
  });
  
  // Fix incomplete question patterns - but be more careful
  normalized = normalized.replace(/¿\s*([^?]*?)(?:\s*[.])(?!\?)/g, '¿$1?');
  
  // Fix incomplete exclamation patterns - but be more careful
  normalized = normalized.replace(/¡\s*([^!]*?)(?:\s*[.])(?!\!)/g, '¡$1!');
  
  // Fix sentences ending with colon that should end with period
  normalized = normalized.replace(/:\s*$/g, '.');
  normalized = normalized.replace(/:\s*(?=[A-ZÁÉÍÓÚÑÜ])/g, '. ');
  
  // Clean up spacing issues
  normalized = normalized.replace(/\s+([.!?¿¡,;:])/g, '$1');
  normalized = normalized.replace(/([.!?])\s*([¿¡])/g, '$1 $2');
  
  // Ensure proper spacing after punctuation
  normalized = normalized.replace(/([.!?])\s*(?=[A-ZÁÉÍÓÚÑÜ])/g, '$1 ');
  normalized = normalized.replace(/([,:;])\s*(?=[A-ZÁÉÍÓÚÑÜ])/g, '$1 ');
  
  // Clean up multiple periods but preserve ellipsis
  normalized = normalized.replace(/\.{4,}/g, '...'); // More than 3 dots become ellipsis
  normalized = normalized.replace(/\.{2}(?!\.)/g, '.'); // Double dots become single (but preserve ellipsis)
  
  // Remove duplicate punctuation
  normalized = normalized.replace(/([!?]){2,}/g, '$1');
  
  // Normalize whitespace
  normalized = normalized.replace(/\s+/g, ' ').trim();
  
  console.log(`[NORMALIZE] Final result: "${normalized.substring(0, 100)}${normalized.length > 100 ? '...' : ''}"`);
  return normalized;
}

// Enhance individual sentence for natural TTS - Fixed to preserve text integrity
function enhanceSentenceForTTS(sentence) {
  let enhanced = sentence.replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim();
  
  // Don't modify sentences that already have proper punctuation
  if (!enhanced) return enhanced;
  
  // Check if sentence already has proper ending punctuation
  const hasEndingPunctuation = /[.!?…]$/.test(enhanced);
  
  // Only add punctuation if missing
  if (!hasEndingPunctuation) {
    // Add appropriate ending based on content
    if (/^¿/.test(enhanced) || /\b(qué|quién|cuándo|dónde|cómo|por qué|cuál)\b/i.test(enhanced)) {
      enhanced += '?';
    } else if (/^¡/.test(enhanced) || /\b(wow|increíble|excelente|fantástico)\b/i.test(enhanced)) {
      enhanced += '!';
    } else {
      enhanced += '.';
    }
  }
  
  // Only add opening punctuation if missing and ending punctuation suggests it
  if (/\?$/.test(enhanced) && !/^¿/.test(enhanced) && !/\b(yes|no|si|sí)\b/i.test(enhanced)) {
    enhanced = '¿' + enhanced;
  }
  if (/!$/.test(enhanced) && !/^¡/.test(enhanced) && /\b(wow|increíble|excelente|fantástico|bravo|genial)\b/i.test(enhanced)) {
    enhanced = '¡' + enhanced;
  }
  
  return enhanced;
}

// Split very long sentences at natural pause points
function splitLongSentence(sentence) {
  const chunks = [];
  const naturalBreaks = /([,:;]\s+(?:pero|sin embargo|además|por tanto|por lo tanto|no obstante|mientras|cuando|donde|como|que|si|aunque|porque|ya que|dado que|puesto que))/gi;
  
  const parts = sentence.split(naturalBreaks);
  let currentChunk = '';
  
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    
    if (naturalBreaks.test(part)) {
      currentChunk += part;
      continue;
    }
    
    if (currentChunk && (currentChunk + part).length > 200) {
      if (currentChunk.trim()) {
        chunks.push(enhanceSentenceForTTS(currentChunk.trim()));
      }
      currentChunk = part;
    } else {
      currentChunk += part;
    }
  }
  
  if (currentChunk.trim()) {
    chunks.push(enhanceSentenceForTTS(currentChunk.trim()));
  }
  
  return chunks.length > 0 ? chunks : [sentence];
}

// Merge short fragments with adjacent sentences for better flow
function mergeShortFragments(sentences) {
  const merged = [];
  
  for (let i = 0; i < sentences.length; i++) {
    const sentence = sentences[i];
    const wordCount = (sentence.match(/\b\w+\b/g) || []).length;
    
    // If sentence is very short (less than 4 words), try to merge
    if (wordCount < 4 && sentence.length < 30) {
      if (merged.length > 0) {
        // Merge with previous sentence
        merged[merged.length - 1] += ' ' + sentence;
      } else if (i + 1 < sentences.length) {
        // Merge with next sentence
        const nextSentence = sentences[i + 1];
        merged.push(sentence + ' ' + nextSentence);
        i++; // Skip next sentence since we merged it
      } else {
        // Keep as is if no merge possible
        merged.push(sentence);
      }
    } else {
      merged.push(sentence);
    }
  }
  
  return merged;
}

// Filter text segment with comprehensive processing
function filterTextSegment(textSegment, modelReplacements) {
  console.log(`[FILTER] Processing segment: '${textSegment.substring(0, 100)}${textSegment.length > 100 ? '...' : ''}'`);
  
  // Step 1: Remove code blocks
  let text = filterCodeBlocks(textSegment);
  console.log(`[FILTER] After code block removal: '${text.substring(0, 100)}${text.length > 100 ? '...' : ''}'`);
  
  // Step 2: Process line breaks
  text = processLineBreaks(text);
  console.log(`[FILTER] After line break processing: '${text.substring(0, 100)}${text.length > 100 ? '...' : ''}'`);
  
  // Step 3: Apply replacements - only use model-specific replacements from .onnx.json
  if (modelReplacements && modelReplacements.length > 0) {
    console.log(`[FILTER] Using ${modelReplacements.length} model-specific replacements from .onnx.json`);
    text = applyReplacements(text, modelReplacements);
  } else {
    console.log('[FILTER] No model replacements found in .onnx.json - no replacements applied');
  }
  
  // Step 4: Final cleanup
  text = text.replace(/\s+/g, ' ').trim(); // Normalize whitespace
  
  console.log(`[FILTER] Final processed text: '${text.substring(0, 100)}${text.length > 100 ? '...' : ''}'`);
  return text;
}

// Generate audio using Piper (single process)
async function generateAudio(text, modelPath, settings = {}) {
  return new Promise((resolve, reject) => {
    const outputFile = path.join(os.tmpdir(), `tts_${generateRandomString()}.wav`);
    
    const args = [
      '-m', modelPath,
      '-f', outputFile,
      '--speaker', String(settings.speaker || 0),
      '--noise-scale', String(settings.noise_scale || 0.667),
      '--length-scale', String(settings.length_scale || 1.0),
      '--noise-w', String(settings.noise_w || 0.8)
    ];
    
    console.log('Piper command:', piperPath, args.join(' '));
    console.log('Input text:', text);
    
    const piperProcess = spawn(piperPath, args, {
      stdio: ['pipe', 'pipe', 'pipe']
    });
    
    let stderr = '';
    
    piperProcess.stderr.on('data', (data) => {
      stderr += data.toString();
    });
    
    piperProcess.on('close', (code) => {
      if (code === 0) {
        resolve(outputFile);
      } else {
        reject(new Error(`Piper failed with code ${code}: ${stderr}`));
      }
    });
    
    piperProcess.on('error', (error) => {
      reject(error);
    });
    
    // Send text to piper
    piperProcess.stdin.write(text);
    piperProcess.stdin.end();
  });
}

// Process multiple sentences using the queue system
async function generateAudioParallel(sentences, modelPath, settings = {}) {
  const queueStatus = processQueue.getStatus();
  console.log(`[PARALLEL] Processing ${sentences.length} sentences with max ${queueStatus.maxConcurrent} concurrent processes`);
  console.log(`[PARALLEL] Queue status - Running: ${queueStatus.running}, Queued: ${queueStatus.queued}`);
  
  // Function to create a queued task for a single sentence
  const createSentenceTask = (sentence, index) => {
    return () => {
      console.log(`[PARALLEL] Starting sentence ${index + 1}/${sentences.length}: "${sentence.substring(0, 50)}..."`);
      return generateAudio(sentence, modelPath, settings)
        .then(audioFile => {
          console.log(`[PARALLEL] Completed sentence ${index + 1}/${sentences.length}`);
          return { index, audioFile, sentence };
        })
        .catch(error => {
          console.error(`[PARALLEL] Error processing sentence ${index + 1}: ${error.message}`);
          throw error;
        });
    };
  };
  
  // Create and queue all sentence tasks
  const taskPromises = sentences.map((sentence, index) => {
    const task = createSentenceTask(sentence, index);
    return processQueue.add(task);
  });
  
  // Wait for all tasks to complete
  const results = await Promise.all(taskPromises);
  
  // Sort results by original index to maintain order
  results.sort((a, b) => a.index - b.index);
  
  console.log(`[PARALLEL] All ${sentences.length} sentences processed successfully`);
  return results.map(r => r.audioFile);
}

// Convert WAV to MP3 using FFmpeg
async function convertToMp3(wavPath) {
  return new Promise((resolve, reject) => {
    const mp3Path = wavPath.replace('.wav', '.mp3');
    
    const args = [
      '-i', wavPath,
      '-codec:a', 'libmp3lame',
      '-qscale:a', '2',
      '-y', mp3Path
    ];
    
    const ffmpegProcess = spawn(ffmpegPath, args, {
      stdio: ['pipe', 'pipe', 'pipe']
    });
    
    let stderr = '';
    
    ffmpegProcess.stderr.on('data', (data) => {
      stderr += data.toString();
    });
    
    ffmpegProcess.on('close', (code) => {
      if (code === 0 && fs.existsSync(mp3Path)) {
        // Clean up WAV file
        fs.unlink(wavPath).catch(console.error);
        resolve(mp3Path);
      } else {
        reject(new Error(`FFmpeg process failed with code ${code}. Stderr: ${stderr}`));
      }
    });
    
    ffmpegProcess.on('error', (error) => {
      reject(new Error(`Failed to start FFmpeg process: ${error.message}`));
    });
  });
}

// Concatenate multiple audio files
async function concatenateAudio(audioFiles, outputPath) {
  return new Promise((resolve, reject) => {
    const listFile = path.join(os.tmpdir(), `concat_${generateRandomString()}.txt`);
    
    // Create file list for FFmpeg
    const fileList = audioFiles.map(file => `file '${file.replace(/\\/g, '/')}'`).join('\n');
    fs.writeFileSync(listFile, fileList);
    
    const args = [
      '-f', 'concat',
      '-safe', '0',
      '-i', listFile,
      '-c', 'copy',
      '-y', outputPath
    ];
    
    const ffmpegProcess = spawn(ffmpegPath, args, {
      stdio: ['pipe', 'pipe', 'pipe']
    });
    
    let stderr = '';
    
    ffmpegProcess.stderr.on('data', (data) => {
      stderr += data.toString();
    });
    
    ffmpegProcess.on('close', (code) => {
      // Clean up
      fs.unlink(listFile).catch(console.error);
      audioFiles.forEach(file => fs.unlink(file).catch(console.error));
      
      if (code === 0 && fs.existsSync(outputPath)) {
        resolve(outputPath);
      } else {
        reject(new Error(`FFmpeg concatenation failed with code ${code}. Stderr: ${stderr}`));
      }
    });
    
    ffmpegProcess.on('error', (error) => {
      reject(new Error(`Failed to start FFmpeg process: ${error.message}`));
    });
  });
}

// Routes
app.get('/models', (req, res) => {
  res.json({
    success: true,
    models: availableModels,
    count: availableModels.length
  });
});

app.post('/set-model-paths', async (req, res) => {
  try {
    const { paths } = req.body;
    
    if (!Array.isArray(paths)) {
      return res.status(400).json({
        success: false,
        error: 'Paths must be an array'
      });
    }
    
    modelPaths = paths;
    await scanModels();
    
    res.json({
      success: true,
      message: 'Model paths updated',
      modelCount: availableModels.length
    });
  } catch (error) {
    console.error('Error setting model paths:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.post('/convert', async (req, res) => {
  try {
    const { text, modelPath, settings } = req.body;
    
    if (!text || !text.trim()) {
      return res.status(400).json({
        success: false,
        error: 'Text is required'
      });
    }
    
    if (!modelPath) {
      return res.status(400).json({
        success: false,
        error: 'Model path is required'
      });
    }
    
    // Find model by path
    const model = availableModels.find(m => m.onnxPath === modelPath);
    if (!model) {
      return res.status(404).json({
        success: false,
        error: 'Model not found'
      });
    }
    
    console.log(`Converting text with model: ${model.name}`);
    
    // Apply comprehensive text filtering and replacements
    let processedText = filterTextSegment(text, model.replacements);
    
    if (!processedText.trim()) {
      return res.status(400).json({
        success: false,
        error: 'Text became empty after processing'
      });
    }
    
    console.log(`[TTS] Text ready for synthesis: '${processedText}'`);
    
    // Split into sentences for better audio quality
    const sentences = splitSentences(processedText);
    console.log(`[TTS] Split into ${sentences.length} sentences`);
    
    if (sentences.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No valid sentences found in text'
      });
    }
    
    // Generate audio for all sentences in parallel
    const validSentences = sentences.filter(s => s.trim());
    const audioFiles = await generateAudioParallel(validSentences, modelPath, settings);
    
    if (audioFiles.length === 0) {
      return res.status(500).json({
        success: false,
        error: 'Failed to generate any audio'
      });
    }
    
    let finalAudioPath;
    
    if (audioFiles.length === 1) {
      finalAudioPath = audioFiles[0];
    } else {
      // Concatenate multiple audio files
      const concatenatedPath = path.join(os.tmpdir(), `final_${generateRandomString()}.wav`);
      finalAudioPath = await concatenateAudio(audioFiles, concatenatedPath);
    }
    
    // Convert to MP3
    const mp3Path = await convertToMp3(finalAudioPath);
    
    // Read the MP3 file and encode as base64
    const audioBuffer = await fs.readFile(mp3Path);
    const audioBase64 = audioBuffer.toString('base64');
    
    // Clean up temporary file
    fs.unlink(mp3Path).catch(console.error);
    
    res.json({
      success: true,
      audio: `data:audio/mpeg;base64,${audioBase64}`,
      model: model.name,
      sentenceCount: sentences.length
    });
    
  } catch (error) {
    console.error('Error in /convert:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.get('/rescan-models', async (req, res) => {
  try {
    await scanModels();
    res.json({
      success: true,
      message: 'Models rescanned',
      modelCount: availableModels.length
    });
  } catch (error) {
    console.error('Error rescanning models:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get current thread settings and queue status
app.get('/settings', (req, res) => {
  const queueStatus = processQueue.getStatus();
  res.json({
    success: true,
    settings: {
      maxThreads: userSettings.maxThreads,
      autoDetectThreads: userSettings.autoDetectThreads,
      cpuCores: CPU_CORES,
      currentMaxConcurrent: queueStatus.maxConcurrent,
      recommendedThreads: CPU_CORES * 2
    },
    queueStatus: queueStatus
  });
});

// Update thread settings
app.post('/settings', (req, res) => {
  try {
    const { maxThreads, autoDetectThreads } = req.body;
    
    if (typeof autoDetectThreads === 'boolean') {
      userSettings.autoDetectThreads = autoDetectThreads;
    }
    
    if (typeof maxThreads === 'number' && maxThreads > 0) {
      userSettings.maxThreads = Math.max(1, Math.min(32, maxThreads));
      
      if (!userSettings.autoDetectThreads) {
        processQueue.setMaxConcurrent(userSettings.maxThreads);
      }
    }
    
    // If auto-detect is enabled, use CPU-based calculation
    if (userSettings.autoDetectThreads) {
      const autoThreads = CPU_CORES * 2;
      processQueue.setMaxConcurrent(autoThreads);
      userSettings.maxThreads = autoThreads;
    }
    
    const queueStatus = processQueue.getStatus();
    
    res.json({
      success: true,
      message: 'Settings updated',
      settings: {
        maxThreads: userSettings.maxThreads,
        autoDetectThreads: userSettings.autoDetectThreads,
        cpuCores: CPU_CORES,
        currentMaxConcurrent: queueStatus.maxConcurrent
      },
      queueStatus: queueStatus
    });
    
  } catch (error) {
    console.error('Error updating settings:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get real-time queue status
app.get('/queue-status', (req, res) => {
  const queueStatus = processQueue.getStatus();
  res.json({
    success: true,
    status: queueStatus
  });
});

// Start server
async function startServer() {
  initializePaths();
  await scanModels();
  
  app.listen(PORT, () => {
    console.log(`TTS Server running on http://localhost:${PORT}`);
    console.log(`Found ${availableModels.length} models`);
    console.log(`Process queue initialized with ${processQueue.maxConcurrent} max concurrent processes`);
    console.log(`CPU cores detected: ${CPU_CORES}`);
  });
}

startServer().catch(console.error);
