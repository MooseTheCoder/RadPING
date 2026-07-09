'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// App version, read once at preload time so the renderer has it synchronously.
const appVersion = ipcRenderer.sendSync('app:get-version');

// Minimal, explicit surface exposed to the renderer. No Node access leaks.
contextBridge.exposeInMainWorld('radping', {
  version: appVersion,
  send: (config) => ipcRenderer.invoke('radius:send', config),
  getDictionary: () => ipcRenderer.invoke('radius:dictionary'),
  profiles: {
    list: () => ipcRenderer.invoke('profiles:list'),
    save: (profile) => ipcRenderer.invoke('profiles:save', profile),
    remove: (id) => ipcRenderer.invoke('profiles:delete', id)
  },
  dictionaries: {
    list: () => ipcRenderer.invoke('dictionaries:list'),
    import: () => ipcRenderer.invoke('dictionaries:import'),
    remove: (id) => ipcRenderer.invoke('dictionaries:remove', id)
  },
  update: {
    check: () => ipcRenderer.invoke('update:check'),
    openReleases: (url) => ipcRenderer.invoke('update:openReleases', url)
  }
});
