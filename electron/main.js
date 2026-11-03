/**
 * EVoucher X - Electron 主进程（桌面形态）
 * 复用 server/main.js 的同一本地服务，窗口加载同一 UI。
 */
const { app, BrowserWindow, Menu } = require("electron");
const path = require("path");
const { startServer, PORT } = require("../server/main.js");

let win;

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 860,
    title: "电子凭证库 · EVoucher X",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadURL(`http://localhost:${PORT}`);
}

app.whenReady().then(() => {
  startServer({
    onReady: () => {
      createWindow();
      app.on("activate", () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
      });
    },
  });

  // 菜单（对应原版 文件/编辑/视图/工具/帮助）
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      { label: "文件", submenu: [{ role: "close", label: "关闭窗口" }] },
      { label: "编辑", submenu: [{ role: "copy", label: "复制" }, { role: "paste", label: "粘贴" }] },
      { label: "视图", submenu: [{ role: "reload", label: "刷新" }, { role: "zoomIn", label: "放大" }, { role: "zoomOut", label: "缩小" }, { role: "togglefullscreen", label: "全屏" }] },
      { label: "工具", submenu: [{ role: "toggleDevTools", label: "开发者工具" }] },
      { label: "帮助", submenu: [{ label: "关于 EVoucher X", role: "about" }] },
    ])
  );
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
