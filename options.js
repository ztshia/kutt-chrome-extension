const DEFAULT_BASE_URL = 'https://miss.lc';

const form = document.getElementById('settings-form');
const baseUrlInput = document.getElementById('base-url');
const apiKeyInput = document.getElementById('api-key');
const statusEl = document.getElementById('status');
const clearButton = document.getElementById('clear-settings');
const autoCopyInput = document.getElementById('auto-copy');
const autoOpenStatsInput = document.getElementById('auto-open-stats');

init();

function init() {
  chrome.storage.sync.get(
    ['apiKey', 'baseUrl', 'autoCopy', 'autoOpenStats'],
    (result) => {
      if (result.apiKey) {
        apiKeyInput.value = result.apiKey;
      }
      baseUrlInput.value = result.baseUrl || DEFAULT_BASE_URL;
      autoCopyInput.checked = result.autoCopy !== undefined ? Boolean(result.autoCopy) : true;
      autoOpenStatsInput.checked = result.autoOpenStats
        ? Boolean(result.autoOpenStats)
        : false;
    }
  );
}

form.addEventListener('submit', (event) => {
  event.preventDefault();

  const apiKey = apiKeyInput.value.trim();
  const baseUrlInputValue = baseUrlInput.value.trim();
  const autoCopy = autoCopyInput.checked;
  const autoOpenStats = autoOpenStatsInput.checked;

  let baseUrl;
  try {
    baseUrl = normalizeBaseUrl(baseUrlInputValue);
  } catch (error) {
    updateStatus(error.message || '无效的基础URL。', 'error');
    return;
  }

  if (!apiKey) {
    updateStatus('API密钥不能为空。', 'error');
    return;
  }

  updateStatus('保存中…');
  chrome.storage.sync.set({ apiKey, baseUrl, autoCopy, autoOpenStats }, () => {
    updateStatus('设置已保存。', 'success');
  });
});

clearButton.addEventListener('click', () => {
  chrome.storage.sync.remove(['apiKey', 'baseUrl', 'autoCopy', 'autoOpenStats'], () => {
    apiKeyInput.value = '';
    baseUrlInput.value = DEFAULT_BASE_URL;
    autoCopyInput.checked = true;
    autoOpenStatsInput.checked = false;
    updateStatus('设置已清除。', 'success');
  });
});

function updateStatus(message, state = '') {
  statusEl.textContent = message;
  statusEl.className = state;
}

function normalizeBaseUrl(value) {
  let candidate = value || '';
  if (!candidate) {
    return DEFAULT_BASE_URL;
  }

  if (!/^https?:\/\//i.test(candidate)) {
    candidate = `https://${candidate}`;
  }

  let url;
  try {
    url = new URL(candidate);
  } catch (error) {
    throw new Error('请输入有效的URL，包括协议（http或https）。');
  }

  url.search = '';
  url.hash = '';

  const normalizedPath = url.pathname.replace(/\/+$/, '');
  const path = normalizedPath === '' || normalizedPath === '/' ? '' : normalizedPath;

  return `${url.origin}${path}`;
}