// electron/main.js
import { app, BrowserWindow, dialog } from 'electron';
import path from 'node:path';

if (app.isPackaged) {
  process.env.PLAYWRIGHT_BROWSERS_PATH = path.join(process.resourcesPath, 'playwright-browsers');
}

import { createApp } from '../src/server.js';
import { startScheduler } from '../src/scheduler.js';

const PORT = 3000;

async function startServer() {
  const outputRoot = path.join(app.getPath('userData'), 'output');
  const expressApp = createApp({ outputRoot });

  const igUserId = process.env.IG_BUSINESS_ACCOUNT_ID;
  const accessToken = process.env.IG_ACCESS_TOKEN;
  if (igUserId && accessToken) {
    startScheduler({ outputRoot, igUserId, accessToken });
  }

  return new Promise((resolve, reject) => {
    const server = expressApp.listen(PORT, '127.0.0.1', () => resolve(server));
    server.on('error', (err) => {
      dialog.showErrorBox(
        'Screenshot Taker failed to start',
        `Could not start the local server on port ${PORT}: ${err.message}`
      );
      reject(err);
    });
  });
}

async function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 900,
    title: 'Screenshot Taker',
    backgroundColor: '#0a0a0a',
  });
  await win.loadURL(`http://localhost:${PORT}`);
}

app.whenReady().then(async () => {
  try {
    await startServer();
    await createWindow();
  } catch (err) {
    app.quit();
    return;
  }
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
