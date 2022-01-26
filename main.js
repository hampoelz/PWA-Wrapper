const { app, shell, ipcMain, BrowserView, BrowserWindow, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const _ = require('lodash');
const updater = require('./updater');

const __appDir = path.dirname(require.main.filename);

const package = require('./package.json');
const appPackage = require(path.join(__appDir, 'package.json'));

const wrapperVersion = package.version;
const appVersion = appPackage.version;

let titleBarHeight = 22;

console.log('Wrapper Version: ' + wrapperVersion);

if (__appDir == __dirname) {
    pwaWrapper({ window: { titleBarAlignment: 'left' } });

    const menu = Menu.buildFromTemplate([])
    Menu.setApplicationMenu(menu)
}

ipcMain.on('request-application-menu', event => {
    const menu = Menu.getApplicationMenu();
    const jsonMenu = JSON.parse(JSON.stringify(menu, parseMenu()));
    event.sender.send('titlebar-menu', jsonMenu);
});

ipcMain.on('titleBarHeight', (_, height) => titleBarHeight = height);

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});

async function pwaWrapper(options) {
    options = _.defaultsDeep(options || {}, {
        window: {
            title: 'PWA Wrapper',
            useFavicon: true,
            width: 1100,
            minWidth: 400,
            height: 800,
            minHeight: 600,
            foregroundColor: '#FFFFFF',
            foregroundHoverColor: '#E0E0E0',
            backgroundColor: '#0D1117',
            titleBarAlignment: 'center',
            menuPosition: 'left'
        },
        browser: {
            url: 'https://github.com/hampoelz',
            whitelist: '',
            webPreferences: {}
        },
        singleInstanceLock: false,
        updateHistory: 'http://127.0.0.1:5500/update-history.jsons',
    });

    let isSecondInstance = false;
    const gotTheLock = app.requestSingleInstanceLock({ pid: process.pid });
    if (!gotTheLock) {
        isSecondInstance = true;
        if (options.singleInstanceLock) {
            app.quit();
            return;
        }
    }

    await app.whenReady();
    const { window, browser } = createWindow(options.window, options.browser);

    if (!isSecondInstance && options.updateHistory)
        updater.runUpdater(window, appVersion, options.updateHistory);

    app.on('second-instance', () => {
        if (options.singleInstanceLock) {
            if (window.isMinimized()) window.restore();
            window.focus();
        }
    });

    ipcMain.on('menu-event', (event, commandId) => {
        const menu = Menu.getApplicationMenu();
        const item = getMenuItemByCommandId(commandId, menu);
        item?.click(undefined, browser, event.sender);
    });

    ipcMain.on('window-minimize', () => window.minimize());
    ipcMain.on('window-maximize', () => window.isMaximized() ? window.unmaximize() : window.maximize());
    ipcMain.on('window-close', () => window.close());
    ipcMain.on('window-is-maximized', event => event.returnValue = window.isMaximized());

    return { window, browser };
}

function createWindow(windowOptions, browserOptions) {
    const customPreload = browserOptions.webPreferences?.preload;
    const customRenderer = browserOptions.webPreferences?.renderer;
    const customStyle = browserOptions.webPreferences?.stylesheet;

    windowOptions = _.merge(windowOptions, {
        show: false,
        frame: false,
        webPreferences: {
            devTools: false,
            preload: path.join(__dirname, 'window.js')
        }
    });

    browserOptions = _.merge(browserOptions, {
        webPreferences: {
            preload: path.join(__dirname, 'preload.js')
        }
    });

    if (process.argv[2] != '--dev') browserOptions.webPreferences.devTools = false

    // setAutoResize doesn't work properly
    function setBrowserBounds() {
        let newBounds = mainWindow.getContentBounds();
        browser.setBounds({ x: 0, y: titleBarHeight, width: newBounds.width, height: newBounds.height - titleBarHeight });
    }

    let mainWindow = new BrowserWindow(windowOptions);
    let browser = new BrowserView(browserOptions);

    mainWindow.once('ready-to-show', () => mainWindow.show());
    mainWindow.on('resize', () => setBrowserBounds());

    mainWindow.on('closed', () => {
        mainWindow = null;
        browser = null;
    });

    mainWindow.webContents.on('dom-ready', function() {
        this.send('changeBackground', windowOptions.backgroundColor)
        this.send('changeForeground', windowOptions.foregroundColor)
        this.send('changeForegroundHover', windowOptions.foregroundHoverColor)
        this.send('changeTitleBarAlignment', windowOptions.titleBarAlignment)
        this.send('changeMenuPosition', windowOptions.menuPosition)
    });

    mainWindow.loadFile(path.join(__dirname, 'window.html'));
    mainWindow.openDevTools({ mode: 'undocked' });

    let isLoaded = true;

    mainWindow.webContents.on('did-finish-load', () => {
        mainWindow.webContents.send('page-title-updated', windowOptions.title);

        if (windowOptions.icon)
            fs.readFile(path.join(__appDir, windowOptions.icon), (_, buffer) => {
                mainWindow.webContents.send('page-favicon-updated', new Uint8Array(buffer))
            });


        let currentUrl = browser.webContents.getURL();
        browser.webContents.loadURL(currentUrl || browserOptions.url);
        browser.webContents.openDevTools({ mode: 'undocked' });

        if (!appPackage?.bugs?.url && !appPackage?.bugs?.email) mainWindow.webContents.send('disableContacting');

        ipcMain.on('reload', () => {
            isLoaded = true;
            browser.webContents.loadURL(browserOptions.url);
        });
    });

    
    browser.webContents.on('did-finish-load', async () => {
        if (!isLoaded) return;
        if (customRenderer) {
            const appRenderer = path.join(__appDir, customRenderer);
            const appRendererData = fs.readFileSync(appRenderer);
            await browser.webContents.executeJavaScript(appRendererData);
        }

        if (customStyle) {
            const appStyle = path.join(__appDir, customRenderer);
            const appStyleData = fs.readFileSync(appStyle, 'utf-8');
            await browser.webContents.insertCSS(appStyleData);
        }

        mainWindow.addBrowserView(browser);
        setBrowserBounds();
    });

    const allowedErrorRange = [
        -1,     // IO_PENDING
        -3,     // ABORTED
        -11,    // NOT_IMPLEMENTED
        -14,    // UPLOAD_FILE_CHANGED
        -16,    // FILE_EXISTS
        -23,    // SOCKET_IS_CONNECTED
        -25     // UPLOAD_STREAM_REWIND_NOT_SUPPORTED
    ]

    browser.webContents.on('did-fail-load', (_, error) => {
        if (allowedErrorRange.includes(error)) return;
        mainWindow.webContents.send('did-fail-load');

        if (mainWindow.getBrowserView(browser)) {
            mainWindow.removeBrowserView(browser);
            ipcMain.emit('reload'); // Reload once to reset DOM
        }
        
        isLoaded = false;
    });

    ipcMain.on('preload-loaded', () => {
        if (customPreload) browser.webContents.send('preload', path.join(__appDir, customPreload));
    })

    browser.webContents.on('will-navigate', (event, url) => {
        if (isUrlWhitelisted(url)) return;

        shell.openExternal(url);
        event.preventDefault();
    });

    browser.webContents.on('new-window', (event, url) => {
        if (isUrlWhitelisted(url)) browser.webContents.loadURL(url);
        else shell.openExternal(url);

        event.preventDefault();
    });

    browser.webContents.on('page-title-updated', (_, title) => {
        mainWindow.webContents.send('page-title-updated', title)
        mainWindow.title = `${title} - ${windowOptions.title}`
    });

    if (windowOptions.useFavicon)
        browser.webContents.on('page-favicon-updated', (_, icons) => {
            mainWindow.webContents.send('page-favicon-updated', icons)
        });

    browser.webContents.setUserAgent(browserOptions.userAgent || browser.webContents.session.getUserAgent().replace('Electron', 'WebAppWrapper'));

    function isUrlWhitelisted(url) {
        const regex = new RegExp(browserOptions.whitelist || browserOptions.url);
        return regex.test(url);
    }

    ipcMain.on('removeAllListeners', () => mainWindow.removeAllListeners());
    ipcMain.on('changeBackground', (_, color) => mainWindow.webContents.send('changeBackground', color));
    ipcMain.on('changeForeground', (_, color) => mainWindow.webContents.send('changeForeground', color));
    ipcMain.on('changeForegroundHover', (_, color) => mainWindow.webContents.send('changeForegroundHover', color));
    ipcMain.on('contact', () => {
        let mail = appPackage?.bugs?.email;
        if (mail) mail = 'mailto:' + mail;
        shell.openExternal(appPackage?.bugs?.url ?? mail)
    });

    return {
        window: mainWindow,
        browser: browser
    };
}

function parseMenu() {
    const menu = new WeakSet();
    return (key, value) => {
        if (key === 'commandsMap') return;
        if (typeof value === 'object' && value !== null) {
            if (menu.has(value)) return;
            menu.add(value);
        }
        return value;
    };
}

function getMenuItemByCommandId(commandId, menu = Menu.getApplicationMenu()) {
    let menuItem;
    menu.items.forEach(item => {
        if (item.submenu) {
            const submenuItem = getMenuItemByCommandId(commandId, item.submenu);
            if (submenuItem) menuItem = submenuItem;
        }
        if (item.commandId === commandId) menuItem = item;
    });

    return menuItem;
};

module.exports = pwaWrapper;