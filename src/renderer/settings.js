let channels = [];
let settings = {};

// 初始化
async function init() {
  await loadData();
  renderChannels();
  updateToggles();
  setupEventListeners();
  await loadVersionInfo();
}

// 加载数据
async function loadData() {
  channels = await window.api.getChannels();
  settings = await window.api.getSettings();
}

// 渲染频道列表
function renderChannels() {
  const listEl = document.getElementById('channelList');

  if (channels.length === 0) {
    listEl.innerHTML = `
      <div class="empty-channels">
        暂无订阅频道
      </div>
    `;
    return;
  }

  listEl.innerHTML = channels.map(channel => `
    <div class="channel-item">
      <div class="channel-info">
        <div class="channel-name">${escapeHtml(channel.name)}</div>
        <div class="channel-url">${escapeHtml(channel.url)}</div>
      </div>
      <button class="remove-btn" data-id="${channel.id}">删除</button>
    </div>
  `).join('');

  // 添加删除按钮事件
  listEl.querySelectorAll('.remove-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.id;
      channels = await window.api.removeChannel(id);
      renderChannels();
    });
  });
}

// 更新开关状态
function updateToggles() {
  const soundToggle = document.getElementById('soundToggle');
  const hideReadToggle = document.getElementById('hideReadToggle');

  if (settings.soundEnabled) {
    soundToggle.classList.add('active');
  } else {
    soundToggle.classList.remove('active');
  }

  if (settings.hideRead) {
    hideReadToggle.classList.add('active');
  } else {
    hideReadToggle.classList.remove('active');
  }
}

// 设置事件监听
function setupEventListeners() {
  // 关闭按钮
  document.getElementById('closeBtn').addEventListener('click', () => {
    window.api.closeWindow();
  });

  // 添加频道按钮
  document.getElementById('addChannelBtn').addEventListener('click', async () => {
    const nameInput = document.getElementById('channelName');
    const urlInput = document.getElementById('channelUrl');

    const name = nameInput.value.trim();
    const url = urlInput.value.trim();

    if (!url) {
      alert('请输入频道地址');
      return;
    }

    channels = await window.api.addChannel(name || url, url);
    renderChannels();

    // 清空输入框
    nameInput.value = '';
    urlInput.value = '';
  });

  // 声音开关
  document.getElementById('soundToggle').addEventListener('click', async () => {
    settings.soundEnabled = !settings.soundEnabled;
    await window.api.updateSettings(settings);
    updateToggles();
  });

  // 隐藏已读开关
  document.getElementById('hideReadToggle').addEventListener('click', async () => {
    settings.hideRead = !settings.hideRead;
    await window.api.updateSettings(settings);
    updateToggles();
  });
}

// HTML 转义
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// 加载版本信息
async function loadVersionInfo() {
  const version = await window.api.getAppVersion();
  document.getElementById('currentVersion').textContent = `v${version}`;

  // 检查更新
  document.getElementById('checkUpdateBtn').addEventListener('click', async () => {
    const statusEl = document.getElementById('updateStatus');
    const downloadBtn = document.getElementById('downloadUpdateBtn');
    const checkBtn = document.getElementById('checkUpdateBtn');

    statusEl.textContent = '正在检查...';
    statusEl.style.color = '#666';
    checkBtn.disabled = true;

    try {
      const result = await window.api.checkForUpdate();

      if (result.error) {
        const errors = {
          repository_not_configured: '未配置 GitHub 仓库',
          no_releases: '暂无发布版本',
          rate_limited: 'GitHub API 限流，稍后再试',
          no_asar_asset: '发布中未包含 app.asar',
          network_error: '网络连接失败'
        };
        statusEl.textContent = errors[result.error] || `检查失败: ${result.error}`;
        statusEl.style.color = '#FF3B30';
      } else if (result.updateAvailable) {
        statusEl.textContent = `发现新版本: v${result.latestVersion}`;
        statusEl.style.color = '#34C759';
        downloadBtn.style.display = 'block';
      } else {
        statusEl.textContent = '已是最新版本';
        statusEl.style.color = '#34C759';
      }
    } catch {
      statusEl.textContent = '检查失败';
      statusEl.style.color = '#FF3B30';
    }

    checkBtn.disabled = false;
  });

  // 下载更新
  document.getElementById('downloadUpdateBtn').addEventListener('click', async () => {
    const statusEl = document.getElementById('updateStatus');
    const downloadBtn = document.getElementById('downloadUpdateBtn');
    const progressEl = document.getElementById('updateProgress');
    const applyBtn = document.getElementById('applyUpdateBtn');

    downloadBtn.style.display = 'none';
    progressEl.style.display = 'block';
    statusEl.textContent = '正在下载...';

    try {
      const result = await window.api.downloadUpdate();

      if (result.success) {
        progressEl.style.display = 'none';
        statusEl.textContent = '下载完成，点击安装并重启';
        applyBtn.style.display = 'block';
      } else {
        statusEl.textContent = `下载失败: ${result.error}`;
        statusEl.style.color = '#FF3B30';
        downloadBtn.style.display = 'block';
        progressEl.style.display = 'none';
      }
    } catch {
      statusEl.textContent = '下载失败';
      statusEl.style.color = '#FF3B30';
      downloadBtn.style.display = 'block';
      progressEl.style.display = 'none';
    }
  });

  // 安装更新
  document.getElementById('applyUpdateBtn').addEventListener('click', async () => {
    const statusEl = document.getElementById('updateStatus');
    statusEl.textContent = '正在安装，即将重启...';
    try {
      await window.api.applyUpdate();
    } catch {
      statusEl.textContent = '安装失败，请重试';
      statusEl.style.color = '#FF3B30';
    }
  });

  // 下载进度
  window.api.onUpdateDownloadProgress((progress) => {
    const bar = document.getElementById('updateProgressBar');
    const text = document.getElementById('updateProgressText');
    if (bar && text) {
      bar.style.width = `${progress}%`;
      text.textContent = `${Math.round(progress)}%`;
    }
  });
}

// 启动应用
init();
