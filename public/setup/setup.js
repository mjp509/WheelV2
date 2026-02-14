// ── State ───────────────────────────────────────────────────────────────────────

let clientId = '';
let accessToken = '';
let twitchLogin = '';
let broadcasterId = '';
let selectedRewardId = '';
let selectedRewardName = '';

// ── Step Navigation ─────────────────────────────────────────────────────────────

function goToStep(n) {
  document.querySelectorAll('.step').forEach(s => s.classList.remove('active'));
  document.getElementById('step-' + n).classList.add('active');

  document.querySelectorAll('.dot').forEach(d => {
    const step = parseInt(d.dataset.step);
    d.classList.remove('active', 'done');
    if (step < n) d.classList.add('done');
    if (step === n) d.classList.add('active');
  });

  // Load rewards when entering step 4
  if (n === 4 && accessToken) {
    loadRewards();
  }

  // Populate summary when entering step 5
  if (n === 5) {
    populateSummary();
  }
}

// ── Step 2: Client ID ───────────────────────────────────────────────────────────

function validateStep2() {
  const input = document.getElementById('client-id-input').value.trim();
  const error = document.getElementById('step2-error');

  if (!input || input.length < 10) {
    error.textContent = 'Please enter a valid Client ID.';
    return;
  }

  error.textContent = '';
  clientId = input;
  goToStep(3);
}

// ── Step 3: OAuth ───────────────────────────────────────────────────────────────

function connectTwitch() {
  const scopes = 'chat:read chat:edit channel:manage:vips moderator:manage:banned_users channel:read:redemptions';
  const redirectUri = window.location.origin + '/setup/callback.html';
  const url = 'https://id.twitch.tv/oauth2/authorize'
    + '?response_type=token'
    + '&client_id=' + encodeURIComponent(clientId)
    + '&redirect_uri=' + encodeURIComponent(redirectUri)
    + '&scope=' + encodeURIComponent(scopes);

  const popup = window.open(url, 'twitch-auth', 'width=500,height=700');

  // Listen for the callback message
  window.addEventListener('message', handleAuthMessage);

  // Poll in case popup was blocked and user navigated manually
  const interval = setInterval(() => {
    const stored = localStorage.getItem('wheelv2_token');
    if (stored) {
      localStorage.removeItem('wheelv2_token');
      clearInterval(interval);
      onTokenReceived(stored);
    }
  }, 1000);

  // Clean up after 5 minutes
  setTimeout(() => clearInterval(interval), 300000);
}

function handleAuthMessage(event) {
  if (event.origin !== window.location.origin) return;
  if (event.data && event.data.type === 'twitch-token') {
    window.removeEventListener('message', handleAuthMessage);
    onTokenReceived(event.data.token);
  }
}

async function onTokenReceived(token) {
  const error = document.getElementById('step3-error');
  const btn = document.getElementById('connect-btn');
  btn.classList.add('loading');
  error.textContent = '';

  try {
    const resp = await fetch('/api/validate-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token })
    });

    if (!resp.ok) {
      throw new Error('Token validation failed');
    }

    const data = await resp.json();

    // Verify client ID matches
    if (data.client_id !== clientId) {
      error.textContent = 'Token was generated with a different Client ID. Make sure you\'re using the correct Twitch app.';
      btn.classList.remove('loading');
      return;
    }

    accessToken = token;
    twitchLogin = data.login;
    broadcasterId = data.user_id;

    // Show success
    document.getElementById('connect-username').textContent = data.login;
    document.getElementById('connect-status').classList.remove('hidden');
    btn.classList.remove('loading');

    // Enable next
    const nextBtn = document.getElementById('step3-next');
    nextBtn.disabled = false;
    nextBtn.classList.remove('disabled');
  } catch (err) {
    error.textContent = 'Failed to validate token. Please try again.';
    btn.classList.remove('loading');
  }
}

// ── Step 4: Rewards ─────────────────────────────────────────────────────────────

async function loadRewards() {
  const select = document.getElementById('reward-select');
  const error = document.getElementById('step4-error');
  const nextBtn = document.getElementById('step4-next');

  select.disabled = true;
  select.innerHTML = '<option value="">Loading rewards...</option>';
  error.textContent = '';
  nextBtn.disabled = true;
  nextBtn.classList.add('disabled');

  try {
    const resp = await fetch('/api/rewards', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: accessToken, clientId, broadcasterId })
    });

    if (!resp.ok) {
      const data = await resp.json();
      throw new Error(data.error || 'Failed to load rewards');
    }

    const data = await resp.json();

    if (!data.rewards || data.rewards.length === 0) {
      select.innerHTML = '<option value="">No custom rewards found</option>';
      error.textContent = 'Create a custom channel point reward on your Twitch dashboard first, then click the refresh button.';
      return;
    }

    select.innerHTML = '<option value="">-- Select a reward --</option>';
    data.rewards.forEach(r => {
      const opt = document.createElement('option');
      opt.value = r.id;
      opt.textContent = r.title + ' (' + r.cost + ' pts)';
      select.appendChild(opt);
    });

    select.disabled = false;
    select.addEventListener('change', function () {
      if (this.value) {
        selectedRewardId = this.value;
        selectedRewardName = this.options[this.selectedIndex].textContent;
        nextBtn.disabled = false;
        nextBtn.classList.remove('disabled');
      } else {
        nextBtn.disabled = true;
        nextBtn.classList.add('disabled');
      }
    });
  } catch (err) {
    error.textContent = err.message;
    select.innerHTML = '<option value="">Failed to load</option>';
  }
}

function validateStep4() {
  if (!selectedRewardId) {
    document.getElementById('step4-error').textContent = 'Please select a reward.';
    return;
  }
  goToStep(5);
}

// ── Step 5: Summary & Save ──────────────────────────────────────────────────────

function populateSummary() {
  document.getElementById('summary-channel').textContent = twitchLogin;
  document.getElementById('summary-clientid').textContent = clientId.slice(0, 8) + '...';
  document.getElementById('summary-username').textContent = twitchLogin;
  document.getElementById('summary-reward').textContent = selectedRewardName;
}

async function saveAndStart() {
  const error = document.getElementById('step5-error');
  const btn = document.getElementById('save-btn');
  btn.classList.add('loading');
  error.textContent = '';

  try {
    const resp = await fetch('/api/save-config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        twitchChannel: twitchLogin,
        clientId: clientId,
        accessToken: accessToken,
        broadcasterId: broadcasterId,
        redemptionId: selectedRewardId
      })
    });

    if (!resp.ok) {
      const data = await resp.json();
      throw new Error(data.error || 'Failed to save config');
    }

    btn.classList.remove('loading');
    btn.disabled = true;
    btn.textContent = 'Saved!';
    document.getElementById('success-info').classList.remove('hidden');
  } catch (err) {
    error.textContent = err.message;
    btn.classList.remove('loading');
  }
}

// ── Init ────────────────────────────────────────────────────────────────────────

// Check if returning from localStorage fallback
(function init() {
  const stored = localStorage.getItem('wheelv2_token');
  if (stored) {
    localStorage.removeItem('wheelv2_token');
    // We need the clientId first — prompt user to fill it in
  }
})();
