// Loopback-only preview helper. Not in APP_FILES or production builds.
(function () {
  try {
    const u = new URL(location.href);
    if (u.protocol !== 'http:' || u.hostname !== '127.0.0.1') return;
    if (u.searchParams.get('localMediaPreview') !== '1') return;
  } catch { return; }

  const accounts = {
    alice: {token: 'preview-alice', account: '0x' + '11'.repeat(20), name: 'Alice（发布者）'},
    bob: {token: 'preview-bob', account: '0x' + '22'.repeat(20), name: 'Bob（好友 / 群成员）'},
    eve: {token: 'preview-eve', account: '0x' + '33'.repeat(20), name: 'Eve（无权限对照）'},
  };
  const currentKey = accounts[sessionStorage.getItem('sv:preview-account')] ? sessionStorage.getItem('sv:preview-account') : 'alice';
  const current = accounts[currentKey];
  sessionStorage.setItem('sv:preview-account', currentKey);
  sessionStorage.setItem('sv:wallet-session', current.token);
  sessionStorage.setItem('sv:wallet-account', current.account);

  document.documentElement.classList.add('local-media-preview');
  const style = document.createElement('style');
  style.setAttribute('data-local-media-preview', 'layout');
  style.textContent = [
    'html.local-media-preview { --local-preview-banner-h: 0px; }',
    '#local-media-preview-bar { position:fixed; top:0; left:0; right:0; z-index:40; box-sizing:border-box; background:#171717; color:#f5f5f4; padding:8px 14px; font:13px/1.45 sans-serif; border-bottom:1px solid #444; pointer-events:auto; }',
    '#local-media-preview-bar button { margin:4px 6px 0 0; padding:4px 8px; font:inherit; cursor:pointer; }',
    'html.local-media-preview .app-header { top: var(--local-preview-banner-h) !important; }',
    'html.local-media-preview main { top: calc(64px + var(--local-preview-banner-h)) !important; }',
    'html.local-media-preview .service-status { top: calc(64px + var(--local-preview-banner-h)) !important; }',
    'html.local-media-preview .app-navigation { top: var(--local-preview-banner-h) !important; }',
    '@media (max-width: 760px) {',
    '  html.local-media-preview main { top: calc(58px + var(--local-preview-banner-h)) !important; }',
    '  html.local-media-preview .service-status { top: calc(58px + var(--local-preview-banner-h)) !important; left:0; }',
    '  html.local-media-preview .app-navigation { top: auto !important; }',
    '  html.local-media-preview body[data-page=creator] main { bottom: 0 !important; }',
    '  html.local-media-preview body[data-page=chat]:has(.conversation-open) main { top: var(--local-preview-banner-h) !important; }',
    '}'
  ].join('\n');
  document.head.append(style);

  function syncBannerHeight() {
    const bar = document.getElementById('local-media-preview-bar');
    const height = bar ? Math.ceil(bar.getBoundingClientRect().height) : 0;
    document.documentElement.style.setProperty('--local-preview-banner-h', height + 'px');
  }

  document.addEventListener('DOMContentLoaded', () => {
    const bar = document.createElement('div');
    bar.id = 'local-media-preview-bar';
    bar.setAttribute('role', 'note');
    bar.innerHTML = '<b>本地模拟预览</b>：不连真实 TapeRelay / Google / 钱包，也不代签付费交易。页头发布按钮应可点。测试视频：<a href="/fixtures/upload-test.mp4" style="color:#c5e0a3;">upload-test.mp4</a>（约 738 KB，8 秒），下载后在发布页选择。Alice 与 Bob 已是好友，并有预览私聊和预览群；Eve 无权限。'
      + Object.entries(accounts).map(([id, a]) =>
        ' <button type="button" data-acc="' + id + '">' + a.name + (current.token === a.token ? ' · 当前' : '') + '</button>'
      ).join('');
    document.body.prepend(bar);
    syncBannerHeight();
    new ResizeObserver(syncBannerHeight).observe(bar);
    window.addEventListener('resize', syncBannerHeight);
    bar.addEventListener('click', (e) => {
      const id = e.target && e.target.getAttribute('data-acc');
      if (!id || !accounts[id]) return;
      sessionStorage.setItem('sv:preview-account', id);
      sessionStorage.setItem('sv:wallet-session', accounts[id].token);
      sessionStorage.setItem('sv:wallet-account', accounts[id].account);
      const next = new URL(location.href);
      next.searchParams.set('view', 'discover');
      location.assign(next.pathname + next.search + next.hash);
    });
  });
})();
