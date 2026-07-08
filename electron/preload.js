'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// Minimal, explicit surface exposed to the renderer. No Node access leaks.
contextBridge.exposeInMainWorld('radping', {
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
  }
});
