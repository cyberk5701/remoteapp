const { app, BrowserWindow, ipcMain, desktopCapturer, screen } = require('electron');
const path = require('path');
const robot = require('robotjs');

robot.setMouseDelay(1);
robot.setKeyboardDelay(1)
function createWindow() {
  const win = new BrowserWindow({
    width: 1000,
    height: 700,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Load React (Dev mode)
  win.loadURL('http://localhost:3000');
}

app.whenReady().then(createWindow);

// --- IPC HANDLERS ---

//Get screen list
ipcMain.handle('get-screen-sources', async () => {
  const inputSources = await desktopCapturer.getSources({
    types: ['window', 'screen'],
    thumbnailSize: { width: 300, height: 300 }
  });
  return inputSources.map(source => ({
    id: source.id,
    name: source.name,
    thumbnail: source.thumbnail.toDataURL()
  }));
});

// 3. (MỚI) Hứng sự kiện set-source để tránh lỗi từ App.js
ipcMain.on('set-source', (event, sourceId) => {
  // Hiện tại ta chưa cần xử lý logic phức tạp ở đây
  // Mặc định RobotJS sẽ luôn điều khiển màn hình chính (Primary)
});
//Xử lý cửa sổ ứng dụng
ipcMain.on('resize-window', (event, mode) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return;

  if (mode === 'mini') {
    // Chế độ mini: Nhỏ gọn, nằm góc phải dưới, luôn nổi lên trên
    win.setSize(350, 100); // Kích thước bé xíu
    win.setAlwaysOnTop(true, 'screen-saver'); // Luôn nổi

    // Tính toán vị trí góc phải dưới màn hình
    const primaryDisplay = screen.getPrimaryDisplay();
    const { workArea } = primaryDisplay;
    win.setPosition(workArea.width - 370, workArea.height - 120);
  } else if (mode === 'fullscreen') {
    // CLIENT: Phóng to toàn màn hình
    win.setAlwaysOnTop(false);
    win.setFullScreen(true);

  } else if (mode === 'restore') {
    win.setAlwaysOnTop(false);
    win.setFullScreen(false);
    win.setSize(1000, 700);
    win.center(); // Ra giữa màn hình
    win.blur();
    setTimeout(() => {
      win.show();
      win.focus();
    }, 100);
  }
});

//Xử lý remote
ipcMain.on('control-input', (event, data) => {
  try {
    const command = JSON.parse(data);

    if (command.type.startsWith('mouse') || command.type === 'scroll') { // [UPDATE] Thêm check scroll
      const primaryDisplay = screen.getPrimaryDisplay();
      const { width, height } = primaryDisplay.size;
      const scaleFactor = primaryDisplay.scaleFactor || 1;

      if (command.type === 'mousemove' || command.type === 'mousedown' || command.type === 'mouseup') {
        const x = Math.round(command.xPercent * width * scaleFactor);
        const y = Math.round(command.yPercent * height * scaleFactor);

        if (command.type === 'mousemove') {
          robot.moveMouse(x, y);
        }
        if (command.type === 'mousedown') {
          robot.mouseToggle('down', command.button);
        }
        if (command.type === 'mouseup') {
          robot.mouseToggle('up', command.button);
        }
      }

      // [UPDATE] XỬ LÝ CUỘN CHUỘT
      if (command.type === 'scroll') {
        // deltaY từ trình duyệt thường là 100 (xuống) hoặc -100 (lên)
        // RobotJS cần số nhỏ hơn (số dòng cuộn)
        // Chia cho 20 để giảm tốc độ cuộn cho mượt
        const scrollX = command.deltaX / 20;
        const scrollY = command.deltaY / 20;

        // RobotJS scrollMouse(magnitudeX, magnitudeY)
        robot.scrollMouse(scrollX, scrollY);
        console.log(`scrollMouse(${scrollX}, ${scrollY})`)
      }
    }

    if (command.type === 'keydown') {
      robot.keyToggle(command.key, 'down');
    }

    if (command.type === 'keyup') {
      robot.keyToggle(command.key, 'up');
    }

  } catch (error) {
    console.error("Lỗi RobotJS:", error);
  }
});