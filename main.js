const {app, dialog, Menu, Tray, BrowserWindow, ipcMain, clipboard, Notification} = require('electron');
const path = require('path');
const crypto = require('crypto-js');
const base32 = require('thirty-two');
const fs = require('fs');

let tray = null;
let listWindow = null;
const userDataPath = app.getPath('userData');
const configFilePath = path.join(userDataPath, 'config.json');

// ---------------------------------------
// Utility Functions
// ---------------------------------------

function hmacSha1(key, value) {
    const keyB = crypto.enc.Hex.parse(key.toString('hex'));
    const valueB = crypto.enc.Hex.parse(value.toString('hex'));
    const hash = crypto.HmacSHA1(valueB, keyB).toString(crypto.enc.Hex);
    return Buffer.from(hash, 'hex');
}

function generateTOTP(secret, time) {
    const key = base32.decode(secret);
    const value = Buffer.alloc(8);
    value.writeBigInt64BE(BigInt(Math.floor(time / 30)), 0);

    const hash = hmacSha1(key, value);
    const offset = hash[hash.length - 1] & 0xf;

    const binary =
        ((hash[offset] & 0x7f) << 24) |
        ((hash[offset + 1] & 0xff) << 16) |
        ((hash[offset + 2] & 0xff) << 8) |
        (hash[offset + 3] & 0xff);

    return binary % 1000000;
}

function getCode(secret) {
    const time = Math.floor(new Date().getTime() / 1000);
    const code = generateTOTP(secret, time);
    return ("000000" + code).slice(-6);
}

// ---------------------------------------
// Configuration Handling
// ---------------------------------------

function checkConfigFile() {
    if (!fs.existsSync(configFilePath)) {
        const result = dialog.showMessageBoxSync({
            type: 'question',
            buttons: ['Yes', 'No'],
            defaultId: 0,
            title: 'Configuration',
            message: 'Configuration file not found. Create a new one?'
        });
        if (result === 0) createConfigFile();
        loadConfig();
    }
}

function createConfigFile() {
    const initialConfig = [];
    try {
        fs.writeFileSync(configFilePath, JSON.stringify(initialConfig));
    } catch (error) {
        console.error('Failed to create config file:', error);
    }
}

function loadConfig() {
    let storedConfigs;
    try {
        const fileContent = fs.readFileSync(configFilePath, 'utf8');
        storedConfigs = JSON.parse(fileContent) || [];
    } catch (error) {
        console.error('Failed to read config file:', error);
        storedConfigs = [];
    }

    const contextMenuTemplate = storedConfigs.map(config => ({
        label: config.label,
        click: () => {
            const code = getCode(config.secret);
            clipboard.writeText(code);
            showNotificationWithLabel(config.label, code);
            // console.log("Copied to clipboard:", code);
        }
    }));

    contextMenuTemplate.push(
        {label: 'Show All', click: createListWindow},
        {label: 'Exit', click: app.quit}
    );

    tray.setContextMenu(Menu.buildFromTemplate(contextMenuTemplate));
}

function showNotificationWithLabel(label, message) {
    const notification = {
        title: 'My App',
        body: label + " OTP: " + message,
        silent: false // 是否静音
    }
    new Notification(notification).show();
}

function showNotification(message) {
    const notification = {
        title: 'My App',
        body: "OTP: " + message,
        silent: false // 是否静音
    }
    new Notification(notification).show();
}

// ---------------------------------------
// Window Management
// ---------------------------------------

function createListWindow() {
    if (listWindow) {
        listWindow.focus();
        return;
    }

    listWindow = new BrowserWindow({
        width: 900,
        height: 500,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        }
    });
    listWindow.loadFile('list.html');
    listWindow.on('closed', () => listWindow = null);
}

// ---------------------------------------
// Event Handlers
// ---------------------------------------

ipcMain.on('request-config-list', event => {
    const storedConfigs = JSON.parse(fs.readFileSync(configFilePath));
    event.reply('config-list', storedConfigs);
});

ipcMain.on('add-config', (event, config) => {
    let storedConfigs = [];
    if (fs.existsSync(configFilePath)) {
        storedConfigs = JSON.parse(fs.readFileSync(configFilePath));
    }
    // 检查是否存在具有相同标签的配置
    if (storedConfigs.some(storedConfig => storedConfig.label === config.label)) {
        event.reply('add-config-error', 'A config with this label already exists');
    } else {
        storedConfigs.push(config);
        fs.writeFileSync(configFilePath, JSON.stringify(storedConfigs));
        loadConfig();  // 重新加载配置
        event.reply('config-list', storedConfigs);
        event.reply('add-condif', 'Add config successfully.');
    }
});

ipcMain.on('update-config', (event, data) => {
    let storedConfigs = JSON.parse(fs.readFileSync(configFilePath));
    const index = storedConfigs.findIndex(config => config.label === data.oldLabel);
    console.log(JSON.stringify(data));
    if (index !== -1) {
        storedConfigs[index] = {label: data.newLabel, secret: data.newSecret};
        fs.writeFileSync(configFilePath, JSON.stringify(storedConfigs));
        loadConfig();
    }
    event.reply('update-condif', 'Update config successfully.');
});

ipcMain.on('delete-config', (event, label) => {
    let storedConfigs = JSON.parse(fs.readFileSync(configFilePath));

    // 根据传入的label找到并删除配置
    const index = storedConfigs.findIndex(config => config.label === label);
    if (index !== -1) {
        storedConfigs.splice(index, 1);
        fs.writeFileSync(configFilePath, JSON.stringify(storedConfigs));
        loadConfig();
        // 重新加载配置
        event.reply('config-list', storedConfigs);
    }
    event.reply('delete-config-reply', 'Config deleted successfully.');
});

ipcMain.on('get-code', (event, labelToGetCode) => {
    const code = getCode(labelToGetCode);
    clipboard.writeText(code);
    event.reply('get-code', 'Get code successfully.');
    showNotification(code);
});

// ---------------------------------------
// App Lifecycle Events
// ---------------------------------------

app.whenReady().then(() => {
    tray = new Tray(path.join(__dirname, 'loadingTemplate.png'));
    checkConfigFile();
    loadConfig();
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});

if (process.platform === 'darwin') app.dock.hide();

