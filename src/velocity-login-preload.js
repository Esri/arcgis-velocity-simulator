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
 * @file velocity-login-preload.js
 * @description Preload script for the Velocity Login dialog window.
 * Exposes a limited IPC API to the renderer under window.velocityApi.
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('velocityApi', {
  login: (params) => ipcRenderer.invoke('velocity:login', params),
  loginOAuth: (params) => ipcRenderer.invoke('velocity:login-oauth', params),
  listItems: (params) => ipcRenderer.invoke('velocity:list-items', params),
  getItemDetails: (params) => ipcRenderer.invoke('velocity:get-item-details', params),
  applyItem: (item) => ipcRenderer.send('velocity:apply-item', item),
  getStoredCredentials: () => ipcRenderer.invoke('velocity:get-stored-credentials'),
  storeCredentials: (creds) => ipcRenderer.invoke('velocity:store-credentials', creds),
  hideWindow: () => ipcRenderer.send('velocity:hide-login'),
});

