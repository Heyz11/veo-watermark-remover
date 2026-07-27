document.addEventListener('DOMContentLoaded', function() {
    // Check if user is logged in
    const token = localStorage.getItem('userToken');
    const email = localStorage.getItem('userEmail');

    if (!token || !email) {
        window.location.href = '/user-login.html';
        return;
    }

    // Display user email
    const userEmailElement = document.getElementById('userEmail');
    if (userEmailElement) {
        userEmailElement.textContent = email;
    }

    // Load user stats
    async function loadUserStats() {
        try {
            const response = await fetch('/api/user/stats', {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });

            if (response.ok) {
                const data = await response.json();
                
                const imagesUsedElement = document.getElementById('imagesUsed');
                const videosUsedElement = document.getElementById('videosUsed');
                const apiKeyElement = document.getElementById('apiKey');
                
                if (imagesUsedElement) imagesUsedElement.textContent = '-';
                if (videosUsedElement) videosUsedElement.textContent = data.videosUsed || 0;
                if (apiKeyElement) apiKeyElement.textContent = data.apiKey || '-';
            } else if (response.status === 401) {
                localStorage.removeItem('userToken');
                localStorage.removeItem('userEmail');
                window.location.href = '/user-login.html';
            }
        } catch (error) {
            console.error('Error loading stats:', error);
        }
    }

    loadUserStats();

    const copyApiKeyBtn = document.getElementById('copyApiKey');
    if (copyApiKeyBtn) {
        copyApiKeyBtn.addEventListener('click', async () => {
            const apiKey = document.getElementById('apiKey')?.textContent?.trim();
            if (!apiKey || apiKey === '-') return;
            try {
                await navigator.clipboard.writeText(apiKey);
            } catch (error) {
                const area = document.createElement('textarea');
                area.value = apiKey;
                document.body.appendChild(area);
                area.select();
                document.execCommand('copy');
                area.remove();
            }
            copyApiKeyBtn.textContent = 'Copied';
            copyApiKeyBtn.classList.add('copied');
            setTimeout(() => {
                copyApiKeyBtn.textContent = 'Copy';
                copyApiKeyBtn.classList.remove('copied');
            }, 1400);
        });
    }

    // Logout

    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', async () => {
            try {
                await fetch('/api/user/logout', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${token}`
                    }
                });
            } catch (error) {
                console.error('Logout error:', error);
            }

            localStorage.removeItem('userToken');
            localStorage.removeItem('userEmail');
            window.location.href = '/user-login.html';
        });
    }
});
