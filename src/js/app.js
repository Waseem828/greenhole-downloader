// Green Hole Video Downloader Application Logic (greenhole.online)

import { detectPlatform, isValidUrl } from './parser.js';
import { parseVideoUrl } from './api.js';
import { saveToHistory, renderHistory, clearHistory } from './history.js';

// Track current parsed video data for preview modal
let currentVideoData = null;

document.addEventListener('DOMContentLoaded', () => {
  // DOM Elements
  const downloaderForm = document.getElementById('downloaderForm');
  const urlInput = document.getElementById('urlInput');
  const pasteBtn = document.getElementById('pasteBtn');
  const downloadBtn = document.getElementById('downloadBtn');
  const btnSpinner = document.getElementById('btnSpinner');
  const platformBadge = document.getElementById('platformBadge');
  const platformBadgeIcon = document.getElementById('platformBadgeIcon');
  const platformBadgeText = document.getElementById('platformBadgeText');

  // Result Card Elements
  const resultCard = document.getElementById('resultCard');
  const resultThumb = document.getElementById('resultThumb');
  const resultTitle = document.getElementById('resultTitle');
  const resultAuthor = document.getElementById('resultAuthor');
  const resultDuration = document.getElementById('resultDuration');
  const resultPlatformTag = document.getElementById('resultPlatformTag');
  const watermarkTag = document.getElementById('watermarkTag');
  const videoFormatsList = document.getElementById('videoFormatsList');
  const audioFormatsList = document.getElementById('audioFormatsList');
  const switchBtns = document.querySelectorAll('.switch-btn');
  const playPreviewBtn = document.getElementById('playPreviewBtn');

  // Modals & History Drawer
  const historyToggleBtn = document.getElementById('historyToggleBtn');
  const historyDrawer = document.getElementById('historyDrawer');
  const closeHistoryBtn = document.getElementById('closeHistoryBtn');
  const clearHistoryBtn = document.getElementById('clearHistoryBtn');
  const historyList = document.getElementById('historyList');

  const videoModal = document.getElementById('videoModal');
  const closeModalBtn = document.getElementById('closeModalBtn');
  const previewVideo = document.getElementById('previewVideo');
  const previewTitle = document.getElementById('previewTitle');

  // Legal Modals
  const termsModal = document.getElementById('termsModal');
  const privacyModal = document.getElementById('privacyModal');
  const dmcaModal = document.getElementById('dmcaModal');
  const aboutModal = document.getElementById('aboutModal');

  // Initial History Render
  renderHistory();

  // 1. URL Input Auto-Detection & Platform Badge Updates
  urlInput.addEventListener('input', () => {
    updatePlatformBadge(urlInput.value);
  });

  function updatePlatformBadge(url) {
    const detected = detectPlatform(url);
    if (detected) {
      platformBadgeIcon.innerHTML = detected.icon;
      platformBadgeText.textContent = detected.name;
      platformBadge.className = `detected-badge ${detected.badgeClass}`;
      platformBadge.classList.remove('hidden');
    } else {
      platformBadge.classList.add('hidden');
    }
  }

  // 2. Clipboard Paste Action
  pasteBtn.addEventListener('click', async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        urlInput.value = text;
        updatePlatformBadge(text);
        showToast('Link pasted from clipboard!', 'success');
      }
    } catch (err) {
      showToast('Clipboard permission denied. Please paste manually.', 'error');
    }
  });

  // 3. Form Submit Handler (Parse Video Link)
  downloaderForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const inputVal = urlInput.value.trim();
    if (!inputVal) {
      showToast('Please paste a video URL first!', 'error');
      return;
    }

    if (!isValidUrl(inputVal)) {
      showToast('Invalid URL format. Please paste a full http/https link.', 'error');
      return;
    }

    // UI Loading State
    setLoadingState(true);
    resultCard.classList.add('hidden');

    try {
      const data = await parseVideoUrl(inputVal);

      if (data && data.success) {
        renderResultData(data, inputVal);
        showToast(`Video processed! Click quality below to download real video.`, 'success');
      } else {
        showToast(data.error || 'Could not parse video link. Try another link.', 'error');
      }

    } catch (err) {
      showToast('Error processing video. Server connection issue.', 'error');
    } finally {
      setLoadingState(false);
    }
  });

  function setLoadingState(isLoading) {
    if (isLoading) {
      downloadBtn.disabled = true;
      btnSpinner.classList.remove('hidden');
      downloadBtn.querySelector('.btn-text').textContent = 'Analyzing...';
    } else {
      downloadBtn.disabled = false;
      btnSpinner.classList.add('hidden');
      downloadBtn.querySelector('.btn-text').textContent = 'Download Now';
    }
  }

  // 4. Render Video Data & Quality Format Options
  function renderResultData(data, originalUrl) {
    // Save current video data for preview modal
    currentVideoData = data;

    resultThumb.src = data.thumbnail || '/hero.jpg';
    resultTitle.textContent = data.title || 'Downloaded Video';
    resultAuthor.textContent = data.author || '@creator';
    resultDuration.textContent = data.duration || '02:30';
    resultPlatformTag.textContent = (data.platform || 'video').toUpperCase();

    // Watermark Tag visibility (TikTok)
    if (data.platform === 'tiktok') {
      watermarkTag.classList.remove('hidden');
      watermarkTag.textContent = '✓ No Watermark Logo';
    } else {
      watermarkTag.classList.add('hidden');
    }

    // Render Video Formats (MP4) and Audio Formats (MP3)
    const videoFormats = data.formats.filter(f => f.type === 'video' || f.format === 'MP4');
    const audioFormats = data.formats.filter(f => f.type === 'audio' || f.format === 'MP3');

    renderFormatsList(videoFormatsList, videoFormats.length > 0 ? videoFormats : data.formats, data.title, data.platform);
    renderFormatsList(audioFormatsList, audioFormats.length > 0 ? audioFormats : getFallbackAudioFormat(data.platform), data.title, data.platform);

    // Show Result Card
    resultCard.classList.remove('hidden');
    resultCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

    // Save item to history
    saveToHistory({
      title: data.title,
      thumbnail: data.thumbnail,
      platform: data.platform.toUpperCase(),
      url: originalUrl
    });
  }

  function getFallbackAudioFormat(platform) {
    return [
      { quality: '320kbps MP3', format: 'MP3', size: 'Audio Stream', downloadUrl: `/api/download?type=audio&filename=GreenHole_${platform}_audio.mp3`, type: 'audio' }
    ];
  }

  function renderFormatsList(container, formats, videoTitle, platform) {
    container.innerHTML = formats.map(fmt => `
      <div class="format-item">
        <div class="format-details">
          <span class="quality-badge">${fmt.quality}</span>
          <div>
            <div class="format-name">${fmt.format} ${fmt.type === 'audio' ? 'Audio' : 'Video'}</div>
            <div class="file-size">${fmt.size}</div>
          </div>
        </div>

        <button 
          class="btn btn-primary trigger-dl-btn" 
          data-url="${fmt.downloadUrl}" 
          data-filename="GreenHole_${platform}_${fmt.quality.replace(/[^a-zA-Z0-9]/g, '_')}.${fmt.format.toLowerCase()}"
          data-type="${fmt.type}"
        >
          <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/></svg>
          Download
        </button>
      </div>
    `).join('');

    // Attach Download Trigger Click Listeners
    container.querySelectorAll('.trigger-dl-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const fileUrl = btn.getAttribute('data-url');
        const filename = btn.getAttribute('data-filename');
        const type = btn.getAttribute('data-type');

        downloadFile(fileUrl, filename, type);
      });
    });
  }

  function downloadFile(fileUrl, filename, type) {
    showToast(`⬇ Download شروع ہو رہی ہے...`, 'info');

    // Use window.location.href for native Content-Disposition attachment download
    // This allows Chrome to seamlessly follow 302 redirects to media CDNs without cross-origin anchor blocks
    window.location.href = fileUrl;
  }

  // 5. Format Tab Switcher (Video MP4 vs Audio MP3)
  switchBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      switchBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      const targetTab = btn.getAttribute('data-tab');
      if (targetTab === 'video') {
        videoFormatsList.classList.remove('hidden');
        audioFormatsList.classList.add('hidden');
      } else {
        videoFormatsList.classList.add('hidden');
        audioFormatsList.classList.remove('hidden');
      }
    });
  });

  // 6. Video Preview Modal Handler
  playPreviewBtn.addEventListener('click', () => {
    previewTitle.textContent = resultTitle.textContent;

    // Set actual video stream URL from the parsed formats (first MP4 video format)
    if (currentVideoData && currentVideoData.formats && currentVideoData.formats.length > 0) {
      const videoFmt = currentVideoData.formats.find(f => f.type === 'video') || currentVideoData.formats[0];
      // Use the download API URL to stream directly into the video player
      previewVideo.src = videoFmt.downloadUrl;
      previewVideo.poster = currentVideoData.thumbnail || '';
      previewVideo.load();
    }

    videoModal.classList.remove('hidden');
    previewVideo.play().catch(() => {});
  });

  closeModalBtn.addEventListener('click', () => {
    previewVideo.pause();
    videoModal.classList.add('hidden');
  });

  videoModal.addEventListener('click', (e) => {
    if (e.target === videoModal) {
      previewVideo.pause();
      videoModal.classList.add('hidden');
    }
  });

  // 7. History Drawer Controls
  historyToggleBtn.addEventListener('click', () => {
    historyDrawer.classList.remove('hidden');
  });

  closeHistoryBtn.addEventListener('click', () => {
    historyDrawer.classList.add('hidden');
  });

  historyDrawer.addEventListener('click', (e) => {
    if (e.target === historyDrawer) historyDrawer.classList.add('hidden');
  });

  clearHistoryBtn.addEventListener('click', () => {
    clearHistory();
    showToast('Download history cleared.', 'info');
  });

  // Delegate Re-download from History list
  historyList.addEventListener('click', (e) => {
    const redownloadBtn = e.target.closest('.redownload-btn');
    if (redownloadBtn) {
      const url = redownloadBtn.getAttribute('data-url');
      urlInput.value = url;
      updatePlatformBadge(url);
      historyDrawer.classList.add('hidden');
      downloaderForm.dispatchEvent(new Event('submit'));
    }
  });

  // 8. Legal Pages Modals Setup
  setupLegalModal('termsLink', 'termsModal', 'closeTermsBtn');
  setupLegalModal('privacyLink', 'privacyModal', 'closePrivacyBtn');
  setupLegalModal('dmcaLink', 'dmcaModal', 'closeDmcaBtn');
  setupLegalModal('aboutLink', 'aboutModal', 'closeAboutBtn');

  function setupLegalModal(triggerId, modalId, closeId) {
    const trigger = document.getElementById(triggerId);
    const modal = document.getElementById(modalId);
    const close = document.getElementById(closeId);

    if (trigger && modal) {
      trigger.addEventListener('click', (e) => {
        e.preventDefault();
        modal.classList.remove('hidden');
      });
    }

    if (close && modal) {
      close.addEventListener('click', () => modal.classList.add('hidden'));
    }

    if (modal) {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) modal.classList.add('hidden');
      });
    }
  }

  // 9. Platform Navigation Tabs & Pills Filter
  const platformButtons = document.querySelectorAll('[data-platform], [data-platform-pill]');
  platformButtons.forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const platformKey = btn.getAttribute('data-platform') || btn.getAttribute('data-platform-pill');

      // Update active states
      document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.pill').forEach(p => p.classList.remove('active'));

      const matchedNav = document.querySelector(`.nav-btn[data-platform="${platformKey}"]`);
      if (matchedNav) matchedNav.classList.add('active');

      const matchedPill = document.querySelector(`.pill[data-platform-pill="${platformKey}"]`);
      if (matchedPill) matchedPill.classList.add('active');

      if (platformKey !== 'all') {
        urlInput.placeholder = `Paste your ${platformKey.toUpperCase()} link here...`;
      } else {
        urlInput.placeholder = 'Paste YouTube, TikTok, Instagram or Facebook URL here...';
      }

      urlInput.focus();
    });
  });

  // 10. Toast Notification System
  function showToast(message, type = 'info') {
    const toastContainer = document.getElementById('toastContainer');
    if (!toastContainer) return;

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    
    let icon = 'ℹ️';
    if (type === 'success') icon = '✅';
    if (type === 'error') icon = '⚠️';

    toast.innerHTML = `<span>${icon}</span> <span>${message}</span>`;
    toastContainer.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(50px)';
      setTimeout(() => toast.remove(), 300);
    }, 4000);
  }
});
