const { ipcRenderer } = require('electron');
const customTitlebar = require("custom-electron-titlebar");

let titlebar;

window.addEventListener('DOMContentLoaded', async () => {
    titlebar = new customTitlebar.Titlebar({
        backgroundColor: customTitlebar.Color.fromHex("#FFF"),
        icon: 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==',
        titleHorizontalAlignment: '',
        onMinimize: () => ipcRenderer.send('window-minimize'),
        onMaximize: () => ipcRenderer.send('window-maximize'),
        onClose: () => ipcRenderer.send('window-close'),
        isMaximized: () => ipcRenderer.sendSync('window-is-maximized'),
        onMenuItemClick: commandId => ipcRenderer.send('menu-event', commandId)
    });

    const root = document.documentElement;

    const updateTitleBarHight = () => ipcRenderer.send('titleBarHeight', parseInt(getComputedStyle(document.querySelector('.cet-titlebar')).height, 10));

    ipcRenderer.on('disableContacting', () => document.getElementById('contact').style.display = 'none');
    ipcRenderer.on('changeBackground', (_, color) => {
        document.body.style.backgroundColor = color;
        titlebar.updateBackground(customTitlebar.Color.fromHex(color));
    });
    ipcRenderer.on('changeForeground', (_, color) => root.style.setProperty('--foreground', color));
    ipcRenderer.on('changeForegroundHover', (_, color) => root.style.setProperty('--foreground-hover', color));
    ipcRenderer.on('changeTitleBarAlignment', (_, position) => titlebar.updateTitleAlignment(position));
    ipcRenderer.on('changeMenuPosition', (_, position) => {
        titlebar.updateMenuPosition(position);
        updateTitleBarHight();
    });
    ipcRenderer.on('page-title-updated', (_, title) => titlebar.updateTitle(title))
    ipcRenderer.on('page-favicon-updated', (_, data) => {
        let icon;
        
        if (ArrayBuffer.isView(data)) {
            let favicon = new Blob([data]);
            icon = URL.createObjectURL(favicon)
        } else if (Array.isArray(data)) {
            icon = data[0]
        } else {
            icon = data;
        }

        titlebar.updateIcon(icon)
    })

    ipcRenderer.send('request-application-menu');

    updateTitleBarHight();
    await handleFailLoad();
});

ipcRenderer.on('titlebar-menu', (_, menu) => titlebar.updateMenu(menu))

window.onbeforeunload = () => ipcRenderer.send('removeAllListeners');

async function handleFailLoad() {
    document.getElementById('reload').addEventListener("click", () => reloadPage());
    document.getElementById('contact').addEventListener("click", () => ipcRenderer.send('contact'));

    ipcRenderer.on('did-fail-load', async () => {
        var isOnline = await checkInternet();
        if (!isOnline) {
            document.body.classList.add('user-offline');
            let interval = setInterval(async () => {
                var isOnline = await checkInternet();
                if (isOnline) {
                    reloadPage();
                    clearInterval(interval);
                }
            }, 5000);
        } else document.body.classList.add('page-offline');
    });

    function reloadPage() {
        ipcRenderer.send('reload');
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
