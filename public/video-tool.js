document.addEventListener('DOMContentLoaded', function() {
    const dropzone = document.getElementById('dropzone');
    const debugState = { enabled: new URLSearchParams(location.search).has('debug'), lines: [] };
    const debugPanel = document.createElement('pre');
    debugPanel.id = 'mobileDebugPanel';
    debugPanel.style.cssText = 'display:none;position:fixed;left:8px;right:8px;bottom:8px;z-index:9999;max-height:36vh;overflow:auto;padding:10px;border-radius:12px;background:rgba(0,0,0,.86);color:#8fffe8;font:11px/1.35 monospace;white-space:pre-wrap;';
    document.body.appendChild(debugPanel);
    function debugLog(message, data) {
        const line = `[${new Date().toISOString()}] ${message}` + (data ? ` ${JSON.stringify(data)}` : '');
        debugState.lines.push(line);
        if (debugState.lines.length > 80) debugState.lines.shift();
        if (debugState.enabled) {
            debugPanel.style.display = 'block';
            debugPanel.textContent = debugState.lines.join('\n');
            debugPanel.scrollTop = debugPanel.scrollHeight;
        }
        console.log('[mobile-debug]', line);
    }
    window.addEventListener('error', (event) => debugLog('window.error', { message: event.message, source: event.filename, line: event.lineno }));
    window.addEventListener('unhandledrejection', (event) => debugLog('unhandledrejection', { reason: String(event.reason || '') }));
    debugLog('video-tool.init', { ua: navigator.userAgent, online: navigator.onLine, href: location.href });
    const videoUpload = document.getElementById('videoUpload');
    const batchUpload = document.getElementById('batchUpload');
    const batchBtn = document.getElementById('batchBtn');
    const resultSection = document.getElementById('resultSection');
    const uploadPanel = document.querySelector('.upload-panel');

    if (!dropzone || !videoUpload) {
        console.error('Video tool elements not found');
        return;
    }

    // Result replaces upload panel in-place (never rendered below it)
    function showResultOnly() {
        if (uploadPanel) uploadPanel.style.display = 'none';
        resultSection.style.display = 'block';
        resultSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    // Dropzone click
    dropzone.addEventListener('click', () => videoUpload.click());
    dropzone.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            videoUpload.click();
        }
    });

    // Batch button click
    if (batchBtn && batchUpload) {
        batchBtn.addEventListener('click', () => batchUpload.click());
    }

    // Drag and drop
    ['dragenter', 'dragover'].forEach(eventName => {
        dropzone.addEventListener(eventName, (e) => {
            e.preventDefault();
            dropzone.classList.add('dragover');
        });
    });

    ['dragleave', 'drop'].forEach(eventName => {
        dropzone.addEventListener(eventName, (e) => {
            e.preventDefault();
            dropzone.classList.remove('dragover');
        });
    });

    dropzone.addEventListener('drop', (e) => {
        const file = e.dataTransfer.files[0];
        if (file && file.type.startsWith('video/')) {
            const transfer = new DataTransfer();
            transfer.items.add(file);
            videoUpload.files = transfer.files;
            handleVideoUpload(file);
        }
    });

    // Single video upload
    videoUpload.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) handleVideoUpload(file);
    });

    // Batch upload
    if (batchUpload) {
        batchUpload.addEventListener('change', (e) => {
            const files = Array.from(e.target.files);
            if (files.length > 0) handleBatchUpload(files);
        });
    }

    // Handle single video upload
    async function handleVideoUpload(file) {
        debugLog('upload.start', { name: file.name, size: file.size, type: file.type });
        // Validate file
        if (file.size > 500 * 1024 * 1024) {
            debugLog('upload.reject.size', { size: file.size });
            showError('File too large! Maximum size is 500MB.');
            return;
        }

        if (!file.type.startsWith('video/')) {
            debugLog('upload.reject.type', { type: file.type });
            showError('Invalid file type! Please upload a video file.');
            return;
        }

        // Show processing UI
        showProcessing(file.name);

        const formData = new FormData();
        formData.append('video', file);

        try {
            const response = await fetch('/upload-video', {
                method: 'POST',
                body: formData
            });
            const rawText = await response.text();
            let data = {};
            try { data = rawText ? JSON.parse(rawText) : {}; } catch (parseErr) {
                debugLog('upload.parse_error', { status: response.status, body: rawText.slice(0, 300) });
                showError(`Upload response invalid (HTTP ${response.status})`);
                return;
            }
            debugLog('upload.response', { status: response.status, ok: response.ok, data });

            if (response.ok && data.success && data.jobId) {
                // Start polling for progress
                pollProgress(data.jobId);
            } else if (response.ok && data.success) {
                // Legacy response (without jobId)
                showSuccess(data);
            } else {
                showError(data.error || `Upload failed (HTTP ${response.status})`);
            }
        } catch (error) {
            debugLog('upload.network_error', { message: error.message });
            showError('Network error: ' + error.message);
        }
    }

    // Poll progress endpoint
    async function pollProgress(jobId) {
        let attempts = 0;
        const maxAttempts = 300; // 10 minit (300 x 2s)
        debugLog('poll.start', { jobId });
        
        let pollInterval = setInterval(async () => {
            attempts++;
            
            try {
                const response = await fetch(`/video-progress/${jobId}`);
                const rawText = await response.text();
                let data = {};
                try { data = rawText ? JSON.parse(rawText) : {}; } catch (parseErr) {
                    clearInterval(pollInterval);
                    debugLog('poll.parse_error', { jobId, status: response.status, body: rawText.slice(0, 300) });
                    showError(`Progress response invalid (HTTP ${response.status})`);
                    return;
                }

                if (response.ok) {
                    if (attempts % 10 === 1 || data.status !== 'processing') {
                        debugLog('poll.tick', { jobId, attempts, status: data.status, progress: data.progress, elapsed: data.elapsed });
                    }
                    // Update progress bar
                    updateProgress(data.progress || 0, data.elapsed || 0);

                    if (data.status === 'completed') {
                        clearInterval(pollInterval);
                        debugLog('poll.completed', { jobId, original: data.original, processed: data.processed });
                        showSuccess(data);
                    } else if (data.status === 'failed') {
                        clearInterval(pollInterval);
                        debugLog('poll.failed', { jobId, error: data.error });
                        showError(data.error || 'Processing failed');
                    } else if (attempts >= maxAttempts) {
                        clearInterval(pollInterval);
                        debugLog('poll.timeout', { jobId, attempts });
                        showError('Processing timeout. Please try again or contact support.');
                    }
                } else {
                    clearInterval(pollInterval);
                    debugLog('poll.http_error', { jobId, status: response.status, body: data });
                    showError(`Failed to check progress (HTTP ${response.status})`);
                }
            } catch (error) {
                clearInterval(pollInterval);
                debugLog('poll.network_error', { jobId, message: error.message });
                showError('Network error: ' + error.message);
            }
        }, 2000);
    }

    // Update progress deck (gauge ring, thin bar, timer)
    const GAUGE_CIRCUMFERENCE = 113;
    function updateProgress(percent, elapsed) {
        const clamped = Math.max(0, Math.min(100, Math.round(percent)));
        const barFill = document.querySelector('.deck-bar-fill');
        const gaugeFill = document.querySelector('.gauge-fill');
        const gaugeNum = document.querySelector('.gauge-num');
        const statusEl = document.querySelector('.deck-status');
        const elapsedEl = document.querySelector('.deck-elapsed');

        if (barFill) barFill.style.width = clamped + '%';
        if (gaugeFill) gaugeFill.style.strokeDashoffset = GAUGE_CIRCUMFERENCE * (1 - clamped / 100);
        if (gaugeNum) gaugeNum.textContent = clamped + '%';
        if (statusEl) {
            statusEl.textContent = clamped < 15
                ? 'Uploading video'
                : clamped < 92 ? 'Removing watermark' : 'Finalizing output';
        }
        if (elapsedEl) elapsedEl.textContent = elapsed + 's';
    }

    // Handle batch upload
    async function handleBatchUpload(files) {
        if (files.length > 10) {
            showError('Maximum 10 videos per batch!');
            return;
        }

        showBatchProcessing(files.length);

        const formData = new FormData();
        files.forEach(file => formData.append('videos', file));

        try {
            const response = await fetch('/upload-batch', {
                method: 'POST',
                body: formData
            });

            const data = await response.json();

            if (response.ok && data.success) {
                showBatchSuccess(data);
            } else {
                showError(data.error || 'Batch upload failed');
            }
        } catch (error) {
            showError('Network error: ' + error.message);
        }
    }

    // Light floating progress deck: gauge + waveform + thin bar
    function buildProcessingDeck() {
        const bars = Array.from({ length: 26 }, (_, i) =>
            `<i style="animation-delay:${(i * 0.06).toFixed(2)}s"></i>`
        ).join('');
        return `
            <div class="result-card processing">
                <div class="deck-main">
                    <div class="gauge">
                        <svg viewBox="0 0 44 44" aria-hidden="true">
                            <circle class="gauge-track" cx="22" cy="22" r="18"></circle>
                            <circle class="gauge-fill" cx="22" cy="22" r="18"></circle>
                        </svg>
                        <span class="gauge-num">5%</span>
                    </div>
                    <div class="deck-info">
                        <strong class="deck-file"></strong>
                        <span class="deck-status"></span>
                    </div>
                    <span class="deck-elapsed">0s</span>
                </div>
                <div class="deck-wave" aria-hidden="true">${bars}</div>
                <div class="deck-bar"><i class="deck-bar-fill"></i></div>
            </div>
        `;
    }

    // Show processing UI
    function showProcessing(filename) {
        showResultOnly();
        resultSection.innerHTML = buildProcessingDeck();
        resultSection.querySelector('.deck-file').textContent = filename;
        resultSection.querySelector('.deck-status').textContent = 'Uploading video';
    }

    // Show batch processing UI
    function showBatchProcessing(count) {
        showResultOnly();
        resultSection.innerHTML = buildProcessingDeck();
        resultSection.querySelector('.deck-file').textContent = count + ' videos queued';
        resultSection.querySelector('.deck-status').textContent = 'Uploading batch';
    }

    // Show success UI
    function showSuccess(data) {
        debugLog('ui.success', { processed: data.processed, original: data.original });
        resultSection.innerHTML = `
            <div class="result-card success">
                <div class="result-header">
                    <div class="result-icon">✓</div>
                    <div class="result-title">Clean video ready</div>
                </div>
                <div class="video-grid">
                    <div class="video-card">
                        <h4>Original</h4>
                        <video src="${data.original}" controls></video>
                    </div>
                    <div class="video-card">
                        <h4>Processed</h4>
                        <video src="${data.processed}" controls></video>
                    </div>
                </div>
                <div class="result-actions">
                    <a href="${data.processed}" download class="btn btn-primary">Download clean video</a>
                    <a href="${data.original}" download class="btn btn-secondary">Download original</a>
                    <button onclick="resetUpload()" class="btn btn-secondary">Upload another</button>
                </div>
            </div>
        `;
    }

    // Show batch success UI
    function showBatchSuccess(data) {
        resultSection.innerHTML = `
            <div class="result-card success">
                <div class="result-header">
                    <div class="result-icon">✓</div>
                    <div class="result-title">Batch Started!</div>
                </div>
                <p style="color: var(--color-body); margin-bottom: 16px;">
                    Processing ${data.totalFiles} videos...
                </p>
                <p style="color: var(--color-muted); font-size: 14px;">
                    Status: <a href="${data.statusUrl}" target="_blank" style="color: var(--brand-600); font-weight: 600;">Check Status →</a>
                </p>
                <div class="result-actions">
                    <button onclick="resetUpload()" class="btn btn-secondary">Upload another batch</button>
                </div>
            </div>
        `;
    }

    // Show error UI
    function showError(message) {
        debugLog('ui.error', { message });
        showResultOnly();
        resultSection.innerHTML = `
            <div class="result-card error">
                <div class="result-header">
                    <div class="result-icon">!</div>
                    <div class="result-title">Error</div>
                </div>
                <p style="color: #EF4444;">${message}</p>
                <div class="result-actions">
                    <button onclick="resetUpload()" class="btn btn-secondary">Try again</button>
                </div>
            </div>
        `;
    }

    // Reset upload
    window.resetUpload = function() {
        resultSection.style.display = 'none';
        resultSection.innerHTML = '';
        if (uploadPanel) uploadPanel.style.display = '';
        videoUpload.value = '';
        if (batchUpload) batchUpload.value = '';
    };
});
