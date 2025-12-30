export const DASHBOARD_HTML = `
<!DOCTYPE html>
<html lang="zh-CN" class="dark">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Antigravity Manager</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <script>
        tailwind.config = {
            darkMode: 'class',
            theme: {
                extend: {
                    colors: {
                        gray: {
                            850: '#1f2937',
                            900: '#111827',
                            950: '#030712',
                        }
                    }
                }
            }
        }
    </script>
    <style>
        body { background-color: #030712; color: #e5e7eb; }
        .card { background-color: #111827; border: 1px solid #1f2937; }
    </style>
</head>
<body class="min-h-screen p-6">
    <div class="max-w-6xl mx-auto">
        <header class="flex justify-between items-center mb-8">
            <div class="flex items-center gap-3">
                <div class="w-10 h-10 bg-blue-600 rounded-lg flex items-center justify-center">
                    <svg class="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg>
                </div>
                <h1 class="text-2xl font-bold text-white">Antigravity Manager</h1>
            </div>
            <div class="flex gap-4">
                <button onclick="refreshAllTokens()" class="px-4 py-2 bg-gray-800 hover:bg-gray-700 rounded-lg text-sm font-medium transition-colors flex items-center gap-2">
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path></svg>
                    刷新所有 Token
                </button>
                <a href="/manage/status" target="_blank" class="px-4 py-2 bg-gray-800 hover:bg-gray-700 rounded-lg text-sm font-medium transition-colors">
                    系统状态
                </a>
            </div>
        </header>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
            <!-- Antigravity Accounts -->
            <div class="card rounded-xl p-6">
                <div class="flex justify-between items-center mb-6">
                    <h2 class="text-xl font-semibold flex items-center gap-2">
                        <span class="w-2 h-2 rounded-full bg-blue-500"></span>
                        Antigravity (Gemini)
                    </h2>
                    <button onclick="addAntigravity()" class="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-medium transition-colors">
                        + 添加账号
                    </button>
                </div>
                <div id="antigravity-list" class="space-y-3">
                    <div class="animate-pulse flex space-x-4">
                        <div class="flex-1 space-y-4 py-1">
                            <div class="h-4 bg-gray-700 rounded w-3/4"></div>
                            <div class="space-y-2">
                                <div class="h-4 bg-gray-700 rounded"></div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Codex Accounts -->
            <div class="card rounded-xl p-6">
                <div class="flex justify-between items-center mb-6">
                    <h2 class="text-xl font-semibold flex items-center gap-2">
                        <span class="w-2 h-2 rounded-full bg-green-500"></span>
                        Codex (OpenAI)
                    </h2>
                    <button onclick="addCodex()" class="px-3 py-1.5 bg-green-600 hover:bg-green-500 text-white rounded-lg text-sm font-medium transition-colors">
                        + 添加账号
                    </button>
                </div>
                <div id="codex-list" class="space-y-3">
                    <div class="animate-pulse flex space-x-4">
                        <div class="flex-1 space-y-4 py-1">
                            <div class="h-4 bg-gray-700 rounded w-3/4"></div>
                            <div class="space-y-2">
                                <div class="h-4 bg-gray-700 rounded"></div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>

    <script>
        const API_BASE = '/manage';
        
        // 获取管理密钥（如果有）
        function getAuthHeaders() {
            const headers = {};
            // 这里假设如果是浏览器访问，可能通过 Cookie 或 Basic Auth，
            // 但目前的 API 设计是 Header。为了简化，我们假设在同域下
            // 如果需要鉴权，可以在这里弹窗输入 Key 并保存到 localStorage
            const key = localStorage.getItem('management_key');
            if (key) {
                headers['X-Management-Key'] = key;
            }
            return headers;
        }

        async function loadAccounts() {
            try {
                const res = await fetch(\`\${API_BASE}/accounts\`, { headers: getAuthHeaders() });
                if (res.status === 401 || res.status === 403) {
                    const key = prompt('请输入管理密钥 (Management Key):');
                    if (key) {
                        localStorage.setItem('management_key', key);
                        loadAccounts();
                    }
                    return;
                }
                const data = await res.json();
                renderAntigravity(data.antigravity.accounts);
                renderCodex(data.codex.accounts);
            } catch (err) {
                console.error('加载失败', err);
                alert('加载账号列表失败');
            }
        }

        function renderAntigravity(accounts) {
            const container = document.getElementById('antigravity-list');
            if (accounts.length === 0) {
                container.innerHTML = '<div class="text-gray-500 text-center py-4">暂无账号</div>';
                return;
            }
            container.innerHTML = accounts.map(acc => \`
                <div class="bg-gray-800/50 rounded-lg p-4 border border-gray-700 flex justify-between items-center">
                    <div>
                        <div class="font-medium text-white">\${acc.email}</div>
                        <div class="text-xs text-gray-400 mt-1">
                            Project ID: \${acc.hasProjectId ? '<span class="text-green-400">已获取</span>' : '<span class="text-red-400">未获取</span>'}
                            <span class="mx-2">|</span>
                            过期: \${new Date(acc.tokenExpiry).toLocaleString()}
                        </div>
                    </div>
                    <button onclick="deleteAccount('antigravity', '\${acc.id}')" class="text-red-400 hover:text-red-300 p-2">
                        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                    </button>
                </div>
            \`).join('');
        }

        function renderCodex(accounts) {
            const container = document.getElementById('codex-list');
            if (accounts.length === 0) {
                container.innerHTML = '<div class="text-gray-500 text-center py-4">暂无账号</div>';
                return;
            }
            container.innerHTML = accounts.map(acc => \`
                <div class="bg-gray-800/50 rounded-lg p-4 border border-gray-700 flex justify-between items-center">
                    <div>
                        <div class="font-medium text-white">\${acc.email}</div>
                        <div class="text-xs text-gray-400 mt-1">
                            Account ID: \${acc.hasAccountId ? '<span class="text-green-400">已获取</span>' : '<span class="text-red-400">未获取</span>'}
                            <span class="mx-2">|</span>
                            过期: \${new Date(acc.tokenExpiry).toLocaleString()}
                        </div>
                    </div>
                    <button onclick="deleteAccount('codex', '\${acc.id}')" class="text-red-400 hover:text-red-300 p-2">
                        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                    </button>
                </div>
            \`).join('');
        }

        async function addAntigravity() {
            try {
                // 动态构建回调 URL
                const callbackUrl = window.location.origin + '/manage/auth/antigravity/callback';
                const res = await fetch(\`\${API_BASE}/auth/antigravity/login?redirect_uri=\${encodeURIComponent(callbackUrl)}\`, { headers: getAuthHeaders() });
                const data = await res.json();
                window.location.href = data.url;
            } catch (err) {
                alert('获取登录链接失败');
            }
        }

        async function addCodex() {
            try {
                // Codex 需要特殊处理，因为需要 codeVerifier
                const callbackUrl = window.location.origin + '/manage/codex-callback';
                const res = await fetch(\`\${API_BASE}/auth/codex/login?redirect_uri=\${encodeURIComponent(callbackUrl)}\`, { headers: getAuthHeaders() });
                const data = await res.json();
                
                // 保存 codeVerifier 到 localStorage，回调页面会用到
                localStorage.setItem('codex_verifier', data.codeVerifier);
                
                window.location.href = data.url;
            } catch (err) {
                alert('获取登录链接失败');
            }
        }

        async function deleteAccount(type, id) {
            if (!confirm('确定要删除这个账号吗？')) return;
            try {
                const res = await fetch(\`\${API_BASE}/accounts/\${type}/\${id}\`, {
                    method: 'DELETE',
                    headers: getAuthHeaders()
                });
                if (res.ok) {
                    loadAccounts();
                } else {
                    alert('删除失败');
                }
            } catch (err) {
                alert('删除出错');
            }
        }

        async function refreshAllTokens() {
            const btn = document.querySelector('button[onclick="refreshAllTokens()"]');
            const originalText = btn.innerHTML;
            btn.innerHTML = '刷新中...';
            btn.disabled = true;
            
            try {
                const res = await fetch(\`\${API_BASE}/refresh-tokens\`, {
                    method: 'POST',
                    headers: getAuthHeaders()
                });
                const data = await res.json();
                alert(\`刷新完成\\nAntigravity: 成功 \${data.antigravity.success}, 失败 \${data.antigravity.failed}\\nCodex: 成功 \${data.codex.success}, 失败 \${data.codex.failed}\`);
                loadAccounts();
            } catch (err) {
                alert('刷新请求失败');
            } finally {
                btn.innerHTML = originalText;
                btn.disabled = false;
            }
        }

        // 初始化
        loadAccounts();
    </script>
</body>
</html>
`;

export const CODEX_CALLBACK_HTML = `
<!DOCTYPE html>
<html>
<head>
    <title>Processing Login...</title>
    <script>
        async function handleCallback() {
            const params = new URLSearchParams(window.location.search);
            const code = params.get('code');
            const codeVerifier = localStorage.getItem('codex_verifier');
            
            if (!code || !codeVerifier) {
                document.body.innerHTML = 'Error: Missing code or verifier';
                return;
            }

            try {
                const callbackUrl = window.location.origin + '/manage/codex-callback';
                const res = await fetch('/manage/auth/codex/callback', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        // 如果有管理密钥，也需要带上
                        'X-Management-Key': localStorage.getItem('management_key') || ''
                    },
                    body: JSON.stringify({
                        code,
                        codeVerifier,
                        redirectUri: callbackUrl
                    })
                });

                if (res.ok) {
                    // 登录成功，清除 verifier 并跳转回管理页
                    localStorage.removeItem('codex_verifier');
                    window.location.href = '/manage';
                } else {
                    const err = await res.text();
                    document.body.innerHTML = 'Login failed: ' + err;
                }
            } catch (e) {
                document.body.innerHTML = 'Error: ' + e.message;
            }
        }
        handleCallback();
    </script>
    <style>
        body { background: #111827; color: white; font-family: sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; }
    </style>
</head>
<body>
    Processing login...
</body>
</html>
`;