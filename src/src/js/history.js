// Green Hole Local History Manager (greenhole.online)

const STORAGE_KEY = 'green_hole_download_history';

export function getHistory() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    return [];
  }
}

export function saveToHistory(item) {
  try {
    const list = getHistory();
    // Prevent duplicates
    const filtered = list.filter(i => i.url !== item.url);
    const updated = [
      {
        ...item,
        id: Date.now(),
        date: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
      },
      ...filtered
    ].slice(0, 20); // Keep max 20 entries

    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    renderHistory();
  } catch (e) {
    console.error('Failed to save to history', e);
  }
}

export function clearHistory() {
  localStorage.removeItem(STORAGE_KEY);
  renderHistory();
}

export function renderHistory() {
  const listContainer = document.getElementById('historyList');
  const badge = document.getElementById('historyBadge');
  if (!listContainer) return;

  const history = getHistory();
  if (badge) badge.textContent = history.length;

  if (history.length === 0) {
    listContainer.innerHTML = `
      <div style="text-align: center; color: var(--text-muted); padding: 3rem 1rem;">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 48px; height: 48px; margin-bottom: 1rem; opacity: 0.5;"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
        <p>No download history yet.</p>
        <small style="color: var(--text-dim);">Processed videos will appear here.</small>
      </div>
    `;
    return;
  }

  listContainer.innerHTML = history.map(item => `
    <div class="history-item">
      <img src="${item.thumbnail || '/hero.jpg'}" alt="${item.title}" class="history-thumb">
      <div class="history-details">
        <h4 class="history-title" title="${item.title}">${item.title}</h4>
        <div class="history-meta">
          <span class="badge-platform" style="font-size: 0.65rem;">${item.platform}</span>
          <span style="margin-left: 0.4rem;">${item.date}</span>
        </div>
      </div>
      <button class="btn btn-outline redownload-btn" data-url="${item.url}" title="Re-download" style="padding: 0.4rem 0.6rem; font-size: 0.8rem;">
        ↓
      </button>
    </div>
  `).join('');
}
