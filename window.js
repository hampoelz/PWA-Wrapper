const { ipcRenderer } = require('electron');

document.onreadystatechange = async () => {
    if (document.readyState == "complete") {
        await handleWindowControls();
        await handleFailLoad();

        let root = document.documentElement;
        ipcRenderer.on('changeTitle', (_, title) => document.getElementById('window-title').querySelector('span').innerHTML = title);
        ipcRenderer.on('changeBackground', (_, color) => document.body.style.backgroundColor = color);
        ipcRenderer.on('changeForeground', (_, color) => root.style.setProperty('--foreground', color));
        ipcRenderer.on('changeForegroundHover', (_, color) => root.style.setProperty('--foreground-hover', color));
        ipcRenderer.on('disableContacting', () => document.getElementById('contact').style.display = 'none');
    }
};

window.onbeforeunload = () => ipcRenderer.send('removeAllListeners');

async function handleWindowControls() {
    document.getElementById('min-button').addEventListener("click", () => ipcRenderer.send('minimize'));
    document.getElementById('max-button').addEventListener("click", () => ipcRenderer.send('maximize'));
    document.getElementById('restore-button').addEventListener("click", () => ipcRenderer.send('unmaximize'));
    document.getElementById('close-button').addEventListener("click", () => ipcRenderer.send('close'));

    await toggleMaxRestoreButtons();
    ipcRenderer.on('maximize', toggleMaxRestoreButtons);
    ipcRenderer.on('unmaximize', toggleMaxRestoreButtons);

    async function toggleMaxRestoreButtons() {
        var isMaximized = await ipcRenderer.invoke('isMaximized');
        if (isMaximized) document.body.classList.add('maximized');
        else document.body.classList.remove('maximized');
    }
}

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
