const compareVersions = require('compare-versions');
const { spawn } = require('child_process');
const { dialog } = require('electron');
const fetch = require('node-fetch');
const path = require('path');
const os = require('os');
const fs = require('fs');
const _ = require('lodash');

/* {
    "name": "",
    "description": "",
    "repository": "",
    "history": [
        {
            "version": "",
            "files": {
                "win32": "",
                "darwin": "",
                "linux": ""
            },
            "staggering": "20%",
            "isPrerelease": false,
            "isMandatory": false
        },
    ]
} */

async function runUpdater(window, currentVersion, historyUrl) {
    const update = await downloadUpdate(currentVersion, historyUrl);
    if (!update || !update.path) return;

    const isStoreTarget = checkIfStoreTarget();;

    window.on('close', () => {
        let message = `A new version has been downloaded. The update to v${update.version} will be installed automatically in the background. You don't have to do anything.`;

        if (isStoreTarget)
            message = `It seems there are problems updating this program from the store. The update to v${update.version} will be installed automatically in the background. You may want to uninstall the old version manually.`

        const choice = dialog.showMessageBoxSync(window, {
            type: 'info',
            message: 'v' + update.version,
            detail: message,
            buttons: ['Ok', 'Cancel']
        });
        
        if (choice != 0) return;

        const setup = spawn(update.path, ["/S"], {
            detached: true,
            stdio: ['ignore']
        });
        setup.unref();
    });
}

async function downloadUpdate(currentVersion, url) {
    const package = await getUpdatePacket(currentVersion, url);
    if (!package) return;

    console.log("update Found, downloading file " + package.targetFile)

    let downloadPath;

    try {
        const response = await fetch(package.targetFile);
        if (!response.ok) return;

        const setupFileName = path.basename(package.targetFile);
        const appTempDir = fs.mkdtempSync(path.join(os.tmpdir(), package.appName + '-'));
        downloadPath = path.join(appTempDir, setupFileName);

        console.log("write file to filesystem: " + downloadPath)

        const fileStream = fs.createWriteStream(downloadPath);

        await new Promise((resolve, reject) => {
            response.body.pipe(fileStream);
            response.body.on("error", reject);
            fileStream.on("finish", resolve);
        });

        console.log("Write successfully, idling")

    } catch (ex) {
        console.error(ex);
    }

    return { path: downloadPath, version: package.version };
}

async function getUpdatePacket(currentVersion, url) {
    if (!url || !compareVersions.validate(currentVersion)) return;

    let response;
    try {
        response = await fetch(url, {
            headers: {
                'Content-Type': 'application/json'
            }
        });
    } catch (ex) {
        console.error(ex);
    }

    if (!response || !response.ok) return;

    const json = await response.json();
    const history = json.history;

    if (!history || !Array.isArray(history) || history.length <= 0 || history.name) return;

    const sortedHistory = history
        .map(validateRelease).filter(Boolean)
        .sort((a, b) => compareVersions(a.version, b.version));
    
    const mandatoryHistory = sortedHistory
        .filter(release => release.isMandatory)
    
    const latestRelease = sortedHistory[sortedHistory.length - 1];
    const latestMandatoryRelease = mandatoryHistory[mandatoryHistory.length - 1];

    const isStoreTarget = checkIfStoreTarget();
    const isUpdateAble = !isStoreTarget && !process.env.PORTABLE_EXECUTABLE_DIR;

    const isUpdate = isUpdateAble && compareVersions.compare(latestRelease.version, currentVersion, '>');
    const isMandatoryUpdate = isStoreTarget && latestMandatoryRelease && compareVersions.compare(latestMandatoryRelease.version, currentVersion, '>')

    let updatePackage;

    if (isUpdate) updatePackage = latestRelease;
    else if (isMandatoryUpdate) updatePackage = latestMandatoryRelease;

    // TODO: Add option to switch to pre-release update channel
    if (!updatePackage || updatePackage.skipUpdate || updatePackage.isPrerelease) return;

    const file = updatePackage.files[process.platform];
    if (!file) return;

    updatePackage.appName = json.name;
    updatePackage.targetFile = file;
    return updatePackage;
}

function validateRelease(release) {
    if (!release) return false;

    const version = release.version;
    const files = release.files;

    if (!version || !files ||
        !compareVersions.validate(version) ||
        !(files instanceof Object) || files.length <= 0)
        return false;

    release = _.defaultsDeep(release, {
        staggering: "100%",
        isPrerelease: false,
        isMandatory: false,
        skipUpdate: false,
    });

    release.isPrerelease = String(release.isPrerelease).toLowerCase() == "true";
    release.isMandatory = String(release.isMandatory).toLowerCase() == "true";
    release.staggering = parseFloat(release.staggering);

    release.skipUpdate = release.skipUpdate || release.staggering.isNaN || release.staggering < 0 || release.staggering > 100;

    if (!release.skipUpdate) release.skipUpdate = Math.random() > release.staggering / 100;

    return release;
}

function checkIfStoreTarget() {
    if (process.windowsStore || process.mas) return true;

    if (process.platform === 'linux') {
        var restrictedDirs = ['/bin', '/usr', '/lib', '/lib64'];
        for (var i = 0; i < restrictedDirs.length; i++) {
            if (__dirname.startsWith(restrictedDirs[i])) return true;
        }
    }

    return false;
}

module.exports = {
    isStoreTarget: checkIfStoreTarget,
    getUpdatePacket,
    downloadUpdate,
    runUpdater
}