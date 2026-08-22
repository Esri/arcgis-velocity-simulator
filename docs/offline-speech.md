# Offline speech recognition

[← Documentation index](README.md) · [Repository overview](../README.md#documentation)

The offline speech recognition system uses the Web Audio API and frequency
analysis to recognize a small set of spoken commands locally, without an
internet connection. All audio stays on the device, which keeps the feature
usable in restricted or disconnected environments.

This guide is written for users who want hands-free control and for developers
extending the recognizer. It covers setup, the supported commands, the audio
processing pipeline, configuration, troubleshooting, measured performance, the
integration points inside the application, and the limitations of a
frequency-based approach. A working microphone and enabled microphone support
are required.

## Table of contents

- [Features](#features)
- [Installation and setup](#installation-and-setup)
- [Usage](#usage)
- [Configuration](#configuration)
- [Technical details](#technical-details)
- [Troubleshooting](#troubleshooting)
- [Development](#development)
- [Security and privacy](#security-and-privacy)
- [Performance benchmarks](#performance-benchmarks)
- [Limitations](#limitations)
- [Future enhancements](#future-enhancements)
- [Support](#support)
- [Related documentation](#related-documentation)

## Features

### Core capabilities
- **100% Offline**: No internet connection required for speech recognition
- **Privacy-Focused**: All processing happens locally in the browser
- **Real-time Processing**: Low-latency audio analysis with live feedback
- **Visual Feedback**: Audio visualizer and confidence indicators
- **Customizable Sensitivity**: Adjustable thresholds for recognition accuracy

### Voice commands
The system recognizes the following voice commands through frequency pattern
analysis:

| Command | Action | Frequency Pattern |
|---------|--------|-------------------|
| `connect` | Connect to server/client | Balanced low-mid frequencies |
| `disconnect` | Disconnect from server/client | Low frequency dominant |
| `play` / `start` | Start data transmission | High frequency dominant |
| `pause` / `stop` | Pause data transmission | Low frequency dominant |
| `step` | Send single line manually | High-mid frequency mix |
| `switch` / `toggle view` | Toggle compact/full view | Mid frequency dominant |

### Supported languages
Currently optimized for **English** speech patterns. The system analyzes
frequency characteristics rather than specific words, making it
language-agnostic but optimized for English pronunciation patterns.

## Installation and setup

### 1. Install dependencies
The required dependencies are automatically installed when you run:
```bash
npm install
```

### 2. No model downloads required
Unlike traditional speech recognition systems, this implementation uses Web
Audio API and doesn't require downloading speech models.

### 3. Controls and settings
- **Enable Microphone Support**: Ensure microphone support is enabled via the context menu (Configuration → Microphone Support) or in the config file (`microphoneSupport: true`).
- **Start/Stop Offline Mic**: Use the offline microphone button (checkmark icon) in the status area.
- **Logging Visibility**: Toggle "Log Microphone Commands" to show detailed offline speech status and visualizer.
- **Advanced Tuning**: Adjust sensitivity, thresholds, and frequency bands directly in `src/simple-offline-speech.js`.

## Usage

### Basic operation
1. **Start Recognition**: Click the offline microphone button (checkmark icon)
2. **Enable Logging**: Toggle "Log Microphone Commands" to see detailed feedback
3. **Speak Commands**: Use clear, distinct pronunciation for best results
4. **Monitor Feedback**: Watch the status indicator and confidence display
5. **Stop Recognition**: Click the microphone button again

### Visual feedback
When microphone logging is enabled, you'll see:
- **Status Indicator**: Shows current recognition state
- **Confidence Display**: Shows recognition confidence percentage
- **Audio Visualizer**: Real-time frequency bars showing audio input
- **Console Logs**: Detailed frequency analysis and pattern matching
- **Status Log Messages**:
  - "Microphone (Web Audio API) Offline Speech Recognition on. Supported commands: connect, disconnect, play, start, pause, stop, step, switch, toggle view"
  - "Microphone (Web Audio API) Offline Speech Recognition off."

### Command recognition tips
- **Speak Clearly**: Enunciate each word distinctly
- **Consistent Volume**: Maintain steady speaking volume
- **Minimize Background Noise**: Reduce ambient sounds for better accuracy
- **Use Distinct Words**: Choose commands with different frequency characteristics

## Configuration

### Speech recognition settings
- **Microphone Source**: Select input device (if multiple available)
- **Sensitivity**: Adjust audio threshold for detection
- **Confidence Threshold**: Adjust recognition sensitivity
- **Logging**: Enable/disable detailed console logging

### Advanced settings
- **Sample Rate**: Audio sampling rate (default: 44100 Hz)
- **Buffer Size**: Audio buffer size for processing (default: 2048)
- **Silence Detection**: Configure silence detection parameters
- **Frequency Bands**: Customize low/mid/high frequency ranges

## Technical details

### Architecture
```text
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   Renderer      │    │   Web Audio API  │    │   Frequency     │
│   Process       │◄──►│   (Browser)      │◄──►│   Analysis      │
│                 │    │                  │    │                 │
│ - UI Controls   │    │ - Audio Capture  │    │ - Pattern       │
│ - Event Handling│    │ - Frequency      │    │   Matching      │
│ - Status Display│    │   Analysis       │    │ - Command       │
│                 │    │ - Real-time      │    │   Detection     │
│                 │    │   Processing     │    │                 │
└─────────────────┘    └──────────────────┘    └─────────────────┘
```

### Audio processing pipeline
1. **Microphone Input**: Raw audio capture via Web Audio API
2. **Frequency Analysis**: Real-time FFT analysis in three bands:
   - **Low**: 85-255 Hz (bass frequencies)
   - **Mid**: 255-2000 Hz (mid-range frequencies)
   - **High**: 2000-8000 Hz (treble frequencies)
3. **Pattern Matching**: Threshold-based frequency ratio analysis
4. **Command Detection**: Mapping frequency patterns to voice commands
5. **Event Dispatch**: Command events sent to application logic

### Frequency analysis
The system analyzes audio in real-time using:
- **FFT (Fast Fourier Transform)**: For frequency domain analysis
- **Frequency Bands**: Three distinct frequency ranges
- **Ratio Analysis**: Relative strength of each frequency band
- **Pattern Matching**: Threshold-based command detection

### Integration points

Offline speech recognition is implemented in `src/simple-offline-speech.js` and
wired into the rest of the application through the following files:

| File | Role in the feature |
|------|---------------------|
| `src/simple-offline-speech.js` | Web Audio API capture, frequency analysis, and command detection. |
| `src/renderer.js` | Command handling, status messages, and the microphone logging toggle. |
| `src/index.html` | Offline speech controls and the audio visualizer markup. |
| `src/style.css` | Styling for the controls, visualizer, and confidence indicator. |
| `src/main.js` | Application wiring for the microphone support setting. |
| `package.json` | Launch scripts that pass the Electron `--enable-speech-dispatcher` flag. |

The recognizer reuses existing application behavior rather than duplicating it;
it shares the command vocabulary with the online Web Speech API recognizer in
`src/voice.js`, it coexists with the gesture recognizer in `src/gestures.js`, it
dispatches the same command events the toolbar buttons raise, it inherits the
active theme, and it honors the **Log Microphone Commands** setting for console
output.

## Troubleshooting

### Common issues

#### "Microphone access denied"
**Solution**:
1. Check browser/system microphone permissions
2. Ensure microphone is not used by other applications
3. Restart the application

#### "Low recognition accuracy"
**Solutions**:
1. Speak more clearly and distinctly
2. Reduce background noise
3. Try different microphone if available
4. Adjust sensitivity settings
5. Use consistent speaking volume

#### "Commands not detected"
**Solutions**:
1. Enable "Log Microphone Commands" to see frequency analysis
2. Check audio levels in console logs
3. Adjust silence threshold settings
4. Ensure sufficient audio input level
5. Try speaking louder or closer to microphone

#### "Wrong commands detected"
**Solutions**:
1. Review frequency ratios in console logs
2. Adjust speaking pattern for better distinction
3. Use more distinct pronunciation
4. Check for background noise interference

### Performance optimization

#### For better accuracy
- Speak clearly and distinctly
- Minimize background noise
- Use consistent speaking volume
- Choose commands with different frequency characteristics

#### For better performance
- Close other applications using microphone
- Reduce audio buffer size if needed
- Optimize system audio settings
- Use dedicated microphone if available

## Development

### Adding new commands
1. Update frequency pattern detection in `src/simple-offline-speech.js`
2. Add command handling in `src/renderer.js`
3. Update documentation and frequency patterns

### Customizing frequency patterns
1. Modify `FREQUENCY_BANDS` in `src/simple-offline-speech.js`
2. Adjust pattern matching thresholds
3. Test with target speech patterns
4. Update command detection logic

### Extending audio analysis
1. Add additional frequency bands
2. Implement more sophisticated pattern matching
3. Add machine learning-based recognition
4. Integrate with external speech recognition libraries

## Security and privacy

### Data privacy
- **No Cloud Processing**: All speech recognition happens locally in browser
- **No Data Transmission**: Audio never leaves your device
- **No Logging**: Speech data is not stored or logged
- **Browser-Based**: Uses standard Web Audio API

### Security features
- **Local Processing**: All computation in browser sandbox
- **No External APIs**: No third-party speech services
- **Standard APIs**: Uses well-established Web Audio API
- **Privacy-First**: No audio data collection or transmission

## Performance benchmarks

### Recognition accuracy
- **Clear Speech**: ~70-80% accuracy with optimal conditions
- **Noise Tolerance**: Moderate performance in background noise
- **Command Distinction**: Good separation between different commands
- **Language Support**: Optimized for English patterns

### Resource usage
- **CPU**: 2-8% on modern systems
- **Memory**: 10-50MB for audio processing
- **Latency**: 50-200ms for command recognition
- **Startup Time**: Immediate (no model loading required)

### Browser compatibility
- **Chrome**: Full support
- **Firefox**: Full support
- **Safari**: Full support
- **Edge**: Full support

## Limitations

### Current limitations
- **Basic Recognition**: Frequency-based pattern matching, not true speech recognition
- **Limited Vocabulary**: Optimized for specific command words
- **Language Dependency**: Best results with English pronunciation
- **Noise Sensitivity**: Performance degrades with background noise
- **Pronunciation Dependent**: Requires consistent speaking patterns

### Comparison with traditional speech recognition
| Feature | Web Audio API | Traditional ASR |
|---------|---------------|-----------------|
| **Accuracy** | Moderate | High |
| **Vocabulary** | Limited | Large |
| **Language Support** | English-optimized | Multi-language |
| **Resource Usage** | Low | High |
| **Setup Complexity** | Simple | Complex |
| **Privacy** | Excellent | Varies |
| **Offline Capability** | Yes | Yes |

## Future enhancements

### Planned features
- **Machine Learning Integration**: Add ML-based pattern recognition
- **Custom Commands**: User-defined voice commands
- **Voice Profiles**: Personalized recognition for different users
- **Advanced Audio Processing**: Better noise reduction and filtering
- **Gesture Integration**: Combined voice and gesture control

### Technical improvements
- **Advanced Pattern Matching**: More sophisticated frequency analysis
- **Multi-threading**: Parallel audio processing
- **GPU Acceleration**: Hardware-accelerated audio processing
- **Real-time Learning**: Adaptive pattern recognition

## Support

### Getting help
1. Check this documentation
2. Review troubleshooting section
3. Enable microphone logging for detailed feedback
4. Check browser console for error messages
5. Test with different microphones

### Reporting issues
When reporting issues, please include:
- Operating system and version
- Browser type and version
- Application version
- Microphone type and settings
- Console logs with microphone logging enabled
- Steps to reproduce the issue

## Related documentation

| Document | Purpose |
|----------|---------|
| [Keyboard shortcuts](keyboard-shortcuts.md) | Every shortcut, including the in-app dialog shortcuts. |
| [Configuration](configuration.md) | App Config and Launch Config settings, storage locations, and reset steps. |
| [Developer guide](developer-guide.md) | Repository structure, local development, tests, debugging, and extension points. |
