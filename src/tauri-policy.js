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

'use strict';

const shared = ['get-current-theme', 'get-system-theme', 'get-app-version', 'close-dialog', 'copy-to-clipboard'];
const channels = {
  'index.html': [
    ...shared, 'save-theme', 'save-logs', 'get-cli-help-reference', 'xmpp-copy-client-settings',
    'open-external-link', 'show-cli-dialog', 'connection-line-state-changed', 'show-metadata-state-changed',
    'inspect-element', 'inspect-element-done', 'velocity:open-login', 'velocity:set-token-sending',
    'protocol-settings:open', 'protocol-settings:close', 'protocol-settings:sync', 'protocol-settings:command',
    ...['tcp', 'udp', 'grpc', 'http', 'ws', 'xmpp'].flatMap(protocol => [`connect-${protocol}`, `disconnect-${protocol}`]),
    // The publishing application uses the same host, with its own preload.
    'open-file-dialog', 'read-csv-file', 'read-replay-file', 'connect', 'disconnect', 'send-data',
    'xmpp:get-client-settings', 'show-context-menu', 'theme-applied', 'show-error-in-dialog',
    'save-status-area-visibility', 'save-font-settings', 'export-config', 'import-config',
    'read-config-file', 'write-config-file', 'get-config-path', 'toggle-compact-view',
    'save-splitter-position', 'get-full-view-dimensions', 'get-camera-support-state',
    'get-microphone-support-state', 'send-error-to-developer',
  ],
  'protocol-settings.html': [
    'protocol-settings:window-ready', 'protocol-settings:window-event', 'protocol-settings:window-close',
  ],
  'velocity-login.html': [
    'velocity:login', 'velocity:login-oauth', 'velocity:get-session-state',
    'velocity:detect-endpoint', 'velocity:apply-endpoint', 'velocity:select-server',
    'velocity:list-items', 'velocity:get-item-details', 'velocity:apply-item',
    'velocity:get-stored-credentials', 'velocity:store-credentials', 'velocity:hide-login',
  ],
  'splash.html': ['splash-ready'],
  'about.html': [...shared, 'about-dialog-ready', 'close-about-dialog', 'open-external-link'],
  'help.html': [...shared, 'help-dialog-ready', 'open-external-link'],
  'cli.html': [...shared, 'cli-dialog-ready', 'get-cli-help-reference'],
  'config.html': [...shared, 'config-theme-applied', 'export-config', 'import-config',
    'read-config-file', 'write-config-file', 'get-config-path'],
  'launch-config.html': [...shared, 'launch-config-theme-applied'],
  'error.html': [...shared, 'error-theme-applied', 'send-error-to-developer'],
};

function isAllowedChannel(file, channel) {
  return typeof channel === 'string' && (channels[file] || []).includes(channel);
}

module.exports = { isAllowedChannel, windowFiles: Object.keys(channels) };
