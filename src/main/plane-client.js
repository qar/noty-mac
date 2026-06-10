const { EventEmitter } = require('events');
const { Notification, safeStorage } = require('electron');
const store = require('./store');
const crypto = require('crypto');

// ---- 限速与轮询常量 ----
const MIN_REQUEST_SPACING_MS = 1100;   // ~54 req/min 上限（API 硬限 60/min）
const DEFAULT_POLL_INTERVAL_MS = 90000;
const MAX_PROJECTS_PER_CYCLE = 20;     // 项目多时 round-robin
const MAX_PAGES_PER_PROJECT = 2;       // 常规轮询每项目最多翻 2 页（按 -updated_at，最近改动总在前）
const MAX_BASELINE_PAGES = 30;         // 基线阶段完整翻页上限（覆盖窗口外的老任务，避免诈和成新分配）
const PER_PAGE = 100;
const MAX_COMMENT_FETCHES_PER_CYCLE = 15;
const KNOWN_COMMENT_CAP = 200;
const BACKOFF_MIN_MS = 30000;
const BACKOFF_MAX_MS = 300000;
// 基线算法版本：升级此值会在下次轮询时丢弃旧 planeState 并重新做一次完整静默基线
const BASELINE_VERSION = 2;

function generateId() {
  return crypto.randomBytes(16).toString('hex');
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ---- 密钥加解密（Electron safeStorage，无原生依赖）----
function encryptApiKey(plain) {
  if (!plain) return '';
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('encryption_unavailable');
  }
  return safeStorage.encryptString(plain).toString('base64');
}

function decryptApiKey(enc) {
  if (!enc) return null;
  try {
    if (!safeStorage.isEncryptionAvailable()) return null;
    return safeStorage.decryptString(Buffer.from(enc, 'base64'));
  } catch (e) {
    // asar 自更新后 keychain 可能失效，吞掉错误让上层提示重填
    return null;
  }
}

// key 指纹：仅用于诊断日志，不泄露完整 key
function fingerprintKey(key) {
  if (!key || typeof key !== 'string') return 'none';
  if (key.length <= 18) return `len=${key.length}`;
  return `len=${key.length} ${key.slice(0, 14)}…${key.slice(-4)}`;
}

// ---- 各类提醒的展示文案（中文，匹配 app UI）----
const KIND_LABEL = {
  assigned: '🆕 新分配给你',
  created: '🆕 你创建的任务有更新',
  state: '🔄 状态变更',
  comment: '💬 新评论',
  mention: '📌 有人 @ 了你',
  updated: '✏️ 任务已更新'
};

// 从工作项中稳健提取 assignee id 列表（可能是 UUID 字符串或对象）
function extractAssigneeIds(wi) {
  const list = wi.assignees || wi.assignee_ids || [];
  if (!Array.isArray(list)) return [];
  return list
    .map(a => (typeof a === 'string' ? a : (a && (a.id || a.member || a.assignee || a.user))))
    .filter(Boolean)
    .map(String);
}

// 提取数组型/分页型响应中的条目
function asResults(body) {
  if (Array.isArray(body)) return body;
  if (body && Array.isArray(body.results)) return body.results;
  return [];
}

// 提取成员的 email 与 user id（不同 Plane 版本字段嵌套不一）
function extractMember(m) {
  const member = m.member || m.user || m;
  const id = member.id || m.member_id || m.id;
  const email = member.email || m.email;
  const name = member.display_name || member.first_name || member.email || m.email;
  return { id: id ? String(id) : null, email: email ? String(email) : null, name };
}

class PlaneClient extends EventEmitter {
  constructor() {
    super();
    this._timer = null;
    this._inFlight = false;
    this._lastRequestAt = 0;
    this._backoffUntil = 0;
    this._consecutiveFailures = 0;
    this._identityWarned = false;
    this._projectCursor = 0; // round-robin 起点
  }

  get isRunning() {
    return this._timer !== null;
  }

  start() {
    this.stop();
    this._backoffUntil = 0;
    this._consecutiveFailures = 0;
    this._identityWarned = false;
    const cfg = store.get('planeConfig');
    const interval = cfg.pollIntervalMs || DEFAULT_POLL_INTERVAL_MS;
    // 立即跑一轮，然后定时
    this.poll();
    this._timer = setInterval(() => this.poll(), interval);
  }

  stop() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
  }

  // ---- 请求层：统一节流 + 429/退避 ----
  async _throttle() {
    const since = Date.now() - this._lastRequestAt;
    if (since < MIN_REQUEST_SPACING_MS) {
      await delay(MIN_REQUEST_SPACING_MS - since);
    }
    this._lastRequestAt = Date.now();
  }

  async request(ctx, path, searchParams) {
    await this._throttle();
    let url = `${ctx.baseUrl}/api/v1/${path}`;
    if (searchParams) {
      const qs = new URLSearchParams(searchParams).toString();
      if (qs) url += `?${qs}`;
    }

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'X-API-Key': ctx.apiKey,
        'Accept': 'application/json'
      }
    });

    if (response.status === 429) {
      const retryAfter = Number(response.headers.get('Retry-After')) || 60;
      this._backoffUntil = Date.now() + retryAfter * 1000;
      const err = new Error('rate_limited');
      err.code = 'rate_limited';
      throw err;
    }

    if (response.status === 401 || response.status === 403) {
      console.error(`[plane] auth ${response.status}: GET ${url} (key fp ${fingerprintKey(ctx.apiKey)})`);
      const err = new Error('auth_failed');
      err.code = 'auth_failed';
      throw err;
    }

    if (!response.ok) {
      console.error(`[plane] http ${response.status}: GET ${url}`);
      const err = new Error(`http_${response.status}`);
      err.code = `http_${response.status}`;
      throw err;
    }

    return response.json();
  }

  _ctx(cfg, apiKeyPlain) {
    return {
      baseUrl: (cfg.baseUrl || '').replace(/\/+$/, ''),
      slug: cfg.workspaceSlug,
      apiKey: apiKeyPlain
    };
  }

  // ---- 身份解析：邮箱 → 用户 UUID ----
  async resolveUserId(ctx, email) {
    const body = await this.request(ctx, `workspaces/${ctx.slug}/members/`);
    const members = asResults(body).map(extractMember);
    const target = (email || '').trim().toLowerCase();
    const match = members.find(m => m.email && m.email.toLowerCase() === target);
    return match ? { id: match.id, name: match.name } : null;
  }

  // 给 IPC test-plane-connection 用：可传入明文 key（尚未保存时）
  async testConnection(cfg, apiKeyPlain) {
    const apiKey = apiKeyPlain || decryptApiKey(cfg.apiKeyEnc);
    if (!apiKey) return { success: false, error: 'no_api_key' };
    if (!cfg.baseUrl || !cfg.workspaceSlug || !cfg.email) {
      return { success: false, error: 'missing_fields' };
    }
    const ctx = this._ctx(cfg, apiKey);
    try {
      const match = await this.resolveUserId(ctx, cfg.email);
      if (!match) return { success: false, error: 'email_not_found' };
      return { success: true, userId: match.id, memberName: match.name };
    } catch (e) {
      return { success: false, error: e.code || 'network_error' };
    }
  }

  // ---- 数据拉取 ----
  async listProjects(ctx) {
    const body = await this.request(ctx, `workspaces/${ctx.slug}/projects/`);
    return asResults(body).map(p => ({
      id: String(p.id),
      identifier: p.identifier || '',
      name: p.name || '',
      // 工作区会返回你不是成员的项目，但列其 work-items 会 403；据此过滤
      isMember: p.is_member
    }));
  }

  async listWorkItems(ctx, projectId, maxPages = MAX_PAGES_PER_PROJECT) {
    const items = [];
    let cursor = null;
    let truncated = false;
    for (let page = 0; page < maxPages; page++) {
      const params = {
        expand: 'assignees,state',
        order_by: '-updated_at',
        per_page: String(PER_PAGE)
      };
      if (cursor) params.cursor = cursor;
      const body = await this.request(ctx, `workspaces/${ctx.slug}/projects/${projectId}/work-items/`, params);
      items.push(...asResults(body));
      const hasMore = body && body.next_page_results;
      cursor = body && body.next_cursor;
      if (!hasMore || !cursor) break;
      if (page === maxPages - 1) truncated = true;
    }
    if (truncated) {
      console.warn(`[plane] 项目 ${projectId} 翻页达上限 ${maxPages}，超出部分本轮未覆盖`);
    }
    return items;
  }

  async listComments(ctx, projectId, workItemId) {
    const body = await this.request(ctx, `workspaces/${ctx.slug}/projects/${projectId}/work-items/${workItemId}/comments/`);
    return asResults(body);
  }

  // ---- @ 提及检测：先取出每个 mention 标签，再在标签内查指定属性 ----
  // 不用惰性单属性匹配（会错选标签自身的 id），也不裸匹配 id（mention-component 的 id 是组件自身 id）。
  _htmlMentionsUser(html, userId) {
    if (!html || typeof html !== 'string' || !userId) return false;
    // mention 专用的身份属性（明确排除裸 id）
    const idAttr = /\b(?:entity_identifier|data-entity_identifier|data-mention-id|data-user-id|data-id)\s*=\s*["']([^"']+)["']/gi;
    // 收集所有 mention 标签（自定义组件或带 mention class 的 <a>）
    const tagRe = /<(?:mention-component|a)\b[^>]*>/gi;
    let tag;
    while ((tag = tagRe.exec(html)) !== null) {
      const tagStr = tag[0];
      // <a> 仅当带 mention class 时才算提及
      if (/^<a\b/i.test(tagStr) && !/class=["'][^"']*\bmention\b[^"']*["']/i.test(tagStr)) {
        continue;
      }
      idAttr.lastIndex = 0;
      let a;
      while ((a = idAttr.exec(tagStr)) !== null) {
        if (a[1] === userId) return true;
      }
    }
    return false;
  }

  // 自部署网页可点链接（按 identifier，非 UUID）。形态需用真实实例「复制链接」核对。
  buildWorkItemUrl(ctx, project, wi) {
    const human = project.identifier && (wi.sequence_id !== undefined && wi.sequence_id !== null)
      ? `${project.identifier}-${wi.sequence_id}`
      : wi.id;
    return `${ctx.baseUrl}/${ctx.slug}/browse/${human}/`;
  }

  // round-robin 选取项目，避免大工作区单轮超限
  _selectProjects(projects) {
    if (projects.length <= MAX_PROJECTS_PER_CYCLE) return projects;
    const start = this._projectCursor % projects.length;
    const slice = [];
    for (let i = 0; i < MAX_PROJECTS_PER_CYCLE; i++) {
      slice.push(projects[(start + i) % projects.length]);
    }
    this._projectCursor = (start + MAX_PROJECTS_PER_CYCLE) % projects.length;
    return slice;
  }

  // ---- 主轮询 ----
  async poll() {
    if (this._inFlight) return;
    if (Date.now() < this._backoffUntil) return;

    const cfg = store.get('planeConfig');
    if (!cfg.enabled || !cfg.baseUrl || !cfg.workspaceSlug || !cfg.email || !cfg.apiKeyEnc) {
      return;
    }

    const apiKey = decryptApiKey(cfg.apiKeyEnc);
    if (!apiKey) {
      this._warnOnce('Plane: API Key 解密失败，请在设置中重新填写并保存');
      return;
    }

    this._inFlight = true;
    try {
      const ctx = this._ctx(cfg, apiKey);

      let userId = cfg.resolvedUserId;
      if (!userId) {
        const match = await this.resolveUserId(ctx, cfg.email);
        if (!match) {
          this._warnOnce('Plane: 邮箱未匹配到工作区成员，请检查设置');
          return;
        }
        userId = match.id;
        // 重新读取最新配置，避免覆盖轮询期间用户刚保存的修改；身份字段变化则不写回
        const fresh = store.get('planeConfig');
        if (fresh.baseUrl === cfg.baseUrl && fresh.workspaceSlug === cfg.workspaceSlug && fresh.email === cfg.email) {
          store.set('planeConfig', { ...fresh, resolvedUserId: userId });
        }
      }

      await this.runCycle(ctx, userId);
      this._consecutiveFailures = 0;
    } catch (e) {
      this._handleCycleError(e);
    } finally {
      this._inFlight = false;
    }
  }

  _handleCycleError(e) {
    if (e && e.code === 'rate_limited') {
      // _backoffUntil 已在 request 中设置
      console.warn('Plane 轮询限速，已退避');
      return;
    }
    this._consecutiveFailures += 1;
    const backoff = Math.min(BACKOFF_MIN_MS * Math.pow(2, this._consecutiveFailures - 1), BACKOFF_MAX_MS);
    this._backoffUntil = Date.now() + backoff;
    console.error(`Plane 轮询失败(${e && e.code || e}), ${Math.round(backoff / 1000)}s 后重试`);
  }

  async runCycle(ctx, userId) {
    const state = store.get('planeState');

    // 基线算法升级：丢弃旧状态，重新做一次完整静默基线（修复窗口外老任务诈和）
    if (state.baselineVersion !== BASELINE_VERSION) {
      console.warn(`[plane] 基线版本变更 → 重置 planeState 并重新完整基线 (v${BASELINE_VERSION})`);
      state.items = {};
      state.baselinedProjects = {};
      state.baselineDone = false;
      state.commentScanCursor = 0;
      state.baselineVersion = BASELINE_VERSION;
    }

    const prevItems = state.items || {};
    const prevBaselined = state.baselinedProjects || {};
    const nextItems = { ...prevItems };
    const nextBaselined = { ...prevBaselined };

    const allProjects = await this.listProjects(ctx);
    // 只轮询你是成员的项目（非成员项目列 work-items 会 403）。isMember 缺失时保守保留。
    const memberProjects = allProjects.filter(p => p.isMember !== false);
    const projects = this._selectProjects(memberProjects);

    // 收集相关工作项；按「所属项目本轮之前是否已基线」决定是否静默
    const relevant = [];
    for (const project of projects) {
      const projectBaselined = !!prevBaselined[project.id];
      // 未基线的项目完整翻页（覆盖所有相关老任务）；已基线的只抓最近几页
      const maxPages = projectBaselined ? MAX_PAGES_PER_PROJECT : MAX_BASELINE_PAGES;
      let items;
      try {
        items = await this.listWorkItems(ctx, project.id, maxPages);
      } catch (e) {
        if (e && e.code === 'rate_limited') throw e; // 限速才中断整轮并退避
        // 单个项目无权访问/异常：跳过该项目，不影响其他项目
        console.warn(`[plane] 跳过项目 ${project.identifier || project.id}: ${e && e.code || e}`);
        continue;
      }
      for (const wi of items) {
        const assignees = extractAssigneeIds(wi);
        const assignedToMe = assignees.includes(userId);
        const createdByMe = wi.created_by && String(wi.created_by) === userId;
        if (assignedToMe || createdByMe) {
          const prev = prevItems[wi.id];
          const advanced = !prev
            || !prev.updatedAt
            || (wi.updated_at && new Date(wi.updated_at).getTime() > new Date(prev.updatedAt).getTime());
          relevant.push({ wi, project, assignedToMe, createdByMe, prev, projectBaselined, advanced });
        }
      }
      // 本轮已扫描该项目，标记其基线完成（即使无相关项也要标记，避免下轮重复基线）
      nextBaselined[project.id] = true;
    }

    // 评论拉取调度：与 updated_at 解耦（Plane 评论不一定 bump 工作项 updated_at）。
    // 已基线项中，优先 updated_at 前进的，其余按持久化游标轮转，整体不超配额。
    const commentTargets = this._scheduleCommentFetches(state, relevant);

    const events = [];

    for (const r of relevant) {
      const { wi, project, assignedToMe, prev, projectBaselined } = r;
      const itemBaseline = !projectBaselined; // 该项目尚未基线 → 静默收编
      const stateId = wi.state && (wi.state.id || wi.state.uuid) ? String(wi.state.id || wi.state.uuid)
        : (typeof wi.state === 'string' ? wi.state : '');
      const stateName = wi.state && wi.state.name ? wi.state.name : '';

      const cur = {
        updatedAt: wi.updated_at || '',
        stateId,
        assignedToMe,
        createdByMe: r.createdByMe,
        knownCommentIds: (prev && prev.knownCommentIds) || [],
        seenMentionCommentIds: (prev && prev.seenMentionCommentIds) || []
      };

      let firedSpecific = false;

      if (!itemBaseline) {
        if (!prev) {
          // 新出现的相关项（项目已基线 → 是真正的新任务）
          events.push(this._mkEvent(assignedToMe ? 'assigned' : 'created', ctx, r, stateName));
          firedSpecific = true;
        } else {
          // (a) 新分配给我
          if (assignedToMe && prev.assignedToMe !== true) {
            events.push(this._mkEvent('assigned', ctx, r, stateName));
            firedSpecific = true;
          }
          // (b) 状态变更（prev 无 state 记录时，转入有效 state 也算变更）
          if (stateId && stateId !== prev.stateId) {
            events.push(this._mkEvent('state', ctx, r, stateName));
            firedSpecific = true;
          }
        }
      }

      // (d)(e) 评论与 @ 提及：仅对调度选中的已基线项拉取
      if (!itemBaseline && commentTargets.has(wi.id)) {
        let comments = [];
        try {
          comments = await this.listComments(ctx, project.id, wi.id);
        } catch (e) {
          if (e && e.code === 'rate_limited') throw e; // 让上层退避
          comments = [];
        }

        // 上次见到该项的时间；早于此的评论视为历史，不提醒（含 baseline 后首次拉取）
        const prevSeenAt = prev && prev.updatedAt ? new Date(prev.updatedAt).getTime() : 0;
        const knownSet = new Set(cur.knownCommentIds);
        const seenMentions = new Set(cur.seenMentionCommentIds);

        for (const c of comments) {
          const cid = c.id ? String(c.id) : null;
          if (!cid || knownSet.has(cid)) continue;
          const ctime = c.created_at ? Date.parse(c.created_at) : 0;
          if (prevSeenAt && ctime && ctime <= prevSeenAt) continue; // 历史评论，跳过
          const authoredByMe = (c.created_by && String(c.created_by) === userId)
            || (c.actor && String(c.actor) === userId);
          if (authoredByMe) continue; // 不为自己的评论提醒
          if (this._htmlMentionsUser(c.comment_html || c.comment_stripped, userId)) {
            if (!seenMentions.has(cid)) {
              events.push(this._mkEvent('mention', ctx, r, stateName, { commentId: cid, time: c.created_at }));
              cur.seenMentionCommentIds = [...cur.seenMentionCommentIds, cid];
              seenMentions.add(cid);
            }
            // 已提醒过的提及：不再降级为普通评论
          } else {
            events.push(this._mkEvent('comment', ctx, r, stateName, { commentId: cid, time: c.created_at }));
          }
          firedSpecific = true;
        }

        // 收编当前评论 id（去重 + 截断）
        cur.knownCommentIds = [...cur.knownCommentIds, ...comments.map(c => String(c.id)).filter(Boolean)]
          .filter((v, i, arr) => arr.indexOf(v) === i)
          .slice(-KNOWN_COMMENT_CAP);
        cur.seenMentionCommentIds = cur.seenMentionCommentIds.slice(-KNOWN_COMMENT_CAP);
      }

      // (c) 泛化「已更新」：updated_at 前进且无更具体事件时才发
      if (!itemBaseline && prev && r.advanced && !firedSpecific) {
        events.push(this._mkEvent('updated', ctx, r, stateName));
      }

      nextItems[wi.id] = cur;
    }

    state.items = nextItems;
    state.baselinedProjects = nextBaselined;
    state.baselineDone = true; // 兼容旧字段
    store.set('planeState', state);

    for (const ev of events) {
      this._emitNotification(ev);
    }
  }

  // 选出本轮要拉评论的工作项 id 集合：优先 updated_at 前进者，其余按游标轮转，封顶配额。
  // 同时把游标推进写回 state（调用方负责持久化 state）。
  _scheduleCommentFetches(state, relevant) {
    const baselinedRelevant = relevant.filter(r => r.projectBaselined);
    const advanced = baselinedRelevant.filter(r => r.advanced).map(r => String(r.wi.id));
    const others = baselinedRelevant.filter(r => !r.advanced);

    const targets = new Set(advanced.slice(0, MAX_COMMENT_FETCHES_PER_CYCLE));
    let remaining = MAX_COMMENT_FETCHES_PER_CYCLE - targets.size;

    if (remaining > 0 && others.length > 0) {
      const start = (state.commentScanCursor || 0) % others.length;
      let scanned = 0;
      for (let i = 0; i < others.length && remaining > 0; i++) {
        const r = others[(start + i) % others.length];
        const id = String(r.wi.id);
        scanned++;
        if (!targets.has(id)) {
          targets.add(id);
          remaining--;
        }
      }
      state.commentScanCursor = (start + scanned) % others.length;
    }

    return targets;
  }

  _mkEvent(kind, ctx, r, stateName, extra = {}) {
    const { wi, project } = r;
    const identifier = project.identifier && (wi.sequence_id !== undefined && wi.sequence_id !== null)
      ? `${project.identifier}-${wi.sequence_id}`
      : '';
    // 含 updated_at 时间戳，避免「再次分配 / 状态 A→B→A」被历史同 key 通知永久抑制
    const stateKey = (wi.state && (wi.state.id || wi.state.uuid)) || stateName;
    let dedupKey;
    switch (kind) {
      case 'assigned': dedupKey = `assigned:${wi.id}:${wi.updated_at}`; break;
      case 'created': dedupKey = `created:${wi.id}:${wi.updated_at}`; break;
      case 'state': dedupKey = `state:${wi.id}:${stateKey}:${wi.updated_at}`; break;
      case 'comment': dedupKey = `comment:${extra.commentId}`; break;
      case 'mention': dedupKey = `mention:${extra.commentId}`; break;
      default: dedupKey = `updated:${wi.id}:${wi.updated_at}`;
    }
    return {
      kind,
      identifier,
      stateName,
      time: extra.time || wi.updated_at,
      dedupKey,
      plane: {
        workItemId: String(wi.id),
        projectId: String(project.id),
        workspaceSlug: ctx.slug,
        identifier,
        sequenceId: wi.sequence_id,
        url: this.buildWorkItemUrl(ctx, project, wi),
        kind,
        dedupKey
      },
      title: identifier ? `[${identifier}] ${wi.name || ''}`.trim() : (wi.name || 'Plane 任务'),
      name: wi.name || ''
    };
  }

  _emitNotification(ev) {
    const notifications = store.get('notifications');

    // 跨重启去重：相同 dedupKey 已存在则跳过
    if (notifications.some(n => n.metadata && n.metadata.plane && n.metadata.plane.dedupKey === ev.dedupKey)) {
      return;
    }

    let label = KIND_LABEL[ev.kind] || KIND_LABEL.updated;
    if (ev.kind === 'state' && ev.stateName) {
      label = `🔄 状态变更 → ${ev.stateName}`;
    }

    const ts = ev.time ? Date.parse(ev.time) : Date.now();
    const notification = {
      id: generateId(),
      channelId: 'plane',
      title: ev.title,
      message: `${label}\n${ev.name}`.trim(),
      timestamp: Number.isNaN(ts) ? Date.now() : ts,
      read: false,
      metadata: { plane: ev.plane }
    };

    notifications.unshift(notification);
    if (notifications.length > 1000) notifications.pop();
    store.set('notifications', notifications);

    const settings = store.get('settings');
    const systemNotification = new Notification({
      title: ev.title || 'Plane',
      subtitle: label,
      body: ev.name || label,
      silent: !settings.soundEnabled
    });
    systemNotification.on('click', () => {
      this.emit('notification-clicked', notification);
    });
    systemNotification.show();

    this.emit('notification', notification);
  }

  _warnOnce(message) {
    if (this._identityWarned) return;
    this._identityWarned = true;
    console.warn(message);
    this.emit('diagnostic', message);
  }
}

module.exports = PlaneClient;
module.exports.encryptApiKey = encryptApiKey;
module.exports.decryptApiKey = decryptApiKey;
