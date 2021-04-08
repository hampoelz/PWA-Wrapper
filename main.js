const { app, shell, ipcMain, BrowserView, BrowserWindow } = require('electron');
const { URL } = require('url');
const path = require('path');
const fs = require('fs');

const package = require(path.join(__dirname, 'package.json'));
const __appDir = path.join(__dirname, '..', '..'); // app <-- node_modules <-- wrapper (current dir)

let appPackage = path.join(__appDir, 'package.json');
let appRendererData = '';
let appStyleData = '';

let windowTitle = 'PWA Wrapper'

console.log('Wrapper Version: ' + package?.version);

if (fs.existsSync(appPackage)) {
    appPackage = require(appPackage);
    console.log('App Version: ' + appPackage?.version);

    if (appPackage.main) require(path.join(__appDir, appPackage.main));

    if (appPackage.renderer) {
        const appRenderer = path.join(__appDir, appPackage.renderer);
        appRendererData = fs.readFileSync(appRenderer);
    }

    if (appPackage.title) title = appPackage.title;

    if (appPackage.style) {
        const appStyle = path.join(__appDir, appPackage.style);
        appStyleData = fs.readFileSync(appStyle, 'utf-8');
    }

    const windowStyle = path.join(__dirname, 'assets', 'styles', 'window.css');
    fs.readFile(windowStyle, 'utf8', (_, data) => {
        var result = data.replace(/--foreground: #[a-zA-Z0-9]*;/g, `--foreground: ${appPackage?.window?.preferences?.foregroundColor ?? '#E0E0E0'};`)
            .replace(/--foreground-hover: #[a-zA-Z0-9]*;/g, `--foreground: ${appPackage?.window?.preferences?.foregroundColor ?? '#FFFFFF'};`);

        fs.promises.writeFile(windowStyle, result, 'utf8');
    });
} else appPackage = undefined;

if (appPackage?.window?.singleInstanceLock ?? true) {
    const gotTheLock = app.requestSingleInstanceLock();
    if (!gotTheLock) {
        app.quit();
        return;
    }
}

let mainWindow;

function createWindow() {
    mainWindow = new BrowserWindow({
        frame: false,
        title: windowTitle,
        width: appPackage?.window?.width ?? 1100,
        minWidth: appPackage?.window?.minWidth ?? 400,
        height: appPackage?.window?.height ?? 800,
        minHeight: appPackage?.window?.minHeight ?? 600,
        backgroundColor: appPackage?.window?.preferences?.backgroundColor ?? '#303F9F',
        webPreferences: {
            devTools: false,
            preload: path.join(__dirname, 'window.js'),
        }
    });

    mainWindow.loadFile('window.html');
    mainWindow.openDevTools({ mode: 'undocked' });

    ipcMain.on('removeAllListeners', () => mainWindow.removeAllListeners());
    ipcMain.on('changeColor', (_, color) => mainWindow.setBackgroundColor(color));
    ipcMain.on('minimize', () => mainWindow.minimize());
    ipcMain.on('maximize', () => mainWindow.maximize());
    ipcMain.on('unmaximize', () => mainWindow.unmaximize());
    ipcMain.on('close', () => mainWindow.close());
    ipcMain.on('contact', () => shell.openExternal(appPackage?.bugs.report));

    ipcMain.handle('isMaximized', () => mainWindow.isMaximized());

    mainWindow.on('maximize', () => mainWindow.webContents.send('maximize'));
    mainWindow.on('unmaximize', () => mainWindow.webContents.send('unmaximize'));
    mainWindow.on('closed', () => mainWindow = null);
    mainWindow.webContents.on('did-finish-load', () => {
        if (!appPackage?.bugs?.report) mainWindow.webContents.send('disableContacting');

        ipcMain.on('changeBackground', (_, color) => mainWindow.webContents.send('changeBackground', color));
        ipcMain.on('changeForeground', (_, color) => mainWindow.webContents.send('changeForeground', color));
        ipcMain.on('changeForegroundHover', (_, color) => mainWindow.webContents.send('changeForegroundHover', color));

        const browser = new BrowserView({
            webPreferences: {
                devTools: process.argv[2] == '--dev' ? appPackage?.window?.devTools ?? true : false, // Open devTools only during development
                preload: path.join(__dirname, 'preload.js')
            }
        });

        browser.webContents.on('page-title-updated', (_, title) => {
            mainWindow.webContents.send('changeTitle', title);
            mainWindow.title = title;
        });

        browser.webContents.on('new-window', (event, url) => {
            let whiteList = appPackage?.whiteList;
            if (whiteList) {
                for (let index = 0; index < whiteList.length; index++) {
                    const regex = new RegExp(whiteList[index]);
                    if (url.match(regex)) return;
                }
            }

            event.preventDefault();
            shell.openExternal(url);
        });

        // TODO: Improve white- / backlist mechanism
        browser.webContents.on('will-navigate', (event, url) => {
            let whiteList = appPackage?.whiteList;
            if (whiteList) {
                for (let index = 0; index < whiteList.length; index++) {
                    const regex = new RegExp(whiteList[index]);
                    if (url.match(regex)) return;
                }
            }

            let blackList = appPackage?.blackList;
            if (blackList) {
                for (let index = 0; index < blackList.length; index++) {
                    const regex = new RegExp(blackList[index]);
                    if (url.match(regex)) {
                        event.preventDefault();
                        shell.openExternal(url);
                    }
                }
            }

            let host = new URL(browser.webContents.getURL()).hostname;
            let reqHost = new URL(url).hostname;
            if (host != reqHost) {
                event.preventDefault();
                shell.openExternal(url);
            }
        });

        browser.webContents.on('did-fail-load', () => {
            mainWindow.webContents.send('did-fail-load');
            mainWindow.removeBrowserView(browser);
        });

        browser.webContents.on('did-finish-load', async () => {
            await browser.webContents.executeJavaScript(appRendererData);
            await browser.webContents.insertCSS(appStyleData);
        });

        browser.webContents.openDevTools({ mode: 'undocked' });

        if (appPackage?.preload) browser.webContents.send('preload', path.join(__appDir, appPackage.preload));

        loadURL();
        ipcMain.on('reload', () => loadURL());

        function loadURL() {
            mainWindow.addBrowserView(browser);
            browser.webContents.loadURL(appPackage?.window?.url ?? 'https://hampoelz.net/', {
                userAgent: browser.webContents.session.getUserAgent()
                    .replace('Electron', 'WebAppWrapper') +
                    (appPackage?.window?.userAgentPostfix ? (' ' + appPackage.window.userAgentPostfix) : '')
            });
        }

        setBrowserBounds();
        mainWindow.on('resize', () => setBrowserBounds());

        // setAutoResize doesn't work properly
        function setBrowserBounds() {
            let newBounds = mainWindow.getContentBounds();
            browser.setBounds({ x: 1, y: 34, width: newBounds.width - 2, height: newBounds.height - 35 });
        }
    });
}

app.whenReady().then(() => {
    createWindow();
    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on('second-instance', () => {
    if (mainWindow) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.focus();
    }
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});