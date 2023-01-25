const { app, shell, ipcMain, BrowserView, BrowserWindow, Menu } = require("electron");
const { setupTitlebar, attachTitlebarToWindow } = require("custom-electron-titlebar/main");
const { readFileSync } = require("fs");
const { join, dirname, resolve } = require("path");
const { defaultsDeep, merge } = require("lodash");

const updater = require('./updater');

const __appDir = dirname(require.main.filename);

const wrapperPackage = require('./package.json');
const appPackage = require(join(__appDir, 'package.json'));

const wrapperVersion = wrapperPackage.version;
const appVersion = appPackage.version;

let titleBarHeight = 22;

console.log('Wrapper Version: ' + wrapperVersion);

setupTitlebar();

if (__appDir == __dirname) {
    pwaWrapper({ window: { titleBarAlignment: 'left' } });

    const menu = Menu.buildFromTemplate([])
    Menu.setApplicationMenu(menu)
}

ipcMain.on('wrapper_main:updateTitleBarHeight', (_, height) => titleBarHeight = height);

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});

async function pwaWrapper(options) {
    options = defaultsDeep(options || {}, {
        window: {
            title: 'PWA Wrapper',
            useFavicon: true,
            width: 1100,
            minWidth: 400,
            height: 800,
            minHeight: 600,
            primaryColor: '#1095c1',
            primaryColorHover: '#08769b',
            titleBarColor: '#0D1117',
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
        updater.runUpdater(window, appVersion, options.updateHistory, appPackage?.build?.appx?.identityName);

    app.on('second-instance', () => {
        if (options.singleInstanceLock) {
            if (window.isMinimized()) window.restore();
            window.focus();
        }
    });

    return { window, browser };
}

function createWindow(windowOptions, browserOptions) {
    const customPreload = browserOptions.webPreferences?.preload;
    const customRenderer = browserOptions.webPreferences?.renderer;
    const customStyle = browserOptions.webPreferences?.stylesheet;

    windowOptions = merge(windowOptions, {
        show: false,
        titleBarStyle: 'hidden',
        webPreferences: {
            devTools: false,
            sandbox: false,
            preload: join(__dirname, 'window.js')
        }
    });

    browserOptions = merge(browserOptions, {
        webPreferences: {
            sandbox: false,
            preload: join(__dirname, 'preload.js')
        }
    });

    // TODO
    ipcMain.handle('preload', () => {
        if (customPreload) return customPreload;
        return;
    })

    if (process.argv[2] != '--dev') browserOptions.webPreferences.devTools = false

    let mainWindow = new BrowserWindow(windowOptions);
    let browser = new BrowserView(browserOptions);

    attachTitlebarToWindow(mainWindow);

    let isLoaded = true;
    let isPageLoading = false;
    let isMessageShown = false;

    // setAutoResize doesn't work properly
    function setBrowserBounds() {
        let newBounds = mainWindow.getContentBounds();
        let _titleBarHeight = titleBarHeight + (isPageLoading ? 3 : 0); // add the height of the loading bar (3px) when a page loads
        browser.setBounds({ x: 0, y: _titleBarHeight, width: newBounds.width, height: newBounds.height - _titleBarHeight });
    }

    mainWindow.once('ready-to-show', () => mainWindow.show());
    mainWindow.on('resize', () => setBrowserBounds());

    mainWindow.on('closed', () => {
        mainWindow = null;
        browser = null;
    });

    mainWindow.webContents.on('dom-ready', function() {
        this.send('wrapper_window:changePrimaryColor', windowOptions.primaryColor);
        this.send('wrapper_window:changePrimaryHoverColor', windowOptions.primaryColorHover);
        this.send('wrapper_window:changeTitleBarColor', windowOptions.titleBarColor);
        this.send('wrapper_window:changeTitleBarAlignment', windowOptions.titleBarAlignment);
        this.send('wrapper_window:changeMenuPosition', windowOptions.menuPosition);
    });

    mainWindow.webContents.on('did-finish-load', () => {
        mainWindow.webContents.send('wrapper_window:updatePageTitle', windowOptions.title);

        if (windowOptions.icon)
            mainWindow.webContents.send('wrapper_window:updatePageFavicon', resolve(windowOptions.icon))
        
        const getCurrentUrl = () => browser.webContents.getURL() || browserOptions.url;

        browser.webContents.loadURL(getCurrentUrl());
        browser.webContents.openDevTools({ mode: 'undocked' });

        if (!appPackage?.bugs?.url && !appPackage?.bugs?.email) mainWindow.webContents.send('wrapper_window:disableContacting');

        ipcMain.on('wrapper_main:browser-reload', () => {
            browser.webContents.loadURL(getCurrentUrl());
            isLoaded = true;
        });
    });
    
    mainWindow.loadFile(join(__dirname, 'window.html'));
    mainWindow.openDevTools({ mode: 'undocked' });

    mainWindow.webContents.on('will-navigate', (event) => {
        event.preventDefault();
    });

    mainWindow.openMessageScreen = html => {
        isMessageShown = true;

        if (mainWindow.getBrowserView(browser))
            mainWindow.removeBrowserView(browser);

        mainWindow.webContents.send('wrapper_window:openMessageScreen', html);
    }

    mainWindow.closeMessageScreen = () => {
        if (mainWindow.getBrowserView(browser)) return;

        mainWindow.addBrowserView(browser);
        setBrowserBounds();

        mainWindow.webContents.send('wrapper_window:closeMessageScreen');

        isMessageShown = false;
    }

    browser.webContents.on("did-start-loading", () => {
        isPageLoading = true;
        setBrowserBounds();
    });

    browser.webContents.on("did-stop-loading", () => {
        isPageLoading = false;
        setBrowserBounds();
    });

    browser.webContents.on('did-finish-load', async () => {
        if (!isLoaded) return;
        if (customRenderer) {
            const appRenderer = join(__appDir, customRenderer);
            const appRendererData = readFileSync(appRenderer);
            await browser.webContents.executeJavaScript(appRendererData);
        }

        if (customStyle) {
            const appStyle = join(__appDir, customRenderer);
            const appStyleData = readFileSync(appStyle, 'utf-8');
            await browser.webContents.insertCSS(appStyleData);
        }

        if (isMessageShown) return;
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
        mainWindow.webContents.send('wrapper_window:browser-did-fail-load');

        if (mainWindow.getBrowserView(browser)) {
            mainWindow.removeBrowserView(browser);
            ipcMain.emit('wrapper_main:browser-reload'); // reload to reset page
        }
        
        isLoaded = false;
    });

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

    browser.webContents.setWindowOpenHandler(({ url }) => {
        if (isUrlWhitelisted(url)) browser.webContents.loadURL(url);
        else shell.openExternal(url);

        return { action: 'deny' }
    })

    browser.webContents.on('page-title-updated', (_, title) => {
        mainWindow.webContents.send('wrapper_window:updatePageTitle', title)
        mainWindow.title = `${title} - ${windowOptions.title}`
    });

    if (windowOptions.useFavicon) {
        browser.webContents.on('page-favicon-updated', (_, icons) => {
            mainWindow.webContents.send('wrapper_window:updatePageFavicon', icons[0])
        });
    }

    browser.webContents.setUserAgent(browserOptions.userAgent || browser.webContents.session.getUserAgent().replace('Electron', 'WebAppWrapper'));

    function isUrlWhitelisted(url) {
        const regex = new RegExp(browserOptions.whitelist || browserOptions.url);
        return regex.test(url);
    }

    ipcMain.on("wrapper_main:closeMessageScreen", () => mainWindow.closeMessageScreen());
    ipcMain.on('wrapper_main:removeAllListeners', () => mainWindow.removeAllListeners());
    ipcMain.on('wrapper_main:changePrimaryColor', (_, color) => mainWindow.webContents.send('wrapper_window:changePrimaryColor', color));
    ipcMain.on('wrapper_main:changePrimaryHoverColor', (_, color) => mainWindow.webContents.send('wrapper_window:changePrimaryHoverColor', color));
    ipcMain.on('wrapper_main:changeTitleBarColor', (_, color) => mainWindow.webContents.send('wrapper_window:changeTitleBarColor', color));
    ipcMain.on('wrapper_main:contactMaintainer', () => {
        let mail = appPackage?.bugs?.email;
        if (mail) mail = 'mailto:' + mail;
        shell.openExternal(appPackage?.bugs?.url || mail)
    });

    return {
        window: mainWindow,
        browser: browser
    };
}

module.exports = pwaWrapper;