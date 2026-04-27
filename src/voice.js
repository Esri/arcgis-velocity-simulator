/**
 * @file voice.js
 * @description This script handles voice command recognition using the Web Speech API.
 * It listens for specific voice commands and dispatches custom events when recognized commands are detected.
 * Supports commands like "connect", "disconnect", "play", "pause", "step", and "switch views".
 */

// --- Speech Recognition Setup ---
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
if (SpeechRecognition) {
  console.log('✅ SpeechRecognition API is supported in this environment.');
} else {
  console.warn('❌ SpeechRecognition API is NOT supported in this environment.');
}

// --- State Variables ---
let recognition; // Holds the SpeechRecognition instance.
let isRunning = false; // Flag to track whether voice recognition is currently active.
let isStarting = false; // Flag to prevent multiple simultaneous start attempts
let microphoneStream = null; // Holds the microphone stream for proper cleanup.

// --- Command Mapping ---
// Maps spoken phrases to internal command names for consistency with gesture commands
const commandToAction = {
  'connect': 'connect',
  'disconnect': 'disconnect',
  'play': 'play',
  'start': 'play',
  'pause': 'pause',
  'stop': 'pause',
  'step': 'step',
  'switch': 'switch_views',
  'toggle view': 'switch_views'
};

/**
 * Initializes and starts continuous voice recognition.
 * Sets up event handlers for speech results, errors, and automatic restart on unexpected stops.
 */
async function startVoiceRecognition() {
  // Check if Speech Recognition API is supported in the current browser
  if (!SpeechRecognition) {
    console.error('Speech Recognition API not supported in this browser.');
    return;
  }

  // Prevent multiple simultaneous start attempts
  if (isStarting || isRunning) {
    console.log('Voice recognition is already starting or running.');
    return;
  }

  isStarting = true;

  try {
    // Request microphone permission explicitly before starting speech recognition
    // This prevents the blinking mic icon issue on macOS
    microphoneStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    console.log('Microphone permission granted.');
  } catch (error) {
    console.error('Microphone permission denied or not available:', error);
    // Dispatch an event to notify the UI that microphone access failed
    const errorEvent = new CustomEvent('microphone-permission-denied', { detail: error.message });
    document.dispatchEvent(errorEvent);
    isStarting = false;
    return;
  }

  // Create and configure the speech recognition instance
  recognition = new SpeechRecognition();
  recognition.continuous = true; // Keep listening continuously
  recognition.interimResults = false; // Only process final results, not interim ones
  recognition.lang = 'en-US'; // Set language to English (US)

  /**
   * Handles speech recognition results.
   * Processes the transcript and dispatches events for recognized commands.
   */
  recognition.onresult = (event) => {
    // Get the most recent result from the recognition event
    const last = event.results.length - 1;
    const transcript = event.results[last][0].transcript.trim().toLowerCase();

    // Check if the recognized speech matches any of our defined commands
    if (commandToAction[transcript]) {
      const command = commandToAction[transcript];
      
      // Dispatch a custom event with the recognized command
      const commandEvent = new CustomEvent('voice-command-detected', { detail: command });
      document.dispatchEvent(commandEvent);
    }
  };

  /**
   * Handles speech recognition errors.
   * Logs errors for debugging purposes and provides offline fallback.
   */
  recognition.onerror = (event) => {
    console.error('Speech recognition error:', event.error);
    
    // Handle specific error types
    switch (event.error) {
      case 'network':
        console.warn('Network error detected. Web Speech API requires internet connection.');
        console.info('Consider using the offline speech recognition button for local processing.');
        // Dispatch event to notify UI about network issue
        const networkErrorEvent = new CustomEvent('speech-network-error', { 
          detail: 'Web Speech API requires internet connection. Use offline recognition for local processing.' 
        });
        document.dispatchEvent(networkErrorEvent);
        break;
      case 'not-allowed':
        console.error('Microphone access denied by user.');
        break;
      case 'no-speech':
        console.warn('No speech detected.');
        break;
      case 'audio-capture':
        console.error('Audio capture error.');
        break;
      case 'service-not-allowed':
        console.error('Speech recognition service not allowed.');
        break;
      default:
        console.error('Unknown speech recognition error:', event.error);
    }
  };

  /**
   * Handles the end of speech recognition.
   * Automatically restarts recognition if it was supposed to be running.
   */
  recognition.onend = () => {
    if (isRunning && !isStarting) {
      // Only restart if we're supposed to be running and not in the process of starting
      try {
        recognition.start();
      } catch (error) {
        console.error('Failed to restart voice recognition:', error);
        isRunning = false;
      }
    }
  };

  // Start the recognition process
  isRunning = true;
  isStarting = false;
  try {
    recognition.start();
    console.log('Voice recognition started.');
  } catch (error) {
    console.error('Failed to start voice recognition:', error);
    isRunning = false;
    isStarting = false;
  }
}

/**
 * Stops voice recognition and cleans up the recognition instance.
 * Call this when the microphone is turned off or the component is unmounted.
 */
function stopVoiceRecognition() {
  isRunning = false;
  isStarting = false;
  if (recognition) {
    try {
      recognition.stop();
      console.log('Voice recognition stopped.');
    } catch (error) {
      console.error('Failed to stop voice recognition:', error);
    }
  }
  
  // Stop and cleanup the microphone stream to prevent blinking mic icon
  if (microphoneStream) {
    microphoneStream.getTracks().forEach(track => {
      track.stop();
      console.log('Microphone track stopped.');
    });
    microphoneStream = null;
  }
}

// --- Global Exports ---
// Expose functions to the global window object for use in other scripts
window.startVoiceRecognition = startVoiceRecognition;
window.stopVoiceRecognition = stopVoiceRecognition;
