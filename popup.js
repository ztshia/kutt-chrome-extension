const DEFAULT_BASE_URL = 'https://kutt.it';
const API_PATH = '/api/v2';

// DOM 元素获取
const statusEl = document.getElementById('status');
const authInfoSection = document.getElementById('auth-info');
const shortenTabSection = document.getElementById('shorten-tab');
const linksSection = document.getElementById('links');
const linksList = document.getElementById('links-list');
const noLinksMessage = document.getElementById('no-links');
const linkTemplate = document.getElementById('link-item-template');
const refreshButton = document.getElementById('refresh-links');
const shortenCurrentTabButton = document.getElementById('shorten-current-tab');
const customslugInput = document.getElementById('customslug');
const openOptionsButtons = [
  document.getElementById('open-options'),
  document.getElementById('go-to-options')
].filter(Boolean);

// 全局变量
let apiKey = null;
let baseUrl = DEFAULT_BASE_URL;
let autoCopy = true;
let autoOpenStats = false;

/**
 * 清理URL中的查询参数（?后内容）和锚点（#后内容）
 * @param {string} rawUrl 原始URL
 * @returns {string} 清理后的纯路径URL
 */
function cleanUrlParams(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return rawUrl;
  
  try {
    // 解析URL，自动分离各部分
    const urlObj = new URL(rawUrl);
    // 清空查询参数和哈希
    urlObj.search = '';
    urlObj.hash = '';
    // 返回清理后的URL
    return urlObj.toString();
  } catch (error) {
    // 若URL解析失败（如非标准格式），返回原始URL
    console.warn('URL解析失败，保留原始URL:', error);
    return rawUrl;
  }
}

/**
 * 初始化事件监听
 */
function initEventListeners() {
  // 设置页面打开按钮
  openOptionsButtons.forEach((button) => {
    button.addEventListener('click', () => {
      if (chrome.runtime.openOptionsPage) {
        chrome.runtime.openOptionsPage();
      } else {
        window.open(chrome.runtime.getURL('options.html'));
      }
    });
  });

  // 缩短当前标签页按钮（核心功能，新增URL清理逻辑）
  shortenCurrentTabButton?.addEventListener('click', async () => {
    if (!apiKey) {
      showAuthRequired();
      return;
    }

    let activeTab;
    try {
      [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    } catch (error) {
      console.error(error);
      setStatus('无法访问当前标签页。', 'error');
      return;
    }

    if (!activeTab?.url || !/^https?:/iu.test(activeTab.url)) {
      setStatus('当前标签页的URL无法缩短。', 'error');
      return;
    }

    // 核心修改：清理URL中的查询参数和锚点
    const cleanUrl = cleanUrlParams(activeTab.url);
    // 提示用户URL已清理（可选，增强交互）
    if (cleanUrl !== activeTab.url) {
      setStatus(`已自动清理URL参数：${cleanUrl}`, 'success');
    }

    // 获取自定义slug
    const customslug = customslugInput.value.trim();
    
    try {
      await createShortLink(
        { 
          target: cleanUrl, // 使用清理后的URL
          customurl: customslug 
        },
        { triggerButton: shortenCurrentTabButton }
      );
      // 清空输入框
      customslugInput.value = '';
    } catch (error) {
      // 错误会在createShortLink中通过状态消息显示
    }
  });

  // 刷新链接按钮
  refreshButton?.addEventListener('click', () => {
    loadLinks();
  });

  // 监听存储变化
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync') {
      return;
    }

    if (Object.prototype.hasOwnProperty.call(changes, 'baseUrl')) {
      baseUrl = normalizeBaseUrl(changes.baseUrl.newValue);
      if (apiKey) {
        loadLinks();
      }
    }

    if (Object.prototype.hasOwnProperty.call(changes, 'apiKey')) {
      apiKey = changes.apiKey.newValue || '';
      if (apiKey) {
        setupAuthedUI();
        loadLinks();
      } else {
        showAuthRequired();
      }
    }

    if (Object.prototype.hasOwnProperty.call(changes, 'autoCopy')) {
      autoCopy = Boolean(changes.autoCopy.newValue);
    }

    if (Object.prototype.hasOwnProperty.call(changes, 'autoOpenStats')) {
      autoOpenStats = Boolean(changes.autoOpenStats.newValue);
    }
  });
}

/**
 * 删除短链接API调用
 * @param {string} id 链接ID
 * @returns {Promise<boolean>} 删除结果
 */
async function deleteShortLink(id) {
  if (!id) {
    throw new Error('链接ID不能为空');
  }

  try {
    await apiRequest(`/links/${id}`, {
      method: 'DELETE'
    });
    return true;
  } catch (error) {
    console.error('删除链接失败', error);
    setStatus(error.message || '无法删除链接。', 'error');
    throw error;
  }
}

/**
 * 初始化插件
 */
async function init() {
  initEventListeners();
  
  const settings = await getSettings();
  apiKey = settings.apiKey;
  baseUrl = settings.baseUrl;
  autoCopy = settings.autoCopy;
  autoOpenStats = settings.autoOpenStats;

  if (!apiKey) {
    showAuthRequired();
    return;
  }

  setupAuthedUI();
  await loadLinks();
}

/**
 * 显示需要认证的界面
 */
function showAuthRequired() {
  authInfoSection.classList.remove('hidden');
  shortenTabSection.classList.add('hidden');
  linksSection.classList.add('hidden');
  setStatus('请添加API密钥以开始缩短链接。', 'error');
}

/**
 * 设置已认证的UI界面
 */
function setupAuthedUI() {
  authInfoSection.classList.add('hidden');
  shortenTabSection.classList.remove('hidden');
  linksSection.classList.remove('hidden');
  setStatus('准备就绪，输入后缀后缩短当前页。', 'success');
}

/**
 * 获取存储的设置
 * @returns {Promise<Object>} 设置对象
 */
async function getSettings() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(
      ['apiKey', 'baseUrl', 'autoCopy', 'autoOpenStats'],
      (result) => {
        resolve({
          apiKey: result.apiKey || '',
          baseUrl: normalizeBaseUrl(result.baseUrl),
          autoCopy: result.autoCopy !== undefined ? Boolean(result.autoCopy) : true,
          autoOpenStats:
            result.autoOpenStats !== undefined ? Boolean(result.autoOpenStats) : false
        });
      }
    );
  });
}

/**
 * 设置状态提示
 * @param {string} message 提示消息
 * @param {string} state 状态类型：success/error/空
 */
function setStatus(message, state = '') {
  statusEl.textContent = message || '';
  statusEl.className = state ? state : '';
}

/**
 * API请求封装
 * @param {string} path API路径
 * @param {Object} options 请求选项
 * @returns {Promise<any>} 请求结果
 */
async function apiRequest(path, options = {}) {
  if (!apiKey) {
    throw new Error('缺少API密钥');
  }

  const response = await fetch(`${getApiBaseUrl()}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'X-API-KEY': apiKey,
      ...(options.headers || {})
    }
  });

  if (!response.ok) {
    const errorText = await response.text();
    let message = '请求失败';
    try {
      const json = JSON.parse(errorText);
      message = json?.error || json?.message || message;
    } catch (err) {
      if (errorText) {
        message = errorText;
      }
    }

    if (response.status === 401) {
      showAuthRequired();
    }

    throw new Error(message);
  }

  if (response.status === 204) {
    return null;
  }

  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    return response.json();
  }
  return response.text();
}

/**
 * 加载链接列表
 * @param {Object} options 选项
 * @param {boolean} options.silent 是否静默加载（不显示状态）
 */
async function loadLinks({ silent = false } = {}) {
  if (!silent) {
    setStatus('加载链接中…');
  }
  toggleLinksLoading(true);
  try {
    const data = await apiRequest('/links?limit=20');
    renderLinks(data?.data || []);
    if (!data?.data?.length) {
      noLinksMessage.classList.remove('hidden');
    } else {
      noLinksMessage.classList.add('hidden');
    }
    if (!silent) {
      setStatus('链接已更新。', 'success');
    }
  } catch (error) {
    console.error(error);
    renderLinks([]);
    setStatus(error.message || '无法加载链接。', 'error');
  } finally {
    toggleLinksLoading(false);
  }
}

/**
 * 切换链接加载状态
 * @param {boolean} isLoading 是否加载中
 */
function toggleLinksLoading(isLoading) {
  if (!refreshButton) {
    return;
  }
  refreshButton.disabled = isLoading;
  refreshButton.textContent = isLoading ? '…' : '⟳';
}

/**
 * 渲染链接列表
 * @param {Array} links 链接数组
 */
function renderLinks(links) {
  linksList.innerHTML = '';
  links.forEach((link) => {
    const item = linkTemplate.content.firstElementChild.cloneNode(true);
    const shortLink = item.querySelector('.short-link');
    const longLink = item.querySelector('.long-link');
    const created = item.querySelector('.created');
    const copyButton = item.querySelector('.copy-button');
    const statsButton = item.querySelector('.stats-button');
    const deleteButton = item.querySelector('.delete-button');

    // 设置链接信息
    shortLink.textContent = link.link;
    shortLink.href = link.link.startsWith('http') ? link.link : `https://${link.link}`;
    longLink.textContent = link.target;
    created.textContent = formatDate(link.created_at);

    // 绑定事件
    copyButton.addEventListener('click', () => handleCopy(link.link, copyButton));
    statsButton.addEventListener('click', () => openStats(link.id, link.link));
    
    // 删除按钮事件
    deleteButton.addEventListener('click', async () => {
      if (confirm('确定要删除这个链接吗？')) {
        try {
          deleteButton.disabled = true;
          deleteButton.textContent = '删除中...';
          await deleteShortLink(link.id);
          await loadLinks();
          setStatus('链接已成功删除。', 'success');
        } finally {
          deleteButton.disabled = false;
          deleteButton.textContent = '删除';
        }
      }
    });

    linksList.appendChild(item);
  });
}

/**
 * 格式化日期为中文本地化格式
 * @param {string} dateString 日期字符串
 * @returns {string} 格式化后的日期
 */
function formatDate(dateString) {
  if (!dateString) return '';
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('zh-CN');
}

/**
 * 复制文本到剪贴板
 * @param {string} text 要复制的文本
 * @param {HTMLElement} button 触发按钮（用于状态反馈）
 * @param {Object} options 选项
 * @param {boolean} options.silent 是否静默复制（不显示状态）
 * @returns {Promise<boolean>} 复制结果
 */
async function handleCopy(text, button, options = {}) {
  const { silent = false } = options;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
    } else {
      const input = document.createElement('textarea');
      input.value = text;
      input.setAttribute('readonly', '');
      input.style.position = 'absolute';
      input.style.left = '-9999px';
      document.body.appendChild(input);
      input.select();
      document.execCommand('copy');
      document.body.removeChild(input);
    }
    if (button) {
      button.textContent = '已复制！';
      setTimeout(() => {
        button.textContent = '复制';
      }, 2000);
    }
    if (!silent) {
      setStatus('链接已复制到剪贴板。', 'success');
    }
    return true;
  } catch (error) {
    console.error(error);
    if (!silent) {
      setStatus('无法复制链接。', 'error');
    }
    return false;
  }
}

/**
 * 创建短链接（核心函数，支持自定义slug）
 * @param {Object} rawPayload 请求参数
 * @param {Object} options 选项
 * @param {HTMLElement} options.triggerButton 触发按钮
 * @returns {Promise<any>} 创建结果
 */
async function createShortLink(rawPayload, { triggerButton = null } = {}) {
  const payload = { ...rawPayload };
  if (payload.target) {
    payload.target = payload.target.toString().trim();
  }

  if (!payload.target) {
    setStatus('目标URL不能为空。', 'error');
    return null;
  }

  // 移除空值（自定义slug为空则不传递）
  Object.keys(payload).forEach((key) => {
    if (payload[key] === '') {
      delete payload[key];
    }
  });

  let originalText;
  if (triggerButton) {
    originalText = triggerButton.textContent;
    triggerButton.disabled = true;
    triggerButton.textContent = '创建中...';
  }

  try {
    setStatus('创建短链接中…');
    const result = await apiRequest('/links', {
      method: 'POST',
      body: JSON.stringify(payload)
    });

    // 自动复制
    const copied = autoCopy && result?.link
      ? await handleCopy(result.link, null, { silent: true })
      : false;

    // 刷新链接列表
    await loadLinks({ silent: true });

    // 自动打开统计
    if (autoOpenStats && result?.id) {
      openStats(result.id, result.link);
    }

    // 状态提示
    if (autoCopy && result?.link) {
      if (copied) {
        setStatus('短链接已创建并复制到剪贴板。', 'success');
      } else {
        setStatus('短链接已创建，但无法自动复制。', 'error');
      }
    } else {
      setStatus('短链接已创建！', 'success');
    }

    return result;
  } catch (error) {
    console.error(error);
    setStatus(error.message || '无法创建链接。', 'error');
    throw error;
  } finally {
    if (triggerButton) {
      triggerButton.disabled = false;
      if (originalText !== undefined) {
        triggerButton.textContent = originalText;
      }
    }
  }
}

/**
 * 打开链接统计页面
 * @param {string} id 链接ID
 * @param {string} shortLink 短链接
 */
function openStats(id, shortLink) {
  if (id) {
    const statsUrl = `${baseUrl}/stats?id=${encodeURIComponent(id)}`;
    chrome.tabs.create({ url: statsUrl });
  } else if (shortLink) {
    chrome.tabs.create({ url: shortLink });
  }
}

/**
 * 标准化基础URL
 * @param {string} value 原始URL
 * @returns {string} 标准化后的URL
 */
function normalizeBaseUrl(value) {
  if (!value) {
    return DEFAULT_BASE_URL;
  }

  let candidate = value.trim();
  if (!candidate) {
    return DEFAULT_BASE_URL;
  }

  if (!/^https?:\/\//i.test(candidate)) {
    candidate = `https://${candidate}`;
  }

  try {
    const url = new URL(candidate);
    url.search = '';
    url.hash = '';
    const normalizedPath = url.pathname.replace(/\/+$/, '');
    const path = normalizedPath === '' || normalizedPath === '/' ? '' : normalizedPath;
    return `${url.origin}${path}`;
  } catch (error) {
    console.error('Invalid base URL, falling back to default.', error);
    return DEFAULT_BASE_URL;
  }
}

/**
 * 获取API基础URL
 * @returns {string} API基础URL
 */
function getApiBaseUrl() {
  return `${baseUrl}${API_PATH}`;
}

// 初始化执行
init();