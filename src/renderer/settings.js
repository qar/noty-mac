let channels = [];
let settings = {};

// 初始化
async function init() {
  await loadData();
  renderChannels();
  updateToggles();
  setupEventListeners();
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

// 启动应用
init();
