/**
 * @fileoverview Gesture Detection Module for ArcGIS Velocity Simulator
 * This module handles real-time hand gesture recognition using TensorFlow.js and Fingerpose.
 * It defines custom gestures (thumbs up, pinky up, victory, open palm, closed fist) and
 * provides a detection loop that continuously analyzes webcam input for gesture patterns.
 */


// Global variables
let model = null;
let GE = null;
let video = null;
let animationFrameId = null;
let isDetecting = false; // Flag to control whether gesture detection is active.
let lastDetectedGesture = null; // Track the last gesture that was fired
let lastGestureScore = 0; // Track the score of the last gesture

/**
 * Creates and configures all gesture definitions using the fingerpose library.
 * Each gesture is defined by specifying finger positions (curl and direction).
 * @returns {Promise<GestureEstimator>} The configured gesture estimator with all defined gestures.
 */
async function createGestureEngine() {
  // Ensure fingerpose is available (loaded lazily)
  const { GestureDescription, Finger, FingerCurl, FingerDirection } = window.fp;
  // --- Gesture Definitions ---
  
  // Thumbs Up: Connect - ONLY thumb up, others down
  const thumbsUp = new GestureDescription('connect');
  thumbsUp.addCurl(Finger.Thumb, FingerCurl.NoCurl, 1.0); // Back to 1.0 for strictness
  thumbsUp.addDirection(Finger.Thumb, FingerDirection.VerticalUp, 1.0); // Back to 1.0 for strictness
  // Other fingers MUST be fully curled
  for (let finger of [Finger.Index, Finger.Middle, Finger.Ring, Finger.Pinky]) {
    thumbsUp.addCurl(finger, FingerCurl.FullCurl, 0.9); // Back to 0.9 for strictness
  }

  // Closed Fist: Play - a simple, closed fist.
  const closedFist = new GestureDescription('play');
  for (let finger of [Finger.Thumb, Finger.Index, Finger.Middle, Finger.Ring, Finger.Pinky]) {
    closedFist.addCurl(finger, FingerCurl.FullCurl, 0.9); // Back to 0.9 for strictness
  }
  // To make it distinct from 'connect' and 'disconnect', ensure the thumb isn't straight.
  closedFist.addCurl(Finger.Thumb, FingerCurl.NoCurl, 0.0, -1.0);

  // Pinky Up: Disconnect - a simple, distinct gesture.
  const pinkyUp = new GestureDescription('disconnect');
  // Pinky must be straight
  pinkyUp.addCurl(Finger.Pinky, FingerCurl.NoCurl, 1.0);
  // Other fingers must be curled
  for (let finger of [Finger.Thumb, Finger.Index, Finger.Middle, Finger.Ring]) {
    pinkyUp.addCurl(finger, FingerCurl.FullCurl, 0.9);
  }

  // Thumbs Down gesture is removed as it's unreliable.
  
  // Victory: Step - Index and middle fingers extended, others curled (peace sign)
  const victory = new GestureDescription('step');
  victory.addCurl(Finger.Index, FingerCurl.NoCurl, 1.0); // Index finger straight
  victory.addCurl(Finger.Middle, FingerCurl.NoCurl, 1.0); // Middle finger straight
  victory.addCurl(Finger.Ring, FingerCurl.FullCurl, 1.0); // Ring finger curled
  victory.addCurl(Finger.Pinky, FingerCurl.FullCurl, 1.0); // Pinky curled

  // Open Palm: Pause - All fingers extended (raised hand gesture)
  const openPalm = new GestureDescription('pause');
  for (let finger of [Finger.Thumb, Finger.Index, Finger.Middle, Finger.Ring, Finger.Pinky]) {
    openPalm.addCurl(finger, FingerCurl.NoCurl, 1.0); // All fingers straight
    openPalm.addDirection(finger, FingerDirection.VerticalUp, 0.7); // All fingers pointing up
  }

  // OK Sign gesture is removed.
  
  // Combine all gesture definitions - PUT MOST SPECIFIC FIRST
  const gestures = [
    victory,        // Very specific - 2 fingers up, 2 down
    openPalm,       // Very specific - all fingers up
    pinkyUp,        // Pinky up for disconnect
    thumbsUp,       // Re-enabled
    closedFist     // Re-enabled
  ];

  // Create and return the gesture estimator with more lenient scoring
  const GE = new window.fp.GestureEstimator(gestures);
  return GE;
}

/**
 * Initializes hand gesture detection using the camera feed.
 * Loads the handpose model, creates gesture engine, and starts the detection loop.
 * @param {HTMLVideoElement} video - The video element containing the camera feed.
 */
async function initGestureDetection(video) {
  // Load the TensorFlow.js handpose model for hand landmark detection
  const model = await window.handpose.load();
  
  // Create the gesture recognition engine with our custom gestures
  const GE = await createGestureEngine();

  // Start the detection process
  isDetecting = true;
  
  /**
   * Main gesture detection loop that runs continuously using requestAnimationFrame.
   * Analyzes each frame from the video feed for hand landmarks and gestures.
   */
  const estimate = async () => {
    if (!isDetecting || !video || video.videoWidth === 0 || video.videoHeight === 0) {
      return;
    }

    try {
      const predictions = await model.estimateHands(video, true);

      // Only proceed if we have actual hand detections
      if (predictions.length > 0) {
        // Validate the hand detection quality
        const hand = predictions[0];
        
        // Check if we have proper landmarks
        if (!hand.landmarks || hand.landmarks.length < 21) {
          return;
        }
        
        // Additional validation: check if landmarks look reasonable
        const landmarks = hand.landmarks;
        const wrist = landmarks[0];
        const fingertips = [landmarks[4], landmarks[8], landmarks[12], landmarks[16], landmarks[20]];
        
        // Check if fingertips are all at the same position (likely invalid)
        const samePosition = fingertips.every(tip => 
          Math.abs(tip.x - wrist.x) < 0.01 && Math.abs(tip.y - wrist.y) < 0.01
        );
        
        if (samePosition) {
          return; // Skip invalid hand poses
        }
        
        // Estimate gestures based on the detected hand landmarks
        const estimatedGestures = GE.estimate(hand.landmarks, 6.0); // Restored threshold
        
        if (estimatedGestures.gestures.length > 0) {
          // Get the best gesture regardless of confidence for real-time feedback
          const best = estimatedGestures.gestures.sort((a, b) => b.score - a.score)[0];
          
          // Always dispatch real-time gesture event (for immediate feedback)
          const realtimeEvent = new CustomEvent('gesture-realtime', { 
            detail: { 
              name: best.name, 
              score: best.score,
              isConfident: best.score > 5.0
            } 
          });
          document.dispatchEvent(realtimeEvent);
          
          // Only dispatch confirmed gesture event if confidence is high enough AND it's a new gesture
          if (best.score > 5.0) {
            // Check if this is a different gesture than the last one detected
            if (lastDetectedGesture !== best.name) {
              // Fire the gesture event
              const event = new CustomEvent('gesture-detected', { 
                detail: { 
                  name: best.name, 
                  score: best.score 
                } 
              });
              document.dispatchEvent(event);
              
              // Update the last detected gesture
              lastDetectedGesture = best.name;
              lastGestureScore = best.score;
            }
          }
        } else {
          // No gestures detected but hand is present - clear last gesture
          if (lastDetectedGesture !== null) {
            lastDetectedGesture = null;
            lastGestureScore = 0;
          }
        }
      } else {
        // No hands detected - clear last gesture and display
        if (lastDetectedGesture !== null) {
          lastDetectedGesture = null;
          lastGestureScore = 0;
        }
        
        // Clear any existing gesture display
        const clearEvent = new CustomEvent('gesture-realtime', { 
          detail: { 
            name: null, 
            score: 0,
            isConfident: false
          } 
        });
        document.dispatchEvent(clearEvent);
      }
    } catch (error) {
      console.error('Error during gesture estimation:', error);
    }
    
    // Continue the detection loop if still active
    if (isDetecting) {
      animationFrameId = requestAnimationFrame(estimate);
    }
  };

  // Start the detection loop
  estimate();

  /**
   * Stops gesture detection and cleans up resources.
   */
  const stopDetection = () => {
    if (isDetecting) {
      isDetecting = false;
      if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
      }
      // Clear gesture state when stopping detection
      lastDetectedGesture = null;
      lastGestureScore = 0;
    }
  };
}

/**
 * Stops gesture detection and cleans up the animation frame.
 * Call this when the camera is turned off or the component is unmounted.
 */
function stopGestureDetection() {
  isDetecting = false;
  if (animationFrameId) {
    cancelAnimationFrame(animationFrameId);
    animationFrameId = null;
  }
}

// --- Global Exports ---
// Expose functions to the global window object for use in other scripts
window.initGestureDetection = initGestureDetection;
window.stopGestureDetection = stopGestureDetection;
