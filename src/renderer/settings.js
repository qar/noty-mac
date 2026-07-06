let channels = [];
let settings = {};

// 初始化
async function init() {
  await loadData();
  renderChannels();
  updateToggles();
  setupEventListeners();
  await loadVersionInfo();
  await renderIntegration();
  setupIntegrationEvents();
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
    statusEl.style.color = '#666';
    try {
      const result = await window.api.applyUpdate();
      if (result?.success) {
        statusEl.textContent = '安装完成，应用即将重启...';
        statusEl.style.color = '#34C759';
      } else {
        const errors = {
          no_staged_update: '未找到已下载的更新',
          read_only_volume: '安装位置不可写，请将 Noty 拖到 /Applications 后重试'
        };
        statusEl.textContent = errors[result?.error] || `安装失败: ${result?.error || '未知错误'}`;
        statusEl.style.color = '#FF3B30';
      }
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

// ---------------------------------------------------------------
// AI 集成 wizard (Settings > AI 集成)
//
// Read-only detection + copy-to-clipboard. Never writes to
// ~/.local/bin/ or ~/.claude/; Noty policy — see docs/agent-status.md
// and the red line in docs/workspace-mvp.md §11.
// ---------------------------------------------------------------

async function renderIntegration() {
  if (!window.api?.integration) return;
  let data;
  try {
    data = await window.api.integration.detect();
  } catch (err) {
    console.error('[settings] integration.detect failed:', err);
    return;
  }

  const cmdEl = document.getElementById('integrationInstallCmd');
  if (cmdEl) {
    cmdEl.textContent = data.installCommand;
    cmdEl.dataset.copyText = data.installCommand;
  }

  const snippetEl = document.getElementById('integrationSnippet');
  if (snippetEl) {
    snippetEl.textContent = data.snippet || '（未找到片段模板）';
    snippetEl.dataset.copyText = data.snippet || '';
  }

  const installStatus = document.getElementById('integrationInstallStatus');
  if (installStatus) {
    const { at, isOurs } = data.installed;
    installStatus.className = 'integration-status';
    const dot = '<span class="status-dot"></span>';
    if (at && isOurs) {
      installStatus.classList.add('is-ok');
      installStatus.innerHTML =
        dot + '已安装 · <span class="status-path">' + escapeHtml(at) + '</span>';
    } else if (at) {
      installStatus.classList.add('is-warn');
      installStatus.innerHTML =
        dot + '已存在其他 <code>noty-status</code> · <span class="status-path">' +
        escapeHtml(at) + '</span>（可能是你自定义的版本）';
    } else {
      installStatus.classList.add('is-missing');
      installStatus.innerHTML = dot + '未检测到 · 执行上面的命令来安装';
    }
  }

  const claudeStatus = document.getElementById('integrationClaudeStatus');
  if (claudeStatus) {
    const dot = '<span class="status-dot"></span>';
    const { path, exists, snippetInstalled } = data.claudeMd;
    claudeStatus.className = 'integration-status';
    if (snippetInstalled) {
      claudeStatus.classList.add('is-ok');
      claudeStatus.innerHTML =
        dot + '已追加到 <span class="status-path">' + escapeHtml(path) + '</span>';
    } else if (exists) {
      claudeStatus.classList.add('is-warn');
      claudeStatus.innerHTML =
        dot + 'CLAUDE.md 存在，但未找到 <code>&lt;!-- BEGIN NOTY-STATUS --&gt;</code> 标记';
    } else {
      claudeStatus.classList.add('is-missing');
      claudeStatus.innerHTML =
        dot + '未检测到 <span class="status-path">' + escapeHtml(path) + '</span>';
    }
  }
}

function setupIntegrationEvents() {
  if (!window.api?.integration) return;

  document.querySelectorAll('.copy-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const targetId = btn.getAttribute('data-copy-target');
      if (!targetId) return;
      const target = document.getElementById(targetId);
      const text = target?.dataset.copyText || target?.textContent || '';
      if (!text) return;

      const ok = await window.api.integration.copy(text);
      const orig = btn.textContent;
      btn.textContent = ok ? '已复制' : '失败';
      btn.classList.add('is-copied');
      setTimeout(() => {
        btn.textContent = orig;
        btn.classList.remove('is-copied');
      }, 1500);
    });
  });

  const openBtn = document.getElementById('openClaudeDirBtn');
  openBtn?.addEventListener('click', async () => {
    const result = await window.api.integration.openClaudeDir();
    if (!result?.opened) {
      alert(
        '无法打开 ~/.claude/：' + (result?.reason || '目录可能不存在') +
        '\n\n提示：先在终端里 `mkdir -p ~/.claude` 或启动一次 Claude Code 让它自动创建。'
      );
    }
  });

  // Re-detect when the window regains focus (user just pasted the install
  // command in a terminal and switched back).
  window.addEventListener('focus', () => {
    void renderIntegration();
  });
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
