const { contextBridge, ipcRenderer } = require('electron');
const { Titlebar, Color } = require('custom-electron-titlebar');

const updateTitleBarHight = () => ipcRenderer.send('wrapper_main:updateTitleBarHeight', parseInt(getComputedStyle(document.querySelector('.cet-titlebar')).height, 10));

window.onbeforeunload = () => ipcRenderer.send('wrapper_main:removeAllListeners');

window.addEventListener('DOMContentLoaded', () => {
    const titlebar = new Titlebar({ titleHorizontalAlignment: '' });
    const root = document.documentElement;

    ipcRenderer.on('wrapper_window:disableContacting', () => document.getElementById('contact').style.display = 'none');
    ipcRenderer.on('wrapper_window:changePrimaryColor', (_, color) => root.style.setProperty('--primary', color));
    ipcRenderer.on('wrapper_window:changePrimaryHoverColor', (_, color) => root.style.setProperty('--primary-hover', color));
    ipcRenderer.on('wrapper_window:changeTitleBarColor', (_, color) => titlebar.updateBackground(Color.fromHex(color)));
    ipcRenderer.on('wrapper_window:changeTitleBarAlignment', (_, position) => titlebar.updateTitleAlignment(position));
    ipcRenderer.on('wrapper_window:changeMenuPosition', (_, position) => {
        titlebar.updateMenuPosition(position);
        updateTitleBarHight();
    });
    ipcRenderer.on('wrapper_window:updatePageTitle', (_, title) => {
        let trimmedTitle = title.substring(0, 70);
        titlebar.updateTitle(trimmedTitle + (title.length > 70 ? '...' : ''));
    })
    ipcRenderer.on('wrapper_window:updatePageFavicon', (_, path) => {
        if (!path) return;

        // titlebar.updateTitle() doesn't work properly
        const windowIcon = document.querySelector('div.cet-window-icon');
        if (windowIcon) windowIcon.firstElementChild.src = path;
    })

    ipcRenderer.on('wrapper_window:openMessageScreen', (_, html) => {
        if (document.body.classList.contains('user-offline') || document.body.classList.contains('page-offline')) return;
        if (html) document.getElementById('message-screen').innerHTML = html;
        document.body.classList.add('message');
    });

    ipcRenderer.on('wrapper_window:closeMessageScreen', () => {
        document.body.classList.remove('message');
    });

    updateTitleBarHight();
    handleFailLoad();
});

function handleFailLoad() {
    document.getElementById('reload').addEventListener("click", () => reloadPage());
    document.getElementById('contact').addEventListener("click", () => ipcRenderer.send('wrapper_main:contactMaintainer'));

    ipcRenderer.on('wrapper_window:browser-did-fail-load', async () => {
        let isOnline = await checkInternet();
        if (!isOnline) {
            document.body.classList.add('user-offline');
            let interval = setInterval(async () => {
                let isOnline = await checkInternet();
                if (isOnline) {
                    reloadPage();
                    clearInterval(interval);
                }
            }, 5000);
        } else document.body.classList.add('page-offline');
    });

    function reloadPage() {
        ipcRenderer.send('wrapper_main:browser-reload');
        document.body.classList.remove('user-offline');
        document.body.classList.remove('page-offline');
    }

    async function checkInternet() {
        try {
            const online = await fetch('https://www.google.com/');
            return online.status >= 200 && online.status < 300;
        } catch {
            return false;
        }
    }
}

contextBridge.exposeInMainWorld('ipcRenderer', {
    on: (channel, callback) => ipcRenderer.on(channel, callback),
    send: (channel, message) => ipcRenderer.send(channel, message)
});

contextBridge.exposeInMainWorld('message', {
    close: () => ipcRenderer.send('wrapper_main:closeMessageScreen')
});