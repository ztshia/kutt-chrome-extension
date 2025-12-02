const DEFAULT_BASE_URL = 'https://kutt.it';
const API_PATH = '/api/v2';
const BADGE_CLEAR_DELAY = 3000;

const CONTEXT_MENU_PAGE = 'shorten-page';
const CONTEXT_MENU_LINK = 'shorten-link';

let badgeTimeoutId;

chrome.runtime.onInstalled.addListener(async () => {
  try {
    await chrome.contextMenus.removeAll();
  } catch (error) {
    console.error('清除上下文菜单失败', error);
  }

  chrome.contextMenus.create({
    id: CONTEXT_MENU_PAGE,
    title: '用Kutt.it缩短',
    contexts: ['page', 'selection']
  });

  chrome.contextMenus.create({
    id: CONTEXT_MENU_LINK,
    title: '用Kutt.it缩短链接',
    contexts: ['link']
  });
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'shorten-current-tab') {
    return;
  }

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !isValidHttpUrl(tab.url)) {
    await showBadge('!', '#dc2626');
    console.warn('当前标签页URL不适合缩短。');
    return;
  }

  await shortenAndHandle(tab, tab.url);
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === CONTEXT_MENU_PAGE) {
    const target = info.linkUrl || info.pageUrl || tab?.url;
    if (!isValidHttpUrl(target)) {
      await showBadge('!', '#dc2626');
      console.warn('上下文菜单页面URL不适合缩短。');
      return;
    }
    await shortenAndHandle(tab, target);
    return;
  }

  if (info.menuItemId === CONTEXT_MENU_LINK) {
    const target = info.linkUrl || info.selectionText || '';
    if (!isValidHttpUrl(target)) {
      await showBadge('!', '#dc2626');
      console.warn('选中的链接URL不适合缩短。');
      return;
    }
    await shortenAndHandle(tab, target);
  }
});

async function shortenAndHandle(tab, targetUrl) {
  try {
    const settings = await getSettings();

    if (!settings.apiKey) {
      await showBadge('!', '#dc2626');
      chrome.runtime.openOptionsPage();
      throw new Error('缺少API密钥');
    }

    setActionTitle('正在创建短链接…');
    const result = await createShortLink(targetUrl, settings);

    let copied = false;
    if (settings.autoCopy && result?.link) {
      copied = await copyToClipboard(tab?.id, result.link);
    }

    if (settings.autoOpenStats && result?.id) {
      const statsUrl = `${settings.baseUrl}/stats?id=${encodeURIComponent(result.id)}`;
      chrome.tabs.create({ url: statsUrl });
    }

    if (copied || !settings.autoCopy) {
      await showBadge('✓', '#22c55e');
      setActionTitle('短链接已就绪');
    } else {
      await showBadge('!', '#dc2626');
      setActionTitle('短链接已创建（复制失败）');
    }
  } catch (error) {
    console.error('创建短链接失败', error);
    await showBadge('!', '#dc2626');
    setActionTitle('缩短失败');
  }
}

async function createShortLink(target, settings) {
  const trimmedTarget = target?.toString().trim();
  if (!trimmedTarget) {
    throw new Error('目标URL不能为空。');
  }

  const response = await fetch(`${getApiBaseUrl(settings.baseUrl)}/links`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-KEY': settings.apiKey
    },
    body: JSON.stringify({ target: trimmedTarget })
  });

  if (!response.ok) {
    const errorText = await response.text();
    let message = '请求失败';

    try {
      const payload = JSON.parse(errorText);
      message = payload?.error || payload?.message || message;
    } catch (parseError) {
      if (errorText) {
        message = errorText;
      }
    }

    throw new Error(message);
  }

  return response.json();
}

async function copyToClipboard(tabId, text) {
  if (!tabId || !text) {
    return false;
  }

  try {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId },
      func: async (textToCopy) => {
        try {
          if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(textToCopy);
          } else {
            const input = document.createElement('textarea');
            input.value = textToCopy;
            input.setAttribute('readonly', '');
            input.style.position = 'absolute';
            input.style.left = '-9999px';
            document.body.appendChild(input);
            input.select();
            document.execCommand('copy');
            document.body.removeChild(input);
          }
          return true;
        } catch (error) {
          console.error('页面上下文复制失败', error);
          return false;
        }
      },
      args: [text]
    });

    return Boolean(result);
  } catch (error) {
    console.error('无法通过脚本复制', error);
    return false;
  }
}

async function showBadge(text, color) {
  if (badgeTimeoutId) {
    clearTimeout(badgeTimeoutId);
    badgeTimeoutId = undefined;
  }

  await chrome.action.setBadgeText({ text });
  if (color) {
    await chrome.action.setBadgeBackgroundColor({ color });
  }

  badgeTimeoutId = setTimeout(() => {
    chrome.action.setBadgeText({ text: '' });
    setActionTitle();
  }, BADGE_CLEAR_DELAY);
}

function setActionTitle(message) {
  const title = message || 'Kutt.it 链接管理器';
  chrome.action.setTitle({ title });
}

async function getSettings() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(
      ['apiKey', 'baseUrl', 'autoCopy', 'autoOpenStats'],
      (stored) => {
        resolve({
          apiKey: stored.apiKey || '',
          baseUrl: normalizeBaseUrl(stored.baseUrl),
          autoCopy: stored.autoCopy !== undefined ? Boolean(stored.autoCopy) : true,
          autoOpenStats:
            stored.autoOpenStats !== undefined ? Boolean(stored.autoOpenStats) : false
        });
      }
    );
  });
}

function getApiBaseUrl(baseUrl) {
  return `${baseUrl}${API_PATH}`;
}

function normalizeBaseUrl(value) {
  if (!value) {
    return DEFAULT_BASE_URL;
  }

  let candidate = value.trim();
  if (!candidate) {
    return DEFAULT_BASE_URL;
  }

  if (!/^https?:\/\//iu.test(candidate)) {
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
    console.error('提供的基础URL无效，使用默认值。', error);
    return DEFAULT_BASE_URL;
  }
}

function isValidHttpUrl(value) {
  if (!value) {
    return false;
  }

  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch (error) {
    return false;
  }
}