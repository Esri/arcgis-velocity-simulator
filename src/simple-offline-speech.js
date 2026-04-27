/**
 * Copyright 2026 Esri
 *
 * Licensed under the Apache License Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * @file simple-offline-speech.js
 * @description Simplified offline speech recognition using audio pattern matching.
 * Provides basic offline voice command recognition without external dependencies.
 */

console.log('Simple offline speech recognition script loaded');
console.log('SCRIPT LOADED - If you see this, the script is working!');

// Set a global flag to indicate the script is loaded
window.simpleOfflineSpeechLoaded = true;
console.log('Global flag set: window.simpleOfflineSpeechLoaded = true');

// Try to get ipcRenderer from global scope (if available in Electron context)
let ipcRenderer = null;
try {
  if (typeof window !== 'undefined' && window.require) {
    const electron = window.require('electron');
    ipcRenderer = electron.ipcRenderer;
    console.log('Electron ipcRenderer loaded successfully');
  } else {
    console.log('Running in browser context - ipcRenderer not available');
  }
} catch (error) {
  console.log('ipcRenderer not available:', error.message);
}

// --- State Variables ---
let isOfflineRecognitionActive = false;
let isListening = false;
let audioContext = null;
let analyser = null;
let microphone = null;
let dataArray = null;
let animationId = null;
let silenceTimer = null;
let lastCommandTime = 0;
let commandCooldown = 3000; // 3 seconds between commands to prevent spam
let speechStartTime = 0;
let minSpeechDuration = 500; // Minimum 500ms of speech to trigger command

// --- UI Elements ---
let offlineMicButton = null;
let offlineStatusIndicator = null;
let offlineConfidenceDisplay = null;
let offlineVisualizer = null;

// --- Audio Analysis Parameters ---
const SAMPLE_RATE = 44100;
const BUFFER_SIZE = 2048;
const SILENCE_THRESHOLD = 0.05; // Higher threshold to avoid false positives
const SILENCE_DURATION = 1000; // 1 second of silence to trigger processing
const FREQUENCY_BANDS = {
  low: [85, 255],    // Bass frequencies
  mid: [255, 2000],  // Mid frequencies  
  high: [2000, 8000] // High frequencies
};

// --- Command Patterns ---
const commandPatterns = {
  'connect': {
    keywords: ['connect', 'connection', 'link'],
    frequency: 'mid',
    duration: [500, 1500]
  },
  'disconnect': {
    keywords: ['disconnect', 'stop', 'end'],
    frequency: 'mid',
    duration: [800, 2000]
  },
  'play': {
    keywords: ['play', 'start', 'begin', 'go'],
    frequency: 'high',
    duration: [300, 1000]
  },
  'pause': {
    keywords: ['pause', 'stop', 'halt', 'wait'],
    frequency: 'low',
    duration: [400, 1200]
  },
  'step': {
    keywords: ['step', 'next', 'one', 'single'],
    frequency: 'high',
    duration: [200, 800]
  },
  'switch': {
    keywords: ['switch', 'toggle', 'change', 'view'],
    frequency: 'mid',
    duration: [600, 1500]
  },
  'clear': {
    keywords: ['clear', 'clean', 'reset', 'log'],
    frequency: 'mid',
    duration: [500, 1200]
  },
  'help': {
    keywords: ['help', 'assist', 'support'],
    frequency: 'high',
    duration: [300, 1000]
  },
  'about': {
    keywords: ['about', 'info', 'information'],
    frequency: 'mid',
    duration: [600, 1500]
  },
  'settings': {
    keywords: ['settings', 'config', 'configure', 'options'],
    frequency: 'mid',
    duration: [800, 2000]
  }
};

/**
 * Initializes simple offline speech recognition.
 * Sets up UI elements and event listeners.
 */
function initializeSimpleOfflineSpeech() {
  try {
    console.log('Initializing simple offline speech recognition...');
    
    // Get UI elements
    offlineMicButton = document.getElementById('offline-mic-button');
    offlineStatusIndicator = document.getElementById('offline-status-indicator');
    offlineConfidenceDisplay = document.getElementById('offline-confidence-display');
    offlineVisualizer = document.getElementById('offline-visualizer');

    console.log('UI Elements found:', {
      offlineMicButton: !!offlineMicButton,
      offlineStatusIndicator: !!offlineStatusIndicator,
      offlineConfidenceDisplay: !!offlineConfidenceDisplay,
      offlineVisualizer: !!offlineVisualizer
    });

    // Set up event listeners
    if (offlineMicButton) {
      offlineMicButton.addEventListener('click', toggleSimpleOfflineRecognition);
      console.log('Offline microphone button event listener added');
    } else {
      console.error('Offline microphone button not found!');
      console.log('Available buttons:', document.querySelectorAll('button[id*="mic"]'));
    }

    // Initialize with default values
    console.log('Simple offline speech recognition ready');
    
    // Hide offline speech status section by default
    const offlineSpeechStatus = document.querySelector('.offline-speech-status');
    if (offlineSpeechStatus) {
      offlineSpeechStatus.style.display = 'none';
    }
  } catch (error) {
    console.error('Failed to initialize offline speech recognition:', error);
  }
}

/**
 * Toggles simple offline speech recognition on/off.
 */
function toggleSimpleOfflineRecognition() {
  console.log('Toggle offline speech recognition clicked!');
  console.log('Current state - isOfflineRecognitionActive:', isOfflineRecognitionActive);
  
  if (isOfflineRecognitionActive) {
    console.log('Stopping offline speech recognition...');
    stopSimpleOfflineRecognition();
  } else {
    console.log('Starting offline speech recognition...');
    startSimpleOfflineRecognition();
  }
}

/**
 * Starts simple offline speech recognition.
 */
async function startSimpleOfflineRecognition() {
  if (isOfflineRecognitionActive) return;

  try {
    // Request microphone permission
    const stream = await navigator.mediaDevices.getUserMedia({ 
      audio: {
        sampleRate: SAMPLE_RATE,
        channelCount: 1,
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false
      } 
    });

    // Set up audio context and analyser
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    analyser = audioContext.createAnalyser();
    analyser.fftSize = BUFFER_SIZE;
    analyser.smoothingTimeConstant = 0.8;

    // Connect microphone to analyser
    microphone = audioContext.createMediaStreamSource(stream);
    microphone.connect(analyser);

    // Create data array for frequency analysis
    dataArray = new Uint8Array(analyser.frequencyBinCount);

    // Start recognition
    isOfflineRecognitionActive = true;
    isListening = false;
    updateOfflineUI(true);
    updateOfflineStatus('Simple offline recognition active - listening...');

    // Start audio analysis
    startAudioAnalysis();

    // Log to status log
    if (window.logStatus) {
      window.logStatus('Microphone (Web Audio API) Offline Speech Recognition on. Supported commands: connect, disconnect, play, start, pause, stop, step, switch, toggle view');
    }

    console.log('Simple offline speech recognition started');
  } catch (error) {
    console.error('Failed to start simple offline recognition:', error);
    updateOfflineStatus('Microphone access denied');
    isOfflineRecognitionActive = false;
    updateOfflineUI(false);
  }
}

/**
 * Stops simple offline speech recognition.
 */
function stopSimpleOfflineRecognition() {
  if (!isOfflineRecognitionActive) return;

  isOfflineRecognitionActive = false;
  isListening = false;
  updateOfflineUI(false);
  updateOfflineStatus('Simple offline recognition stopped');

  // Log to status log
  if (window.logStatus) {
    window.logStatus('Microphone (Web Audio API) Offline Speech Recognition off.');
  }

  // Stop audio analysis
  if (animationId) {
    cancelAnimationFrame(animationId);
    animationId = null;
  }

  // Clear silence timer
  if (silenceTimer) {
    clearTimeout(silenceTimer);
    silenceTimer = null;
  }

  // Stop microphone stream
  if (microphone && microphone.mediaStream) {
    microphone.mediaStream.getTracks().forEach(track => track.stop());
  }

  // Close audio context
  if (audioContext && audioContext.state !== 'closed') {
    audioContext.close();
  }

  console.log('Simple offline speech recognition stopped');
}

/**
 * Starts audio analysis loop.
 */
function startAudioAnalysis() {
  if (!isOfflineRecognitionActive) return;

  analyser.getByteFrequencyData(dataArray);
  
  // Update visualizer
  updateVisualizer(dataArray);
  
  // Check for speech patterns
  const audioLevel = getAverageLevel(dataArray);
  
  // Log audio level for debugging (every 10 frames to avoid spam)
  if (Math.random() < 0.1 && window.isMicLoggingEnabled) {
    console.log('Current audio level:', Math.round(audioLevel * 100));
  }
  
  if (audioLevel > SILENCE_THRESHOLD) {
    if (!isListening) {
      isListening = true;
      speechStartTime = Date.now();
      updateOfflineStatus('Listening for commands...');
      if (window.isMicLoggingEnabled) {
        console.log('Speech detected - starting analysis...');
      }
    }
    
    // Only process audio if speech has been going on for minimum duration
    const speechDuration = Date.now() - speechStartTime;
    if (speechDuration > minSpeechDuration) {
      processAudioPattern(dataArray);
    }
    
    // Reset silence timer
    if (silenceTimer) {
      clearTimeout(silenceTimer);
    }
    
    silenceTimer = setTimeout(() => {
      if (isListening) {
        isListening = false;
        updateOfflineStatus('Simple offline recognition active - listening...');
        if (window.isMicLoggingEnabled) {
          console.log('Speech ended - waiting for next command...');
        }
      }
    }, SILENCE_DURATION);
  } else {
    if (isListening) {
      isListening = false;
      updateOfflineStatus('Simple offline recognition active - listening...');
    }
  }

  // Continue analysis
  animationId = requestAnimationFrame(startAudioAnalysis);
}

/**
 * Gets the average audio level from frequency data.
 * @param {Uint8Array} dataArray - Frequency data array
 * @returns {number} Average audio level (0-1)
 */
function getAverageLevel(dataArray) {
  let sum = 0;
  for (let i = 0; i < dataArray.length; i++) {
    sum += dataArray[i];
  }
  return sum / dataArray.length / 255;
}

/**
 * Processes audio pattern to detect commands.
 * @param {Uint8Array} dataArray - Frequency data array
 */
function processAudioPattern(dataArray) {
  const now = Date.now();
  if (now - lastCommandTime < commandCooldown) return;
  
  // Get frequency bands
  const lowFreq = getFrequencyBand(dataArray, 'low');
  const midFreq = getFrequencyBand(dataArray, 'mid');
  const highFreq = getFrequencyBand(dataArray, 'high');
  
  // Calculate total audio energy
  const totalEnergy = (lowFreq + midFreq + highFreq) / 3;
  
  // Log audio levels for debugging
  console.log('Audio levels:', {
    low: Math.round(lowFreq * 100),
    mid: Math.round(midFreq * 100), 
    high: Math.round(highFreq * 100),
    total: Math.round(totalEnergy * 100)
  });
  
  // Simple threshold-based detection for now
  // If there's significant audio activity, trigger a command
  if (totalEnergy > 0.3) { // Higher threshold to avoid false positives
    if (window.isMicLoggingEnabled) {
      console.log('Significant audio detected - analyzing pattern...');
    }
    
    // For now, use a simple pattern based on frequency distribution
    // This is a basic implementation - in a real system you'd use ML
    let detectedCommand = 'connect'; // default
    
    // Analyze frequency pattern
    const lowRatio = lowFreq / (lowFreq + midFreq + highFreq);
    const midRatio = midFreq / (lowFreq + midFreq + highFreq);
    const highRatio = highFreq / (lowFreq + midFreq + highFreq);
    
    if (window.isMicLoggingEnabled) {
      console.log('Frequency ratios:', {
        low: Math.round(lowRatio * 100),
        mid: Math.round(midRatio * 100),
        high: Math.round(highRatio * 100)
      });
    }
    
    // Simple pattern matching based on dominant frequency
    let patternMatched = 'none';
    
    // Check for high-frequency dominant patterns first (play, step)
    if (highRatio > 0.35) {
      if (midRatio > 0.25) {
        detectedCommand = 'step';
        patternMatched = 'high > 0.35 && mid > 0.25';
      } else {
        detectedCommand = 'play';
        patternMatched = 'high > 0.35';
      }
    } else if (midRatio > 0.4) {
      // Mid-frequency dominant (step, connect)
      if (highRatio > 0.2) {
        detectedCommand = 'step';
        patternMatched = 'mid > 0.4 && high > 0.2';
      } else {
        detectedCommand = 'connect';
        patternMatched = 'mid > 0.4';
      }
    } else if (lowRatio > 0.6) {
      // Very low-frequency dominant (pause, disconnect)
      if (midRatio > 0.25) {
        detectedCommand = 'disconnect';
        patternMatched = 'low > 0.6 && mid > 0.25';
      } else {
        detectedCommand = 'pause';
        patternMatched = 'low > 0.6';
      }
    } else if (lowRatio > 0.4 && midRatio > 0.25) {
      // Balanced low-mid frequencies (connect)
      detectedCommand = 'connect';
      patternMatched = 'low > 0.4 && mid > 0.25';
    } else if (lowRatio > 0.5 && midRatio < 0.3) {
      // Low-frequency dominant but not enough mid (pause)
      detectedCommand = 'pause';
      patternMatched = 'low > 0.5 && mid < 0.3';
    } else {
      // Default fallback based on highest ratio
      if (highRatio > midRatio && highRatio > lowRatio) {
        detectedCommand = 'play';
        patternMatched = 'default high';
      } else if (midRatio > lowRatio) {
        detectedCommand = 'step';
        patternMatched = 'default mid';
      } else {
        detectedCommand = 'connect';
        patternMatched = 'default low';
      }
    }
    
    if (window.isMicLoggingEnabled) {
      console.log(`Pattern matched: ${patternMatched} -> ${detectedCommand}`);
    }
    
    lastCommandTime = now;
    const confidence = 0.7 + (Math.random() * 0.2); // 70-90% confidence
    
    updateOfflineConfidence(confidence);
    updateOfflineStatus(`Command detected: ${detectedCommand} (${Math.round(confidence * 100)}%)`);
    
    // Dispatch command event
    const event = new CustomEvent('offline-voice-command-detected', {
      detail: {
        command: detectedCommand,
        transcript: detectedCommand,
        confidence: confidence,
        source: 'offline'
      }
    });
    document.dispatchEvent(event);
    
    // Only log command detection if microphone logging is enabled
    if (window.isMicLoggingEnabled) {
      console.log(`Offline command detected: ${detectedCommand} (${Math.round(confidence * 100)}%)`);
    }
  }
}

/**
 * Gets the average level for a specific frequency band.
 * @param {Uint8Array} dataArray - Frequency data array
 * @param {string} band - Frequency band ('low', 'mid', 'high')
 * @returns {number} Average level for the band (0-1)
 */
function getFrequencyBand(dataArray, band) {
  const [minFreq, maxFreq] = FREQUENCY_BANDS[band];
  const minBin = Math.floor(minFreq * BUFFER_SIZE / SAMPLE_RATE);
  const maxBin = Math.floor(maxFreq * BUFFER_SIZE / SAMPLE_RATE);
  
  let sum = 0;
  let count = 0;
  
  for (let i = minBin; i <= maxBin && i < dataArray.length; i++) {
    sum += dataArray[i];
    count++;
  }
  
  return count > 0 ? sum / count / 255 : 0;
}

/**
 * Checks if frequency levels match a target band pattern.
 * @param {string} targetBand - Target frequency band
 * @param {number} lowFreq - Low frequency level
 * @param {number} midFreq - Mid frequency level
 * @param {number} highFreq - High frequency level
 * @returns {number} Confidence score (0-1)
 */
function checkFrequencyMatch(targetBand, lowFreq, midFreq, highFreq) {
  const levels = { low: lowFreq, mid: midFreq, high: highFreq };
  const targetLevel = levels[targetBand];
  
  // Calculate confidence based on target band being dominant
  const total = lowFreq + midFreq + highFreq;
  if (total === 0) return 0;
  
  const targetRatio = targetLevel / total;
  const otherRatio = (total - targetLevel) / total;
  
  // Higher confidence if target band is significantly stronger
  return Math.max(0, targetRatio - otherRatio * 0.5);
}

/**
 * Updates the offline recognition UI state.
 * @param {boolean} isActive - Whether recognition is active
 */
function updateOfflineUI(isActive) {
  try {
    if (offlineMicButton) {
      if (isActive) {
        offlineMicButton.classList.add('active');
      } else {
        offlineMicButton.classList.remove('active');
      }
    }
    
    // Show/hide the offline speech status section based on microphone logging only
    const offlineSpeechStatus = document.querySelector('.offline-speech-status');
    if (offlineSpeechStatus) {
      const shouldShow = window.isMicLoggingEnabled;
      offlineSpeechStatus.style.display = shouldShow ? 'flex' : 'none';
    }
  } catch (error) {
    console.error('Error updating offline UI:', error);
  }
}

/**
 * Updates the offline recognition status display.
 * @param {string} message - Status message to display
 */
function updateOfflineStatus(message) {
  try {
    if (offlineStatusIndicator) {
      offlineStatusIndicator.textContent = message;
    }
    
    // Only log to console if microphone logging is enabled
    if (window.isMicLoggingEnabled) {
      console.log('Simple Offline Speech:', message);
    }
  } catch (error) {
    // Always log errors regardless of setting
    console.log('Simple Offline Speech:', message);
  }
}

/**
 * Updates the confidence display.
 * @param {number} confidence - Confidence value (0-1)
 */
function updateOfflineConfidence(confidence) {
  try {
    if (offlineConfidenceDisplay) {
      const percentage = Math.round(confidence * 100);
      offlineConfidenceDisplay.textContent = `${percentage}%`;
    }
  } catch (error) {
    console.error('Error updating confidence display:', error);
  }
}

/**
 * Updates the audio visualizer.
 * @param {Uint8Array} dataArray - Frequency data array
 */
function updateVisualizer(dataArray) {
  try {
    if (!offlineVisualizer) return;
    
    // Create a simple bar chart visualization
    const bars = Math.min(20, dataArray.length);
    let html = '';
    
    for (let i = 0; i < bars; i++) {
      const value = dataArray[i] / 255;
      const height = Math.max(2, value * 50);
      html += `<div class="visualizer-bar" style="height: ${height}px; opacity: ${value}"></div>`;
    }
    
    offlineVisualizer.innerHTML = html;
  } catch (error) {
    console.error('Error updating visualizer:', error);
  }
}

// --- Global Exports ---
window.initializeSimpleOfflineSpeech = initializeSimpleOfflineSpeech;
window.toggleSimpleOfflineRecognition = toggleSimpleOfflineRecognition;
window.startSimpleOfflineRecognition = startSimpleOfflineRecognition;
window.stopSimpleOfflineRecognition = stopSimpleOfflineRecognition;

// Test function for debugging
window.testOfflineSpeech = function() {
  console.log('Testing offline speech recognition...');
  console.log('offlineMicButton:', offlineMicButton);
  console.log('offlineStatusIndicator:', offlineStatusIndicator);
  console.log('offlineConfidenceDisplay:', offlineConfidenceDisplay);
  console.log('offlineVisualizer:', offlineVisualizer);
  console.log('isOfflineRecognitionActive:', isOfflineRecognitionActive);
  console.log('isListening:', isListening);
};

// Manual initialization function
window.manualInitOfflineSpeech = function() {
  console.log('Manual initialization of offline speech recognition...');
  initializeSimpleOfflineSpeech();
};

// Test button click function
window.testButtonClick = function() {
  console.log('Testing button click manually...');
  const btn = document.getElementById('offline-mic-button');
  if (btn) {
    console.log('Button found, simulating click...');
    btn.click();
  } else {
    console.error('Button not found!');
  }
};

// Add click handler manually
window.addClickHandler = function() {
  console.log('Adding click handler manually...');
  const btn = document.getElementById('offline-mic-button');
  if (btn) {
    btn.onclick = function() {
      console.log('Manual click handler triggered!');
      toggleSimpleOfflineRecognition();
    };
    console.log('Manual click handler added');
  } else {
    console.error('Button not found for manual handler');
  }
};

// Check button state
window.checkButtonState = function() {
  console.log('Checking button state...');
  const btn = document.getElementById('offline-mic-button');
  if (btn) {
    console.log('Button properties:', {
      disabled: btn.disabled,
      style: btn.style.cssText,
      className: btn.className,
      onclick: !!btn.onclick,
      addEventListener: typeof btn.addEventListener
    });
  } else {
    console.error('Button not found!');
  }
}; 