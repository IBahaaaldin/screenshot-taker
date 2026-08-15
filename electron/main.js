// electron/main.js
import { app, BrowserWindow, dialog } from 'electron';
import path from 'node:path';

if (app.isPackaged) {
  process.env.PLAYWRIGHT_BROWSERS_PATH = path.join(process.resourcesPath, 'playwright-browsers');
}

// Dynamic imports, not static ones: static `import` declarations are
// hoisted and evaluate before any statement in this module body runs, so a
// static import of src/server.js (which pulls in Playwright transitively)
// would read PLAYWRIGHT_BROWSERS_PATH before the assignment above ever
// executes. Playwright resolves its browsers directory once at module
// init, so a static import here would silently ignore the bundled path.
const { createApp } = await import('../src/server.js');
const { startScheduler } = await import('../src/scheduler.js');

const PORT = 3000;

async function startServer() {
  const outputRoot = path.join(app.getPath('userData'), 'output');
  const expressApp = createApp({ outputRoot, port: PORT });

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
    backgroundColor: '#f5f5f5',
  });
  await win.loadURL(`http://127.0.0.1:${PORT}`);
}

app.whenReady().then(async () => {
  try {
    await startServer();
    await createWindow();
  } catch (err) {
    console.error('Screenshot Taker failed to start:', err);
    dialog.showErrorBox('Screenshot Taker failed to start', String(err?.message || err));
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
