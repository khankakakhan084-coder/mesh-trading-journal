// Mesh Trading Journal - Frontend Application Logic (Monokai + Supabase Cloud Auth + Storage)

let supabaseClient = null;
let currentUser = null;
let isSignUpMode = false;
let isGuestMode = false;

let allTrades = [];
let currentFilter = {
  search: '',
  result: 'ALL',
  direction: 'ALL',
  media: 'ALL'
};
let viewMode = localStorage.getItem('MESH_VIEW_MODE') || 'table'; // 'table' (line strip view - default) or 'grid'
let activeDetailTrade = null;
let equityChartInstance = null;

// File state for uploads
let selectedScreenshotFile = null;
let selectedVideoFile = null;
let removeScreenshotFlag = false;
let removeVideoFlag = false;

// Initialize on Load
function initApp() {
  try { initSupabase(); } catch (e) { console.error('initSupabase error:', e); }
  try { setupClipboardPaste(); } catch (e) { console.error('setupClipboardPaste error:', e); }
  try { setupDragAndDrop(); } catch (e) { console.error('setupDragAndDrop error:', e); }
  try { updatePnlPreview(); } catch (e) { console.error('updatePnlPreview error:', e); }
  try { initCustomSelects(); } catch (e) { console.error('initCustomSelects error:', e); }
  try { initModalBackdropDismiss(); } catch (e) { console.error('initModalBackdropDismiss error:', e); }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}

// ----------------- SUPABASE INITIALIZATION -----------------

const DEFAULT_SUPABASE_URL = "https://eeshenydmkfolrmlzvlt.supabase.co";
const DEFAULT_SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVlc2hlbnlkbWtmb2xybWx6dmx0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQyMTMxMDQsImV4cCI6MjEwOTc4OTEwNH0.IGYnUxTPGRNjeDrDlGjNbk1hm1nrgEwV9Q__sQnvZwo";

function resolveSupabaseCredentials() {
  let url = (window.APP_CONFIG?.SUPABASE_URL || localStorage.getItem('ADIL_SUPABASE_URL') || '').trim();
  let key = (window.APP_CONFIG?.SUPABASE_ANON_KEY || localStorage.getItem('ADIL_SUPABASE_ANON_KEY') || '').trim();

  if (!url || url === 'undefined' || url === 'null' || url.includes('your-project') || !url.startsWith('http')) {
    url = DEFAULT_SUPABASE_URL;
  }
  if (!key || key === 'undefined' || key === 'null' || key.includes('your-anon-key') || key.length < 20) {
    key = DEFAULT_SUPABASE_ANON_KEY;
  }
  return { url, key };
}

// Track if auth init is in progress (prevents double-show of login screen)
let _authInitDone = false;

function initSupabase() {
  const { url, key } = resolveSupabaseCredentials();

  const cfgUrlInput = document.getElementById('cfgSupabaseUrl');
  const cfgKeyInput = document.getElementById('cfgSupabaseKey');
  if (cfgUrlInput && url) cfgUrlInput.value = url;
  if (cfgKeyInput && key) cfgKeyInput.value = key;

  if (window.supabase) {
    try {
      if (!supabaseClient) {
        supabaseClient = window.supabase.createClient(url, key, {
          auth: {
            flowType: 'implicit',
            autoRefreshToken: true,
            persistSession: true,
            detectSessionInUrl: true
          }
        });
        window.supabaseClient = supabaseClient;
      }
      const dbBadge = document.getElementById('dbStatusBadge');
      if (dbBadge) {
        dbBadge.innerText = '● Connected';
        dbBadge.className = 'text-[10px] text-monoGreen';
      }

      // 1. Direct explicit extraction of OAuth hash if present in URL
      const hashStr = window.location.hash ? window.location.hash.substring(1) : '';
      const hashParams = new URLSearchParams(hashStr);
      const hashAccessToken = hashParams.get('access_token');
      const hashRefreshToken = hashParams.get('refresh_token');

      if (hashAccessToken && hashRefreshToken) {
        console.log('[Auth] Detected access_token in URL hash. Calling setSession explicitly...');
        const isFromExplicitOAuth = sessionStorage.getItem('adil_oauth_login_in_progress') === 'true';
        sessionStorage.removeItem('adil_oauth_login_in_progress');
        supabaseClient.auth.setSession({
          access_token: hashAccessToken,
          refresh_token: hashRefreshToken
        }).then(({ data, error }) => {
          if (error) {
            console.warn('[Auth] Explicit setSession error:', error);
          } else if (data?.session?.user) {
            console.log('[Auth] Explicit setSession successful for:', data.session.user.email);
            handleAuthSuccess(data.session.user, isFromExplicitOAuth);
          }
        }).catch(err => {
          console.warn('[Auth] setSession exception:', err);
        });
      }

      // 2. Helper to determine if we just returned from an intentional Google OAuth login redirect
      const checkAndConsumeOAuthLogin = () => {
        const isOAuthPending = sessionStorage.getItem('adil_oauth_login_in_progress') === 'true';
        if (isOAuthPending) {
          sessionStorage.removeItem('adil_oauth_login_in_progress');
          return true;
        }
        return false;
      };

      // 3. Unified Auth Listener: handles INITIAL_SESSION, SIGNED_IN, TOKEN_REFRESHED, SIGNED_OUT
      supabaseClient.auth.onAuthStateChange((event, session) => {
        console.log('[Auth] Event:', event, '| User:', session?.user?.email || 'None');

        if (session && session.user) {
          const isExplicit = checkAndConsumeOAuthLogin();
          handleAuthSuccess(session.user, isExplicit);
        } else if (event === 'SIGNED_OUT') {
          currentUser = null;
          isGuestMode = false;
          showAuthScreen();
        } else if (event === 'INITIAL_SESSION' && !session) {
          // If hash has access token, setSession is processing it; do not kick to login
          if (!hashAccessToken && !currentUser) {
            showAuthScreen();
          }
        }
      });

      return;
    } catch (e) {
      console.warn('Supabase initialization failed:', e);
    }
  } else {
    // Retry polling if window.supabase CDN is loading
    let retries = 0;
    const poll = setInterval(() => {
      retries++;
      if (window.supabase) {
        clearInterval(poll);
        initSupabase();
      } else if (retries > 25) {
        clearInterval(poll);
        if (!currentUser) showAuthScreen();
      }
    }, 200);
  }

  // If no Supabase configured yet
  const dbBadge = document.getElementById('dbStatusBadge');
  if (dbBadge && !supabaseClient) {
    dbBadge.innerText = '○ Connecting...';
    dbBadge.className = 'text-[10px] text-monoYellow';
  }
}

function saveCustomSupabaseConfig() {
  const url = (document.getElementById('cfgSupabaseUrl').value || '').trim();
  const key = (document.getElementById('cfgSupabaseKey').value || '').trim();

  if (!url || !key) {
    showAuthAlert('Please enter both Supabase URL and Anon Key.', 'error');
    return;
  }

  localStorage.setItem('ADIL_SUPABASE_URL', url);
  localStorage.setItem('ADIL_SUPABASE_ANON_KEY', key);

  if (window.APP_CONFIG) {
    window.APP_CONFIG.SUPABASE_URL = url;
    window.APP_CONFIG.SUPABASE_ANON_KEY = key;
  }

  showAuthAlert('Supabase configuration saved! Reconnecting...', 'success');
  setTimeout(() => {
    initSupabase();
  }, 600);
}

// ----------------- AUTH SCREEN CONTROLS -----------------

function showAuthScreen() {
  if (currentUser && currentUser.id && currentUser.id !== 'local_guest') {
    // User is already logged in, do not kick them to login screen
    return;
  }
  isGuestMode = false;
  const screen = document.getElementById('authScreen');
  if (screen) screen.classList.remove('hidden');
}

function hideAuthScreen() {
  const screen = document.getElementById('authScreen');
  if (screen) screen.classList.add('hidden');
}

function resolveUserAvatar(user) {
  if (!user) return null;
  // 1. Check custom uploaded avatar in localStorage
  const custom = localStorage.getItem(`mesh_custom_avatar_${user.id}`) || localStorage.getItem(`adil_custom_avatar_${user.id}`);
  if (custom && custom.trim()) return custom;

  // 2. Check Supabase user metadata
  const meta = user.user_metadata || {};
  if (meta.custom_avatar) return meta.custom_avatar;
  if (meta.avatar_url) return meta.avatar_url;
  if (meta.picture) return meta.picture;

  return null;
}

function resolveUserNames(user) {
  if (!user) return { firstName: 'MESH', displayName: 'Trader' };

  // 1. Check custom saved display name in localStorage
  const custom = localStorage.getItem(`mesh_custom_display_name_${user.id}`) || localStorage.getItem(`adil_custom_display_name_${user.id}`);
  if (custom && custom.trim()) {
    const clean = custom.trim();
    return {
      firstName: clean.split(' ')[0].toUpperCase(),
      displayName: clean
    };
  }

  // 2. Check Supabase user_metadata
  const meta = user.user_metadata || {};
  if (meta.custom_display_name && meta.custom_display_name.trim()) {
    const clean = meta.custom_display_name.trim();
    return {
      firstName: clean.split(' ')[0].toUpperCase(),
      displayName: clean
    };
  }

  if (meta.given_name && meta.given_name.trim()) {
    const given = meta.given_name.trim();
    return {
      firstName: given.toUpperCase(),
      displayName: meta.full_name || meta.name || given
    };
  }

  if (meta.full_name || meta.name) {
    const full = (meta.full_name || meta.name).trim();
    return {
      firstName: full.split(' ')[0].toUpperCase(),
      displayName: full
    };
  }

  // 3. Fallback from email address (e.g. khankakakhan084@gmail.com -> Khan)
  if (user.email) {
    const prefix = user.email.split('@')[0];
    const lettersOnly = prefix.replace(/[^a-zA-Z]/g, ' ').trim().split(/\s+/)[0] || prefix;
    const formatted = lettersOnly.charAt(0).toUpperCase() + lettersOnly.slice(1);
    return {
      firstName: formatted.toUpperCase(),
      displayName: formatted
    };
  }

  return { firstName: 'MESH', displayName: 'Trader' };
}

function handleAuthSuccess(user, isExplicitLogin = false) {
  // Guard: only skip if same user already logged in AND this is NOT a fresh explicit sign-in
  if (currentUser && currentUser.id === user.id && !isExplicitLogin) {
    hideAuthScreen(); // Always ensure auth screen stays hidden
    return;
  }
  currentUser = user;
  window.currentUser = user;
  isGuestMode = false;
  hideAuthScreen();

  if (user && user.email && user.id !== 'local_guest') {
    try {
      localStorage.setItem('ADIL_LAST_GOOGLE_EMAIL', user.email);
    } catch (_) {}
  }

  const { firstName, displayName } = resolveUserNames(user);

  // 1. Update Brand Header Title: [FIRST NAME] JOURNAL
  const brandFirstNameEl = document.getElementById('brandFirstName');
  if (brandFirstNameEl) {
    brandFirstNameEl.innerText = firstName;
  }

  // 2. User Avatar in place of generic stag logo
  const stagLogo = document.getElementById('brandStagLogo');
  const avatarWrapper = document.getElementById('brandUserAvatarWrapper');
  const caret = document.getElementById('profileDropdownCaret');

  const avatarUrl = resolveUserAvatar(user);
  const initialChar = firstName.charAt(0) || 'U';

  if (avatarWrapper) {
    if (avatarUrl) {
      avatarWrapper.innerHTML = `
        <img src="${avatarUrl}" alt="${displayName}" class="h-7 w-7 sm:h-9 sm:w-9 rounded-full ring-2 ring-monoGreen/80 hover:ring-monoGreen object-cover shadow-md transition group-hover:scale-105 active:scale-95 cursor-pointer" />
      `;
    } else {
      avatarWrapper.innerHTML = `
        <div class="h-7 w-7 sm:h-9 sm:w-9 rounded-full bg-monoGreen/20 text-monoGreen font-bold font-mono border border-monoGreen/50 flex items-center justify-center text-xs sm:text-sm ring-2 ring-monoGreen/60 hover:ring-monoGreen group-hover:bg-monoGreen/30 transition group-hover:scale-105 active:scale-95 shadow-sm cursor-pointer">
          ${initialChar}
        </div>
      `;
    }
    avatarWrapper.classList.remove('hidden');
  }
  if (stagLogo) stagLogo.classList.add('hidden');
  if (caret) caret.classList.remove('hidden');

  // 3. Populate Profile Dropdown Menu Details
  const dropdownAvatarEl = document.getElementById('dropdownAvatarEl');
  if (dropdownAvatarEl) {
    if (avatarUrl) {
      dropdownAvatarEl.innerHTML = `
        <img src="${avatarUrl}" alt="${displayName}" class="h-10 w-10 rounded-full ring-2 ring-monoGreen object-cover shadow" />
      `;
    } else {
      dropdownAvatarEl.innerHTML = `
        <div class="h-10 w-10 rounded-full bg-monoGreen/20 text-monoGreen font-bold font-mono border border-monoGreen/50 flex items-center justify-center text-base ring-2 ring-monoGreen/60 shadow-sm">
          ${initialChar}
        </div>
      `;
    }
  }

  const dropdownDisplayName = document.getElementById('dropdownDisplayName');
  if (dropdownDisplayName) dropdownDisplayName.innerText = displayName;

  const dropdownEmail = document.getElementById('dropdownEmail');
  if (dropdownEmail) dropdownEmail.innerText = user.email || 'Local User';

  const dropdownUid = document.getElementById('dropdownUidDisplay');
  if (dropdownUid) dropdownUid.innerText = user.id || '-';

  // 4. Welcome toast on deliberate manual login only (not on every visit or page refresh)
  const sessionWelcomedKey = 'mesh_welcomed_' + (user.id || 'user');
  if (isExplicitLogin && !sessionStorage.getItem(sessionWelcomedKey)) {
    sessionStorage.setItem(sessionWelcomedKey, 'true');
    showToast(`Welcome back, ${displayName}!`, 'success');
  }

  // 5. Clean up OAuth tokens from URL after small tick so Supabase internal storage has written
  if (window.location.search.includes('code=') || window.location.hash.includes('access_token=')) {
    setTimeout(() => {
      try {
        window.history.replaceState({}, document.title, window.location.pathname);
      } catch (_) {}
    }, 150);
  }

  loadData();
}

function enterGuestMode(showWelcomeToast = true) {
  isGuestMode = true;
  localStorage.setItem('MESH_GUEST_MODE', 'true');
  currentUser = { id: 'local_guest', email: 'guest.trader@local' };
  hideAuthScreen();
  handleAuthSuccess(currentUser, false);
  if (showWelcomeToast) {
    showToast('Entered Local Guest Mode. Data saved in browser.', 'info');
  }
}

function handleBrandAvatarClick(e) {
  if (e) {
    e.stopPropagation();
    e.preventDefault();
  }
  // If user is authenticated, direct profile setting window opens
  if (currentUser && currentUser.id !== 'local_guest') {
    closeProfileDropdown();
    openProfileView();
  } else {
    showAuthScreen();
  }
}

function toggleProfileDropdown(e) {
  if (e) e.stopPropagation();
  if (!currentUser || currentUser.id === 'local_guest') return;
  const dd = document.getElementById('userProfileDropdown');
  const caret = document.getElementById('profileDropdownCaret');
  if (dd) {
    const isClosed = dd.classList.contains('hidden') || dd.classList.contains('dropdown-closing');
    if (isClosed) {
      dd.classList.remove('hidden', 'dropdown-closing');
      if (caret) caret.classList.add('rotate-180');
    } else {
      closeProfileDropdown();
    }
  }
}

function closeProfileDropdown() {
  const dd = document.getElementById('userProfileDropdown');
  const caret = document.getElementById('profileDropdownCaret');
  if (dd && !dd.classList.contains('hidden') && !dd.classList.contains('dropdown-closing')) {
    dd.classList.add('dropdown-closing');
    setTimeout(() => {
      dd.classList.add('hidden');
      dd.classList.remove('dropdown-closing');
    }, 140);
  }
  if (caret) caret.classList.remove('rotate-180');
}

document.addEventListener('click', (e) => {
  const dd = document.getElementById('userProfileDropdown');
  const btn = document.getElementById('brandProfileBtn');
  const titleBtn = document.getElementById('brandTitleBtn');
  if (dd && !dd.classList.contains('hidden')) {
    if (!dd.contains(e.target) && (!btn || !btn.contains(e.target)) && (!titleBtn || !titleBtn.contains(e.target))) {
      closeProfileDropdown();
    }
  }
});

function copyUserIdToClipboard() {
  if (!currentUser || !currentUser.id) return;
  navigator.clipboard.writeText(currentUser.id).then(() => {
    const flashBtn = (id, sizeClass = 'w-3.5 h-3.5') => {
      const btn = document.getElementById(id);
      if (!btn) return;
      btn.innerHTML = `
        <svg class="${sizeClass} text-monoGreen" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 13l4 4L19 7" />
        </svg>
      `;
      setTimeout(() => {
        btn.innerHTML = `
          <svg class="${sizeClass}" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
          </svg>
        `;
      }, 1800);
    };
    flashBtn('copyUidBtn', 'w-3.5 h-3.5');
    flashBtn('fullProfileCopyUidBtn', 'w-4 h-4');
    showToast('Account UID copied!', 'success');
  }).catch(() => {
    showToast('UID: ' + currentUser.id, 'info');
  });
}

// State for pending uploaded DP
let pendingAvatarDataUrl = null;

function openProfileView() {
  if (!currentUser) return;
  closeProfileDropdown();
  const screen = document.getElementById('fullProfileScreen');
  if (!screen) return;

  pendingAvatarDataUrl = null;
  const { displayName } = resolveUserNames(currentUser);
  const avatarUrl = resolveUserAvatar(currentUser);
  const initialChar = (displayName || 'U').charAt(0).toUpperCase();

  const nameInput = document.getElementById('fullProfileNameInput');
  if (nameInput) nameInput.value = displayName;

  const emailEl = document.getElementById('fullProfileEmailDisplay');
  if (emailEl) emailEl.innerText = currentUser.email || 'Local User';

  const uidEl = document.getElementById('fullProfileUidDisplay');
  if (uidEl) uidEl.innerText = currentUser.id || '-';

  renderProfilePreviewAvatar(avatarUrl, displayName, initialChar);

  screen.classList.remove('hidden');
  document.body.classList.add('overflow-hidden');
}

function closeProfileView() {
  const screen = document.getElementById('fullProfileScreen');
  if (screen) screen.classList.add('hidden');
  document.body.classList.remove('overflow-hidden');
  pendingAvatarDataUrl = null;
}

function renderProfilePreviewAvatar(avatarUrl, displayName, initialChar) {
  const preview = document.getElementById('fullProfileAvatarPreview');
  if (!preview) return;
  if (avatarUrl) {
    preview.innerHTML = `<img src="${avatarUrl}" alt="${displayName || 'Profile'}" class="w-full h-full object-cover" />`;
  } else {
    preview.innerHTML = `<div class="w-full h-full bg-monoGreen/20 text-monoGreen font-bold font-mono text-2xl flex items-center justify-center">${initialChar}</div>`;
  }
}

function handleProfilePhotoChange(e) {
  const file = e.target.files?.[0];
  if (!file) return;

  if (!file.type.startsWith('image/')) {
    showToast('Please select an image file (PNG, JPG, WEBP, GIF).', 'error');
    return;
  }

  if (file.size > 5 * 1024 * 1024) {
    showToast('Image file size must be under 5 MB.', 'error');
    return;
  }

  const reader = new FileReader();
  reader.onload = (loadEvt) => {
    const img = new Image();
    img.onload = () => {
      // Scale down image to max 320x320 square for fast local/cloud sync
      const canvas = document.createElement('canvas');
      const maxDim = 320;
      const width = img.width;
      const height = img.height;

      // Crop to square from center
      const minDim = Math.min(width, height);
      const startX = (width - minDim) / 2;
      const startY = (height - minDim) / 2;

      canvas.width = maxDim;
      canvas.height = maxDim;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, startX, startY, minDim, minDim, 0, 0, maxDim, maxDim);

      const optimizedDataUrl = canvas.toDataURL('image/jpeg', 0.88);
      pendingAvatarDataUrl = optimizedDataUrl;

      const { displayName } = resolveUserNames(currentUser);
      const initialChar = (displayName || 'U').charAt(0).toUpperCase();
      renderProfilePreviewAvatar(optimizedDataUrl, displayName, initialChar);
      showToast('New DP selected! Click "Save Changes" to apply.', 'info');
    };
    img.src = loadEvt.target.result;
  };
  reader.readAsDataURL(file);
}

function handleRemoveProfilePhoto() {
  pendingAvatarDataUrl = 'REMOVE';
  const defaultGoogleUrl = currentUser?.user_metadata?.avatar_url || currentUser?.user_metadata?.picture;
  const { displayName } = resolveUserNames(currentUser);
  const initialChar = (displayName || 'U').charAt(0).toUpperCase();

  renderProfilePreviewAvatar(defaultGoogleUrl || null, displayName, initialChar);
  showToast('DP reset to default. Click "Save Changes" to apply.', 'info');
}

async function handleSaveProfile(e) {
  if (e) e.preventDefault();
  if (!currentUser) return;

  const nameInput = document.getElementById('fullProfileNameInput');
  const newName = (nameInput ? nameInput.value : '').trim();
  if (!newName) {
    showToast('Please enter a display name.', 'error');
    return;
  }

  // 1. Save Display Name
  localStorage.setItem(`mesh_custom_display_name_${currentUser.id}`, newName);
  localStorage.setItem(`adil_custom_display_name_${currentUser.id}`, newName);

  // 2. Save Avatar DP
  if (pendingAvatarDataUrl === 'REMOVE') {
    localStorage.removeItem(`mesh_custom_avatar_${currentUser.id}`);
    localStorage.removeItem(`adil_custom_avatar_${currentUser.id}`);
  } else if (pendingAvatarDataUrl) {
    localStorage.setItem(`mesh_custom_avatar_${currentUser.id}`, pendingAvatarDataUrl);
    localStorage.setItem(`adil_custom_avatar_${currentUser.id}`, pendingAvatarDataUrl);
  }

  // 3. Update Supabase Metadata
  if (supabaseClient && currentUser.id !== 'local_guest') {
    const updatePayload = {
      custom_display_name: newName,
      full_name: newName
    };
    if (pendingAvatarDataUrl === 'REMOVE') {
      updatePayload.custom_avatar = null;
    } else if (pendingAvatarDataUrl) {
      updatePayload.custom_avatar = pendingAvatarDataUrl;
      updatePayload.avatar_url = pendingAvatarDataUrl;
    }

    try {
      await supabaseClient.auth.updateUser({ data: updatePayload });
    } catch (err) {
      console.warn('Could not sync profile to Supabase metadata:', err);
    }
  }

  closeProfileView();
  showToast('Profile updated successfully!', 'success');
  handleAuthSuccess(currentUser, false);
}

function toggleAuthMode() {
  isSignUpMode = !isSignUpMode;
  const submitText = document.getElementById('authSubmitText');
  const toggleBtn = document.getElementById('authModeToggleBtn');
  const subtitle = document.getElementById('authSubtitle');

  if (isSignUpMode) {
    submitText.innerText = 'Create Account';
    toggleBtn.innerText = 'Already have an account? Sign In';
    if (subtitle) subtitle.innerText = 'Choose a username and password to create your journal account.';
  } else {
    submitText.innerText = 'Sign In';
    toggleBtn.innerText = "Don't have an account? Sign Up";
    if (subtitle) subtitle.innerText = 'Sign in to access and sync your personal trade journal.';
  }
  clearAuthAlert();
}

function showAuthAlert(msg, type = 'error') {
  const alertEl = document.getElementById('authAlert');
  alertEl.classList.remove('hidden', 'border-monoPink', 'text-monoPink', 'bg-monoPink/10', 'border-monoGreen', 'text-monoGreen', 'bg-monoGreen/10');
  if (type === 'error') {
    alertEl.classList.add('border-monoPink', 'text-monoPink', 'bg-monoPink/10');
  } else {
    alertEl.classList.add('border-monoGreen', 'text-monoGreen', 'bg-monoGreen/10');
  }
  const cleanMsg = String(msg || '')
    .replace(/[\p{Extended_Pictographic}\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F1E6}-\u{1F1FF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{1F900}-\u{1F9FF}\u{1FA70}-\u{1FAFF}]/gu, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  alertEl.innerText = cleanMsg;
}

function clearAuthAlert() {
  document.getElementById('authAlert').classList.add('hidden');
  document.getElementById('authAlert').innerText = '';
}

// ----------------- AUTH ACTIONS -----------------

// 1. Continue with Google (Gmail)
async function signInWithGoogle() {
  clearAuthAlert();
  if (!supabaseClient) {
    initSupabase();
  }
  if (!supabaseClient) {
    showAuthAlert('Connecting to authentication service... Please try again in 2 seconds.', 'error');
    return;
  }

  try {
    sessionStorage.setItem('adil_oauth_login_in_progress', 'true');

    // Retrieve previous or typed email to pass as login_hint to Google
    const emailInput = document.getElementById('authEmail');
    const typedEmail = (emailInput ? emailInput.value : '').trim().toLowerCase();
    const lastEmail = localStorage.getItem('ADIL_LAST_GOOGLE_EMAIL') || '';
    const hintEmail = (typedEmail && typedEmail.includes('@')) ? typedEmail : (lastEmail.includes('@') ? lastEmail : '');

    const options = {
      redirectTo: window.location.origin + '/app'
    };

    // By omitting prompt: 'consent', Google will not force the "Choose an account" screen!
    // And if hintEmail is provided, Google selects that account directly.
    if (hintEmail) {
      options.queryParams = {
        login_hint: hintEmail
      };
    }

    const { data, error } = await supabaseClient.auth.signInWithOAuth({
      provider: 'google',
      options
    });

    if (error) {
      sessionStorage.removeItem('adil_oauth_login_in_progress');
      if (error.message?.toLowerCase().includes('not enabled') || error.message?.toLowerCase().includes('unsupported provider')) {
        showAuthAlert('Google Provider ko Supabase Dashboard mein enable karna hoga (Auth -> Providers -> Google).', 'error');
      } else {
        showAuthAlert(error.message, 'error');
      }
    }
  } catch (err) {
    sessionStorage.removeItem('adil_oauth_login_in_progress');
    if (err.message?.toLowerCase().includes('not enabled') || err.message?.toLowerCase().includes('unsupported provider')) {
      showAuthAlert('Google Provider ko Supabase Dashboard mein enable karna hoga (Auth -> Providers -> Google).', 'error');
    } else {
      showAuthAlert('Google Sign-In failed: ' + err.message, 'error');
    }
  }
}

// 2. Gmail / Email & Password Auth (Sign In or Sign Up - No Username)
async function handleEmailAuth(e) {
  e.preventDefault();
  clearAuthAlert();

  const emailInput = document.getElementById('authEmail');
  const email = (emailInput ? emailInput.value : '').trim().toLowerCase();
  const password = document.getElementById('authPassword').value;

  if (!email || !password) {
    showAuthAlert('Please enter your email and password.', 'error');
    return;
  }

  if (!email.includes('@') || !email.includes('.')) {
    showAuthAlert('Please enter a valid Gmail address.', 'error');
    return;
  }

  if (!supabaseClient) {
    initSupabase();
  }
  if (!supabaseClient) {
    showAuthAlert('Connecting to authentication service... Please try again in 2 seconds.', 'error');
    return;
  }

  const spinner = document.getElementById('authSpinner');
  const btn = document.getElementById('authSubmitBtn');
  btn.disabled = true;
  spinner.classList.remove('hidden');

  try {
    if (isSignUpMode) {
      // Sign Up with Email
      const { data, error } = await supabaseClient.auth.signUp({
        email,
        password
      });

      if (error) {
        showAuthAlert(error.message, 'error');
      } else {
        if (data.session) {
          handleAuthSuccess(data.user, true);
        } else {
          // Attempt immediate auto-login since email is auto-confirmed in DB
          const loginRes = await supabaseClient.auth.signInWithPassword({ email, password });
          if (loginRes.data?.user) {
            handleAuthSuccess(loginRes.data.user, true);
          } else {
            showAuthAlert('Account created successfully! Please sign in with your password below.', 'success');
            toggleAuthMode();
          }
        }
      }
    } else {
      // Sign In with Email
      const { data, error } = await supabaseClient.auth.signInWithPassword({
        email,
        password
      });

      if (error) {
        showAuthAlert(error.message, 'error');
      } else if (data.user) {
        handleAuthSuccess(data.user, true);
      }
    }
  } catch (err) {
    showAuthAlert('Authentication error: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
    spinner.classList.add('hidden');
  }
}

// 3. Sign Out
async function handleSignOut() {
  localStorage.removeItem('MESH_GUEST_MODE');
  localStorage.removeItem('ADIL_GUEST_MODE');
  sessionStorage.removeItem('adil_oauth_login_in_progress');
  if (currentUser?.id) {
    sessionStorage.removeItem('mesh_welcomed_' + currentUser.id);
  }
  if (supabaseClient) {
    await supabaseClient.auth.signOut();
  }
  currentUser = null;
  isGuestMode = false;
  allTrades = [];
  renderTrades();

  // Reset Brand Header & Logo
  const brandFirstNameEl = document.getElementById('brandFirstName');
  if (brandFirstNameEl) brandFirstNameEl.innerText = 'MESH';

  const stagLogo = document.getElementById('brandStagLogo');
  const avatarWrapper = document.getElementById('brandUserAvatarWrapper');
  const caret = document.getElementById('profileDropdownCaret');

  if (stagLogo) stagLogo.classList.remove('hidden');
  if (avatarWrapper) {
    avatarWrapper.classList.add('hidden');
    avatarWrapper.innerHTML = '';
  }
  if (caret) caret.classList.add('hidden');

  closeProfileDropdown();
  showAuthScreen();
  showToast('Signed out successfully.', 'info');
  setTimeout(() => {
    window.location.href = '/';
  }, 500);
}

// ----------------- DATA FETCHING (SUPABASE / LOCAL) -----------------

async function loadData() {
  if (!currentUser) return;
  await Promise.all([fetchTrades(), fetchStats()]);
}

async function fetchTrades() {
  if (supabaseClient && currentUser && currentUser.id !== 'local_guest') {
    try {
      const { data, error } = await supabaseClient
        .from('trades')
        .select('*')
        .eq('user_id', currentUser.id)
        .order('created_at', { ascending: false });

      if (error) {
        console.warn('Supabase query error:', error);
        fallbackLocalFetch();
      } else {
        allTrades = data || [];
        renderTrades();
      }
      return;
    } catch (e) {
      console.warn('Supabase fetch failed, falling back to local server:', e);
    }
  }

  // Fallback to local server or localStorage
  fallbackLocalFetch();
}

async function fallbackLocalFetch() {
  try {
    const res = await fetch('/api/trades');
    const data = await res.json();
    if (data.success) {
      allTrades = data.trades;
      renderTrades();
    }
  } catch (err) {
    // If static on Vercel without local server, load from localStorage
    const saved = localStorage.getItem('ADIL_LOCAL_TRADES');
    allTrades = saved ? JSON.parse(saved) : [];
    renderTrades();
  }
}

async function fetchStats() {
  updateStatsFromTradesList(allTrades);
}

function updateStatsFromTradesList(trades) {
  let wins = 0;
  let losses = 0;
  let breakevens = 0;
  let totalR = 0;
  let grossWinsR = 0;
  let grossLossR = 0;

  trades.forEach((t) => {
    const res = (t.result || '').toUpperCase();
    const rVal = parseFloat(t.pnl) || 0;

    if (res === 'WIN') {
      wins++;
      grossWinsR += Math.max(0, rVal);
    } else if (res === 'LOSS') {
      losses++;
      grossLossR += Math.abs(Math.min(0, rVal));
    } else if (res === 'BREAKEVEN') {
      breakevens++;
    }

    totalR += rVal;
  });

  const totalTrades = wins + losses + breakevens;
  const winRate = totalTrades > 0 ? ((wins / totalTrades) * 100).toFixed(1) : '0.0';
  const profitFactor = grossLossR > 0 ? (grossWinsR / grossLossR).toFixed(2) : grossWinsR > 0 ? 'MAX' : '0.00';

  document.getElementById('statTotalTrades').innerText = totalTrades;
  document.getElementById('statWinRate').innerText = `${winRate}%`;
  document.getElementById('statWins').innerText = wins;
  document.getElementById('statLosses').innerText = losses;
  document.getElementById('statBE').innerText = breakevens;

  const rPrefix = totalR > 0 ? '+' : '';
  const rElem = document.getElementById('statTotalR');
  rElem.innerText = `${rPrefix}${totalR.toFixed(1)}R`;
  rElem.className = `text-2xl sm:text-3xl font-bold font-mono ${totalR >= 0 ? 'text-[#a6e22e]' : 'text-[#f92672]'}`;

  document.getElementById('statProfitFactor').innerText = profitFactor;

  // Equity Curve
  const chronological = [...trades].sort((a, b) => new Date(a.created_at || a.createdAt || a.date) - new Date(b.created_at || b.createdAt || b.date));
  let runningR = 0;
  const equityCurve = chronological.map((t, idx) => {
    runningR += parseFloat(t.pnl) || 0;
    return {
      index: idx + 1,
      date: t.date,
      pair: t.pair,
      result: t.result,
      pnl: parseFloat(t.pnl) || 0,
      cumulativeR: Number(runningR.toFixed(2))
    };
  });

  renderEquityChart(equityCurve);
}

// ----------------- RENDER EQUITY CURVE (MONOKAI) -----------------

function renderEquityChart(curveData) {
  const ctx = document.getElementById('equityChart');
  if (!ctx) return;

  if (equityChartInstance) {
    equityChartInstance.destroy();
  }

  if (!curveData || curveData.length === 0) {
    curveData = [{ tradeIndex: 0, date: 'Start', cumulativeR: 0 }];
  } else {
    curveData = [{ tradeIndex: 0, date: 'Baseline', cumulativeR: 0 }, ...curveData];
  }

  const labels = curveData.map((d, i) => (i === 0 ? 'Start' : `T#${i}`));
  const values = curveData.map((d) => d.cumulativeR);

  const lastValue = values[values.length - 1] || 0;
  const isPositive = lastValue >= 0;

  equityChartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels: labels,
      datasets: [
        {
          label: 'Cumulative R',
          data: values,
          borderColor: isPositive ? '#a6e22e' : '#f92672',
          backgroundColor: isPositive ? 'rgba(166, 226, 46, 0.08)' : 'rgba(249, 38, 114, 0.08)',
          fill: true,
          tension: 0.25,
          borderWidth: 2.5,
          pointBackgroundColor: isPositive ? '#a6e22e' : '#f92672',
          pointBorderColor: '#272822',
          pointBorderWidth: 2,
          pointRadius: values.length > 25 ? 2 : 4,
          pointHoverRadius: 6
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        mode: 'index',
        intersect: false,
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          displayColors: false,
          backgroundColor: '#1e1f1c',
          borderColor: '#3e3d32',
          borderWidth: 1,
          cornerRadius: 10,
          padding: { top: 8, bottom: 8, left: 12, right: 12 },
          titleColor: '#66d9ef',
          titleFont: { size: 12, family: 'JetBrains Mono', weight: 'bold' },
          bodyColor: '#F8F8F2',
          bodyFont: { size: 12, family: 'JetBrains Mono', weight: 'bold' },
          callbacks: {
            title: function (items) {
              if (!items || !items.length) return '';
              const idx = items[0].dataIndex;
              const d = curveData[idx];
              if (!d || idx === 0) return 'Start';
              return d.pair ? `T#${idx} (${d.pair})` : `T#${idx}`;
            },
            label: function (ctx) {
              const val = ctx.parsed.y;
              const sign = val >= 0 ? '+' : '';
              return `Cumulative: ${sign}${val}R`;
            },
            labelTextColor: function (ctx) {
              const val = ctx.parsed.y;
              return val >= 0 ? '#a6e22e' : '#f92672';
            }
          }
        }
      },
      scales: {
        x: {
          grid: { color: 'rgba(62, 61, 50, 0.4)' },
          ticks: { color: '#75715e', font: { size: 10, family: 'JetBrains Mono' } }
        },
        y: {
          grid: { color: 'rgba(62, 61, 50, 0.4)' },
          ticks: {
            color: '#75715e',
            font: { size: 10, family: 'JetBrains Mono' },
            callback: (v) => `${v >= 0 ? '+' : ''}${v}R`
          }
        }
      }
    }
  });
}

// ================= MASTER PAIRS & PREDICTIVE SEARCH =================
const MASTER_PAIRS = [
  { symbol: 'XAUUSD', name: 'Gold / US Dollar', cat: 'Commodity', keywords: ['gold', 'xau', 'sona'] },
  { symbol: 'EURUSD', name: 'Euro / US Dollar', cat: 'Forex', keywords: ['euro', 'eur', 'fiber'] },
  { symbol: 'GBPUSD', name: 'British Pound / USD', cat: 'Forex', keywords: ['pound', 'gbp', 'cable'] },
  { symbol: 'BTCUSDT', name: 'Bitcoin / Tether', cat: 'Crypto', keywords: ['bitcoin', 'btc', 'crypto'] },
  { symbol: 'ETHUSDT', name: 'Ethereum / Tether', cat: 'Crypto', keywords: ['ethereum', 'eth', 'ether'] },
  { symbol: 'SOLUSDT', name: 'Solana / Tether', cat: 'Crypto', keywords: ['solana', 'sol'] },
  { symbol: 'NAS100', name: 'Nasdaq 100 Index', cat: 'Index', keywords: ['nasdaq', 'nas', 'us100', 'tech'] },
  { symbol: 'US30', name: 'Dow Jones 30', cat: 'Index', keywords: ['dow', 'dowjones', 'dj30', 'wall street'] },
  { symbol: 'SPX500', name: 'S&P 500 Index', cat: 'Index', keywords: ['sp500', 'spx', 's&p', 'us500'] },
  { symbol: 'USDJPY', name: 'US Dollar / Yen', cat: 'Forex', keywords: ['yen', 'jpy', 'ninja'] },
  { symbol: 'AUDUSD', name: 'Australian Dollar / USD', cat: 'Forex', keywords: ['aussie', 'aud'] },
  { symbol: 'USDCAD', name: 'US Dollar / CAD', cat: 'Forex', keywords: ['loonie', 'cad'] },
  { symbol: 'USDCHF', name: 'US Dollar / Swiss Franc', cat: 'Forex', keywords: ['swissie', 'chf'] },
  { symbol: 'NZDUSD', name: 'New Zealand Dollar / USD', cat: 'Forex', keywords: ['kiwi', 'nzd'] },
  { symbol: 'EURGBP', name: 'Euro / British Pound', cat: 'Forex', keywords: ['chunnel', 'eurgbp'] },
  { symbol: 'EURJPY', name: 'Euro / Japanese Yen', cat: 'Forex', keywords: ['eurjpy', 'euy'] },
  { symbol: 'GBPJPY', name: 'British Pound / Yen', cat: 'Forex', keywords: ['geppy', 'dragon', 'guppy', 'gbpjpy'] },
  { symbol: 'XAGUSD', name: 'Silver / US Dollar', cat: 'Commodity', keywords: ['silver', 'xag', 'chandi'] },
  { symbol: 'USOIL', name: 'WTI Crude Oil', cat: 'Commodity', keywords: ['oil', 'crude', 'wti', 'petrol'] },
  { symbol: 'GER40', name: 'German DAX 40', cat: 'Index', keywords: ['dax', 'dax40', 'germany'] }
];

function renderDynamicPairSuggestions() {
  const slider = document.getElementById('allPairsSlider');
  if (!slider) return;

  // 1. Collect user's recently traded pairs in chronological order (most recent first)
  const recentMap = new Map();
  const sortedTrades = [...(allTrades || [])].sort((a, b) => {
    const da = new Date(a.created_at || a.createdAt || a.date || 0);
    const db = new Date(b.created_at || b.createdAt || b.date || 0);
    return db - da;
  });

  sortedTrades.forEach(t => {
    if (t.pair) {
      const sym = t.pair.trim().toUpperCase();
      if (!recentMap.has(sym)) {
        const master = MASTER_PAIRS.find(m => m.symbol === sym);
        recentMap.set(sym, master || { symbol: sym, name: 'Your Trade History', cat: 'Recent', keywords: [] });
      }
    }
  });

  // 2. Combine: recent pairs first, then remaining MASTER_PAIRS
  const seen = new Set();
  const orderedList = [];
  recentMap.forEach((meta, sym) => {
    seen.add(sym);
    orderedList.push(meta);
  });

  MASTER_PAIRS.forEach(m => {
    if (!seen.has(m.symbol)) {
      seen.add(m.symbol);
      orderedList.push(m);
    }
  });

  // 3. Render into horizontal slider
  slider.innerHTML = orderedList.map(item => `
    <button
      type="button"
      onclick="setPairChip('${item.symbol}')"
      class="chip-btn shrink-0 whitespace-nowrap"
      title="${item.name} (${item.cat})"
    >
      ${item.symbol}
    </button>
  `).join('');
}

function scrollPairSlider(delta) {
  const slider = document.getElementById('allPairsSlider');
  if (slider) {
    slider.scrollBy({ left: delta, behavior: 'smooth' });
  }
}

function handlePairInput(e) {
  const input = document.getElementById('inputPair');
  const menu = document.getElementById('pairPredictionsMenu');
  if (!input || !menu) return;

  const rawQ = (input.value || '').trim();
  const q = rawQ.toUpperCase();
  const qLower = rawQ.toLowerCase();
  if (!q) {
    menu.classList.add('hidden');
    menu.innerHTML = '';
    return;
  }

  // Combine user past pairs + MASTER_PAIRS preserving real names & aliases
  const pairMap = new Map();
  MASTER_PAIRS.forEach(p => {
    pairMap.set(p.symbol, { ...p, isRecent: false });
  });

  (allTrades || []).forEach(t => {
    if (t.pair) {
      const sym = t.pair.trim().toUpperCase();
      if (pairMap.has(sym)) {
        pairMap.get(sym).isRecent = true;
      } else {
        pairMap.set(sym, { symbol: sym, name: 'Your Trade History', cat: 'Recent', keywords: [], isRecent: true });
      }
    }
  });

  const matches = Array.from(pairMap.values()).filter(p => {
    const symMatch = p.symbol.includes(q);
    const nameMatch = p.name && p.name.toLowerCase().includes(qLower);
    const keyMatch = p.keywords && p.keywords.some(k => k.toLowerCase().includes(qLower) || qLower.includes(k.toLowerCase()));
    return symMatch || nameMatch || keyMatch;
  }).sort((a, b) => {
    // Exact symbol match first
    if (a.symbol === q) return -1;
    if (b.symbol === q) return 1;
    // Starts with query
    if (a.symbol.startsWith(q) && !b.symbol.startsWith(q)) return -1;
    if (!a.symbol.startsWith(q) && b.symbol.startsWith(q)) return 1;
    // Recent trades next
    if (a.isRecent && !b.isRecent) return -1;
    if (!a.isRecent && b.isRecent) return 1;
    return 0;
  }).slice(0, 6);

  if (matches.length === 0) {
    menu.classList.add('hidden');
    menu.innerHTML = '';
    return;
  }

  menu.innerHTML = matches.map((m, idx) => `
    <div
      onclick="selectPredictedPair('${m.symbol}')"
      class="px-3 py-2 text-xs font-mono flex items-center justify-between hover:bg-monoCardElevated cursor-pointer transition ${idx === 0 ? 'bg-monoCardElevated/50' : ''}"
    >
      <div class="flex items-center space-x-2 min-w-0">
        <span class="font-bold text-monoFg shrink-0">${highlightPairMatch(m.symbol, rawQ)}</span>
        <span class="text-[10px] text-monoMuted truncate max-w-[160px]">${highlightPairMatch(m.name, rawQ)}</span>
      </div>
      <span class="text-[10px] px-1.5 py-0.5 rounded bg-monoBg text-monoGreen font-semibold shrink-0 ml-2">${m.cat}</span>
    </div>
  `).join('');
  menu.classList.remove('hidden');
}

function highlightPairMatch(text, query) {
  if (!query || !text) return text;
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return text;
  return text.substring(0, idx) +
    '<span class="text-monoGreen font-extrabold underline">' + text.substring(idx, idx + query.length) + '</span>' +
    text.substring(idx + query.length);
}

function selectPredictedPair(symbol) {
  const input = document.getElementById('inputPair');
  const menu = document.getElementById('pairPredictionsMenu');
  if (input) input.value = symbol;
  if (menu) {
    menu.classList.add('hidden');
    menu.innerHTML = '';
  }
}

function handlePairKeydown(e) {
  const menu = document.getElementById('pairPredictionsMenu');
  if (!menu || menu.classList.contains('hidden')) return;
  if (e.key === 'Enter' || e.key === 'Tab') {
    const firstOption = menu.querySelector('div[onclick]');
    if (firstOption) {
      e.preventDefault();
      firstOption.click();
    }
  } else if (e.key === 'Escape') {
    menu.classList.add('hidden');
  }
}

document.addEventListener('click', (e) => {
  const menu = document.getElementById('pairPredictionsMenu');
  const input = document.getElementById('inputPair');
  if (menu && !menu.classList.contains('hidden')) {
    if (!menu.contains(e.target) && e.target !== input) {
      menu.classList.add('hidden');
    }
  }
});

// ================= DYNAMIC R:R & STEPPER =================
function renderDynamicRRSuggestions() {
  const container = document.getElementById('dynamicRRContainer');
  if (!container) return;

  const freqMap = {};
  (allTrades || []).forEach(t => {
    if (t.rr) {
      const val = t.rr.trim();
      freqMap[val] = (freqMap[val] || 0) + 1;
    }
  });

  const sortedUserRR = Object.keys(freqMap).sort((a, b) => freqMap[b] - freqMap[a]);
  const defaultFallbacks = ['1:1', '1:2', '1:3', '1:4', '1:5'];
  const topRRs = [];

  sortedUserRR.forEach(r => {
    if (!topRRs.includes(r) && topRRs.length < 5) topRRs.push(r);
  });
  defaultFallbacks.forEach(r => {
    if (!topRRs.includes(r) && topRRs.length < 5) topRRs.push(r);
  });

  container.innerHTML = topRRs.map(rr => `
    <button type="button" onclick="setRRChip('${rr}')" class="chip-btn">${rr}</button>
  `).join('');
}

function stepRR(delta) {
  const rrInput = document.getElementById('inputRR');
  if (!rrInput) return;
  let val = 2.0;
  const cur = (rrInput.value || '').trim();
  if (cur) {
    const parts = cur.replace(/\s+/g, '').split(':');
    const parsed = parseFloat(parts.length > 1 ? parts[1] : parts[0]);
    if (!isNaN(parsed) && parsed > 0) val = parsed;
  }
  val = Math.max(0.5, Math.round((val + delta) * 10) / 10);
  rrInput.value = `1:${val}`;
  updatePnlPreview();
}

function handleToggleNotes(checked) {
  const container = document.getElementById('notesContainer');
  const input = document.getElementById('inputNotes');
  if (!container) return;
  if (checked) {
    container.classList.remove('hidden');
    setTimeout(() => { if (input) input.focus(); }, 60);
  } else {
    container.classList.add('hidden');
  }
}

// ----------------- AUTO-CALCULATE PNL PREVIEW -----------------

function updatePnlPreview() {
  const resultElem = document.getElementById('inputResult');
  const rrElem = document.getElementById('inputRR');
  const previewText = document.getElementById('pnlPreviewText');
  const previewBox = document.getElementById('pnlPreviewBox');
  if (!resultElem || !rrElem || !previewText || !previewBox) return;

  const result = resultElem.value;
  const rrStr = (rrElem.value || '').trim();

  let targetR = 1.0;
  if (rrStr) {
    const parts = rrStr.replace(/\s+/g, '').split(':');
    const val = parseFloat(parts.length > 1 ? parts[1] : parts[0]);
    if (!isNaN(val) && val > 0) targetR = val;
  }

  if (result === 'WIN') {
    previewText.innerText = `+${targetR}R`;
    previewText.className = 'text-[#a6e22e] font-bold font-mono text-base';
    previewBox.className = 'w-full px-3.5 py-2.5 bg-[#272822] border border-[#a6e22e]/40 rounded-xl font-mono flex items-center justify-center';
  } else if (result === 'LOSS') {
    previewText.innerText = `-1.0R`;
    previewText.className = 'text-[#f92672] font-bold font-mono text-base';
    previewBox.className = 'w-full px-3.5 py-2.5 bg-[#272822] border border-[#f92672]/40 rounded-xl font-mono flex items-center justify-center';
  } else {
    // BREAKEVEN
    previewText.innerText = `0.0R`;
    previewText.className = 'text-[#e6db74] font-bold font-mono text-base';
    previewBox.className = 'w-full px-3.5 py-2.5 bg-[#272822] border border-[#e6db74]/40 rounded-xl font-mono flex items-center justify-center';
  }
}

function setPairChip(pair) {
  const input = document.getElementById('inputPair');
  if (input) {
    input.value = pair;
    input.classList.add('ring-2', 'ring-monoGreen');
    setTimeout(() => input.classList.remove('ring-2', 'ring-monoGreen'), 260);
  }
  const menu = document.getElementById('pairPredictionsMenu');
  if (menu) menu.classList.add('hidden');
}

function setRRChip(rr) {
  const input = document.getElementById('inputRR');
  if (input) {
    input.value = rr;
    input.classList.add('ring-2', 'ring-monoGreen');
    setTimeout(() => input.classList.remove('ring-2', 'ring-monoGreen'), 260);
  }
  updatePnlPreview();
}

// ----------------- FILTER & SEARCH -----------------

function applyFilters() {
  currentFilter.search = (document.getElementById('searchInput').value || '').trim().toLowerCase();
  currentFilter.result = document.getElementById('filterResult').value;
  currentFilter.direction = document.getElementById('filterDirection').value;
  currentFilter.media = document.getElementById('filterMedia').value;
  renderTrades();
}

function setViewMode(mode) {
  viewMode = mode;
  localStorage.setItem('MESH_VIEW_MODE', mode);
  updateViewModeButtons();
  renderTrades();
}

function updateViewModeButtons() {
  const gridBtn = document.getElementById('viewGridBtn');
  const tableBtn = document.getElementById('viewTableBtn');
  if (gridBtn && tableBtn) {
    if (viewMode === 'grid') {
      gridBtn.className = 'px-2 sm:px-2.5 py-1 rounded-lg text-xs font-bold text-[#272822] bg-[#a6e22e] transition cursor-pointer';
      tableBtn.className = 'px-2 sm:px-2.5 py-1 rounded-lg text-xs font-medium text-[#75715e] hover:text-[#F8F8F2] transition cursor-pointer';
    } else {
      tableBtn.className = 'px-2 sm:px-2.5 py-1 rounded-lg text-xs font-bold text-[#272822] bg-[#a6e22e] transition cursor-pointer';
      gridBtn.className = 'px-2 sm:px-2.5 py-1 rounded-lg text-xs font-medium text-[#75715e] hover:text-[#F8F8F2] transition cursor-pointer';
    }
  }
  updateMobileNavViewIcon(viewMode);
}

function updateMobileNavViewIcon(mode) {
  const icon = document.getElementById('mobileViewIconTable');
  const text = document.getElementById('mobileViewText');
  if (text) {
    text.textContent = mode === 'grid' ? 'List' : 'Grid';
  }
  if (icon) {
    if (mode === 'grid') {
      icon.innerHTML = '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.2" d="M4 6h16M4 10h16M4 14h16M4 18h16" />';
    } else {
      icon.innerHTML = '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.2" d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />';
    }
  }
}

function toggleMobileViewMode() {
  const nextMode = viewMode === 'table' ? 'grid' : 'table';
  setViewMode(nextMode);
}

function scrollToSection(id) {
  const el = document.getElementById(id);
  if (el) {
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  const tradesBtn = document.getElementById('mobileNavTrades');
  const statsBtn = document.getElementById('mobileNavStats');
  if (tradesBtn && statsBtn) {
    if (id === 'tradesContainer') {
      tradesBtn.classList.add('active');
      statsBtn.classList.remove('active');
    } else if (id === 'equityChartSection') {
      statsBtn.classList.add('active');
      tradesBtn.classList.remove('active');
    }
  }
}

function scrollToSearch() {
  const el = document.getElementById('searchInput');
  if (el) {
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setTimeout(() => {
      try {
        el.focus();
      } catch (e) {}
    }, 350);
  }
}

// ----------------- RENDER TRADES -----------------

function renderTrades() {
  const container = document.getElementById('tradesContainer');
  if (!container) return;

  const filtered = allTrades.filter((t) => {
    if (currentFilter.search) {
      const q = currentFilter.search.toLowerCase().trim();
      const pair = (t.pair || '').toLowerCase();
      const notes = (t.notes || '').toLowerCase();
      let match = pair.includes(q) || notes.includes(q);

      // Match by real name or alias (e.g. searching "gold" finds XAUUSD trades)
      if (!match) {
        const found = MASTER_PAIRS.find(m => {
          if (m.symbol.toLowerCase() !== pair) return false;
          if (m.name.toLowerCase().includes(q)) return true;
          if (m.keywords && m.keywords.some(k => k.includes(q) || q.includes(k))) return true;
          return false;
        });
        if (found) match = true;
      }

      if (!match) return false;
    }

    if (currentFilter.result !== 'ALL' && t.result !== currentFilter.result) return false;
    if (currentFilter.direction !== 'ALL' && t.direction !== currentFilter.direction) return false;

    if (currentFilter.media === 'HAS_SCREENSHOT' && !t.screenshot) return false;
    if (currentFilter.media === 'HAS_VIDEO' && !t.video) return false;

    return true;
  });

  if (filtered.length === 0) {
    const isFilteredSearch = allTrades.length > 0;
    container.innerHTML = `
      <div class="bg-[#1e1f1c] border border-[#3e3d32] rounded-2xl p-10 sm:p-14 text-center">
        <div class="w-16 h-16 rounded-2xl bg-[#2e2f28] border border-[#3e3d32] text-[#a6e22e] flex items-center justify-center mx-auto mb-4 shadow-xl">
          <svg class="w-8 h-8" viewBox="0 0 24 24" fill="none" stroke="currentColor">
            <line x1="6" y1="4" x2="6" y2="20" stroke-width="1.8" stroke-linecap="round" opacity="0.6"/>
            <rect x="4.5" y="8" width="3" height="7" rx="0.5" fill="#a6e22e" fill-opacity="0.25" stroke-width="1.8"/>
            <line x1="12" y1="2" x2="12" y2="22" stroke-width="1.8" stroke-linecap="round"/>
            <rect x="10.5" y="5" width="3" height="10" rx="0.5" fill="#a6e22e" stroke-width="1.8"/>
            <line x1="18" y1="6" x2="18" y2="19" stroke-width="1.8" stroke-linecap="round" opacity="0.6"/>
            <rect x="16.5" y="9" width="3" height="6" rx="0.5" fill="#a6e22e" fill-opacity="0.25" stroke-width="1.8"/>
          </svg>
        </div>
        <h3 class="text-base font-bold text-[#F8F8F2] mb-1 font-mono">No Trades Found</h3>
        ${isFilteredSearch ? '<p class="text-xs text-[#75715e] max-w-sm mx-auto mb-4 font-mono">No trades match your active filter/search.</p>' : '<div class="mb-4"></div>'}
        <button onclick="openNewTradeModal()" class="inline-flex items-center px-4 py-2 rounded-xl text-xs font-bold bg-[#a6e22e] hover:bg-[#b8f041] text-[#272822] shadow-lg transition active:scale-95 cursor-pointer font-mono">
          + Log Your First Trade
        </button>
      </div>
    `;
    return;
  }

  if (viewMode === 'table') {
    renderTableView(filtered, container);
  } else {
    renderGridView(filtered, container);
  }

  updateStatsFromTradesList(allTrades);
}

// ----------------- GRID VIEW -----------------

function renderGridView(trades, container) {
  let html = `<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">`;

  trades.forEach((t) => {
    const isWin = t.result === 'WIN';
    const isLoss = t.result === 'LOSS';
    const isLong = t.direction === 'LONG';

    const pnlPrefix = t.pnl > 0 ? '+' : '';
    const pnlColor = isWin ? 'text-[#a6e22e]' : isLoss ? 'text-[#f92672]' : 'text-[#e6db74]';

    html += `
      <div
        onclick="openDetailModal('${t.id}')"
        class="trade-card rounded-2xl p-4 cursor-pointer flex flex-col justify-between group"
      >
        <div>
          <!-- Card Header: Pair, Direction, Result -->
          <div class="flex items-center justify-between mb-3">
            <div class="flex items-center space-x-2.5">
              <span class="text-xs font-extrabold font-mono ${isLong ? 'text-[#a6e22e]' : 'text-[#f92672]'}">
                ${isLong ? 'BUY' : 'SELL'}
              </span>
              <h3 class="text-base font-extrabold text-[#F8F8F2] font-mono group-hover:text-[#a6e22e] transition">${t.pair}</h3>
            </div>

            <!-- Result (no pill bar, clean text) -->
            <span class="text-xs font-extrabold font-mono ${
              isWin ? 'text-[#a6e22e]' :
              isLoss ? 'text-[#f92672]' :
              'text-[#e6db74]'
            }">
              ${t.result}
            </span>
          </div>

          <!-- R:R & Auto Return -->
          <div class="flex items-center justify-between py-2 border-y border-[#3e3d32] my-2">
            <div>
              <span class="text-[10px] text-[#75715e] uppercase tracking-wider block font-mono">Risk:Reward</span>
              <span class="text-xs font-mono font-bold text-[#F8F8F2]">${t.rr || 'N/A'}</span>
            </div>
            <div class="text-right">
              <span class="text-[10px] text-[#75715e] uppercase tracking-wider block font-mono">Return</span>
              <span class="text-sm font-mono font-bold ${pnlColor}">${pnlPrefix}${t.pnl}R</span>
            </div>
          </div>

          <!-- Screenshot Preview -->
          ${t.screenshot ? `
            <div class="my-3 relative rounded-xl overflow-hidden bg-black/60 border border-[#3e3d32] h-32 flex items-center justify-center">
              <img src="${t.screenshot}" alt="${t.pair} Screenshot" class="w-full h-full object-cover group-hover:scale-105 transition duration-300" />
              <div class="absolute bottom-1 right-1 bg-black/80 text-[10px] text-[#66d9ef] px-1.5 py-0.5 rounded flex items-center font-mono">
                <svg class="w-3 h-3 mr-1 text-[#66d9ef]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                </svg>
                Screenshot
              </div>
            </div>
          ` : ''}

          <!-- Video Indicator Badge -->
          ${t.video ? `
            <div class="my-2 flex items-center px-2.5 py-1.5 rounded-lg bg-[#ae81ff]/10 border border-[#ae81ff]/30 text-[#ae81ff] text-xs font-mono font-medium">
              <svg class="w-4 h-4 mr-1.5 text-[#ae81ff]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
              <span>🎥 Video Recording Attached</span>
            </div>
          ` : ''}

          <!-- Notes Snippet -->
          ${t.notes ? `
            <p class="text-xs text-[#F8F8F2]/80 line-clamp-2 mt-2 font-mono">
              ${escapeHtml(t.notes)}
            </p>
          ` : ''}
        </div>

        <!-- Recorded Date Footer -->
        <div class="text-[11px] text-[#75715e] pt-2.5 mt-2.5 border-t border-[#3e3d32] flex items-center justify-between font-mono">
          <span class="flex items-center">
            <svg class="w-3.5 h-3.5 mr-1 text-[#75715e]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            ${t.date || ''}
          </span>
          <span class="text-[#a6e22e] font-mono text-xs font-semibold group-hover:text-[#b8f041] transition">View &rarr;</span>
        </div>
      </div>
    `;
  });

  html += `</div>`;
  container.innerHTML = html;
}

// ----------------- LINE / STRIP VIEW (DEFAULT - MATCHES IMG1) -----------------

function renderTableView(trades, container) {
  let html = `<div class="space-y-2.5 sm:space-y-3">`;

  trades.forEach((t) => {
    const isWin = t.result === 'WIN';
    const isLoss = t.result === 'LOSS';
    const isBE = t.result === 'BREAKEVEN';
    const isLong = t.direction === 'LONG' || t.direction === 'BUY';

    // R:R Display (matches img1: e.g. "1:2.50 R:R" or "1:3.20 R:R")
    let rrVal = (t.rr || '').toString().trim();
    let rrDisplay = '';
    if (rrVal) {
      if (!rrVal.startsWith('1:')) {
        rrDisplay = `1:${rrVal}`;
      } else {
        rrDisplay = rrVal;
      }
    }

    // PnL Display (only digits with R, e.g. "+2.50R", "-1R" - no WIN/LOSS text needed)
    const pnlPrefix = t.pnl > 0 ? '+' : '';
    const pnlColor = isWin ? 'text-[#a6e22e]' : isLoss ? 'text-[#f92672]' : 'text-[#e6db74]';
    const pnlText = `${pnlPrefix}${t.pnl}R`;

    html += `
      <div
        onclick="openDetailModal('${t.id}')"
        class="trade-strip-card flex items-center justify-between px-3.5 py-3 sm:px-5 sm:py-3.5 bg-[#1e1f1c] border border-[#3e3d32] rounded-xl sm:rounded-2xl cursor-pointer hover:border-[#a6e22e] transition group"
      >
        <!-- Left Section: Direction + Pair + Notes Snippet + Media Icons -->
        <div class="flex items-center space-x-2.5 sm:space-x-3.5 min-w-0 pr-3">
          <!-- Direction (Clean text, no pill bar) -->
          <span class="text-xs sm:text-sm font-extrabold font-mono uppercase tracking-wider shrink-0 ${
            isLong ? 'text-[#a6e22e]' : 'text-[#f92672]'
          }">
            ${isLong ? 'LONG' : 'SHORT'}
          </span>

          <div class="min-w-0">
            <div class="flex items-center space-x-1.5 sm:space-x-2">
              <span class="text-xs sm:text-sm font-bold text-[#F8F8F2] font-mono shrink-0 group-hover:text-[#a6e22e] transition">
                ${t.pair}
              </span>
              <!-- Media Icons: Sleek minimalist SVGs (no emojis) -->
              ${t.screenshot ? `
                <span title="Screenshot Attached" class="inline-flex items-center text-[#66d9ef] hover:text-[#a6e22e] transition shrink-0">
                  <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                </span>` : ''}
              ${t.video ? `
                <span title="Video Recording Attached" class="inline-flex items-center text-[#ae81ff] hover:text-[#a6e22e] transition shrink-0">
                  <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                </span>` : ''}
            </div>
            <!-- Mobile Subtitle: Date & R:R (Hidden on sm:) -->
            <div class="text-[10px] text-[#75715e] font-mono sm:hidden truncate mt-0.5">
              ${t.date ? `<span>${t.date}</span>` : ''}
              ${t.date && rrDisplay ? `<span> • </span>` : ''}
              ${rrDisplay ? `<span>${rrDisplay} R:R</span>` : ''}
            </div>
          </div>

          <!-- Notes Snippet -->
          ${t.notes ? `
            <span class="text-xs text-[#a6a28c] font-mono truncate max-w-xs md:max-w-md hidden sm:inline ml-2">
              ${escapeHtml(t.notes)}
            </span>
          ` : ''}
        </div>

        <!-- Right Section: R:R & Return / Result -->
        <div class="flex items-center space-x-3 sm:space-x-5 shrink-0 font-mono text-xs sm:text-sm">
          ${rrDisplay ? `
            <span class="text-[#75715e] hidden sm:inline">
              ${rrDisplay} R:R
            </span>
          ` : ''}
          <span class="font-bold ${pnlColor} whitespace-nowrap text-xs sm:text-sm">
            ${pnlText}
          </span>
        </div>
      </div>
    `;
  });

  html += `</div>`;
  container.innerHTML = html;
}

// ----------------- CLIENT-SIDE WEBP COMPRESSION -----------------

function compressImageToWebP(file, quality = 0.82) {
  return new Promise((resolve) => {
    const img = new Image();
    const reader = new FileReader();

    reader.onload = (e) => {
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;
        const maxDimension = 2560;

        if (width > maxDimension || height > maxDimension) {
          if (width > height) {
            height = Math.round((height * maxDimension) / width);
            width = maxDimension;
          } else {
            width = Math.round((width * maxDimension) / height);
            height = maxDimension;
          }
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);

        canvas.toBlob(
          (blob) => {
            if (!blob) {
              return resolve({ file, originalSize: file.size, compressedSize: file.size, previewUrl: e.target.result });
            }

            const cleanBaseName = (file.name || 'screenshot').replace(/\.[^/.]+$/, '').replace(/[^a-zA-Z0-9_-]/g, '_');
            const compressedFile = new File([blob], `${cleanBaseName}.webp`, {
              type: 'image/webp',
              lastModified: Date.now()
            });

            const previewUrl = URL.createObjectURL(blob);
            resolve({
              file: compressedFile,
              originalSize: file.size,
              compressedSize: blob.size,
              previewUrl
            });
          },
          'image/webp',
          quality
        );
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

// ----------------- MEDIA HANDLING (DRAG, DROP, PASTE) -----------------

async function previewAndCompressImage(file) {
  removeScreenshotFlag = false;

  const infoEl = document.getElementById('imageCompressInfo');
  if (infoEl) {
    infoEl.classList.remove('hidden');
    infoEl.innerText = 'Converting to lightweight WebP...';
  }

  const result = await compressImageToWebP(file);
  selectedScreenshotFile = result.file;

  document.getElementById('imagePlaceholder').classList.add('hidden');
  document.getElementById('imagePreviewContainer').classList.remove('hidden');
  document.getElementById('imagePreview').src = result.previewUrl;

  const savedPercent = Math.max(0, Math.round(((result.originalSize - result.compressedSize) / result.originalSize) * 100));

  if (infoEl) {
    infoEl.innerText = `WebP: ${formatBytes(result.originalSize)} ➔ ${formatBytes(result.compressedSize)} (${savedPercent}% saved)`;
    infoEl.className = 'mt-1.5 text-xs font-mono font-bold text-[#a6e22e]';
  }
}

function handleImageSelect(e) {
  const file = e.target.files[0];
  if (file) {
    previewAndCompressImage(file);
  }
}

function removeImagePreview() {
  selectedScreenshotFile = null;
  removeScreenshotFlag = true;
  document.getElementById('inputScreenshot').value = '';
  document.getElementById('imagePreview').src = '';
  document.getElementById('imagePreviewContainer').classList.add('hidden');
  document.getElementById('imagePlaceholder').classList.remove('hidden');

  const infoEl = document.getElementById('imageCompressInfo');
  if (infoEl) {
    infoEl.innerText = '';
    infoEl.classList.add('hidden');
  }
}

function handleVideoSelect(e) {
  const file = e.target.files[0];
  if (file) {
    previewVideoFile(file);
  }
}

function previewVideoFile(file) {
  selectedVideoFile = file;
  removeVideoFlag = false;

  const url = URL.createObjectURL(file);
  document.getElementById('videoPlaceholder').classList.add('hidden');
  document.getElementById('videoPreviewContainer').classList.remove('hidden');
  document.getElementById('videoPreview').src = url;

  const infoEl = document.getElementById('videoCompressInfo');
  if (infoEl) {
    infoEl.classList.remove('hidden');
    infoEl.innerText = `Video: ${formatBytes(file.size)}`;
  }
}

function removeVideoPreview() {
  selectedVideoFile = null;
  removeVideoFlag = true;
  document.getElementById('inputVideo').value = '';
  document.getElementById('videoPreview').src = '';
  document.getElementById('videoPreviewContainer').classList.add('hidden');
  document.getElementById('videoPlaceholder').classList.remove('hidden');

  const infoEl = document.getElementById('videoCompressInfo');
  if (infoEl) {
    infoEl.innerText = '';
    infoEl.classList.add('hidden');
  }
}

// CLIPBOARD PASTE SUPPORT (Ctrl+V)
function setupClipboardPaste() {
  window.addEventListener('paste', async (e) => {
    const modal = document.getElementById('tradeModal');
    if (!modal || modal.classList.contains('hidden')) return;

    const items = (e.clipboardData || e.originalEvent.clipboardData).items;
    for (const item of items) {
      if (item.type.indexOf('image') !== -1) {
        const file = item.getAsFile();
        if (file) {
          await previewAndCompressImage(file);
          showToast('Screenshot pasted & compressed to WebP!', 'success');
          break;
        }
      }
    }
  });
}

// DRAG AND DROP SETUP
function setupDragAndDrop() {
  const imgDrop = document.getElementById('imageDropZone');
  const vidDrop = document.getElementById('videoDropZone');

  ['dragenter', 'dragover'].forEach((name) => {
    if (imgDrop) {
      imgDrop.addEventListener(name, (e) => {
        e.preventDefault();
        imgDrop.classList.add('border-[#a6e22e]', 'bg-[#2e2f28]');
      });
    }
    if (vidDrop) {
      vidDrop.addEventListener(name, (e) => {
        e.preventDefault();
        vidDrop.classList.add('border-[#ae81ff]', 'bg-[#2e2f28]');
      });
    }
  });

  ['dragleave', 'drop'].forEach((name) => {
    if (imgDrop) {
      imgDrop.addEventListener(name, (e) => {
        e.preventDefault();
        imgDrop.classList.remove('border-[#a6e22e]', 'bg-[#2e2f28]');
      });
    }
    if (vidDrop) {
      vidDrop.addEventListener(name, (e) => {
        e.preventDefault();
        vidDrop.classList.remove('border-[#ae81ff]', 'bg-[#2e2f28]');
      });
    }
  });

  if (imgDrop) {
    imgDrop.addEventListener('drop', (e) => {
      const file = e.dataTransfer.files[0];
      if (file && file.type.startsWith('image/')) {
        previewAndCompressImage(file);
      }
    });
  }

  if (vidDrop) {
    vidDrop.addEventListener('drop', (e) => {
      const file = e.dataTransfer.files[0];
      if (file && file.type.startsWith('video/')) {
        previewVideoFile(file);
      }
    });
  }
}

// ----------------- SAVE / UPDATE TRADE (SUPABASE + CLOUD) -----------------

// Uploads a media file directly to Supabase Storage bucket 'trade-media'
async function uploadMediaToSupabaseStorage(file, folder = 'screenshots') {
  if (!supabaseClient || !currentUser) return null;
  try {
    const ext = file.name.split('.').pop();
    const cleanName = `${currentUser.id}/${folder}/${Date.now()}_${Math.random().toString(36).substring(2, 7)}.${ext}`;

    const { data, error } = await supabaseClient.storage
      .from('trade-media')
      .upload(cleanName, file, { upsert: true });

    if (error) {
      console.warn('Supabase storage upload error:', error);
      return null;
    }

    const { data: pubData } = supabaseClient.storage
      .from('trade-media')
      .getPublicUrl(cleanName);

    return pubData ? pubData.publicUrl : null;
  } catch (err) {
    console.error('Storage upload exception:', err);
    return null;
  }
}

async function saveTrade(e) {
  e.preventDefault();

  const editId = document.getElementById('editTradeId').value;
  const isEdit = !!editId;

  const saveBtn = document.getElementById('saveBtn');
  const saveBtnText = document.getElementById('saveBtnText');
  const saveSpinner = document.getElementById('saveSpinner');
  saveBtn.disabled = true;
  saveSpinner.classList.remove('hidden');
  saveBtnText.innerText = 'Saving Trade...';

  try {
    const pair = document.getElementById('inputPair').value.trim().toUpperCase();
    const direction = document.querySelector('input[name="direction"]:checked').value;
    const rr = document.getElementById('inputRR').value.trim();
    const result = document.getElementById('inputResult').value;
    const notesSwitch = document.getElementById('toggleNotesSwitch');
    const notes = (notesSwitch && notesSwitch.checked) ? document.getElementById('inputNotes').value.trim() : '';

    // Calculate PnL
    let pnl = 1.0;
    if (result === 'LOSS') {
      pnl = -1.0;
    } else if (result === 'BREAKEVEN') {
      pnl = 0.0;
    } else {
      if (rr) {
        const parts = rr.replace(/\s+/g, '').split(':');
        const val = parseFloat(parts.length > 1 ? parts[1] : parts[0]);
        if (!isNaN(val) && val > 0) pnl = val;
      }
    }

    // Handle Supabase Cloud Saving
    if (supabaseClient && currentUser && currentUser.id !== 'local_guest') {
      let screenshotUrl = null;
      let videoUrl = null;

      const existingTrade = isEdit ? allTrades.find((t) => t.id === editId) : null;
      if (existingTrade) {
        screenshotUrl = existingTrade.screenshot;
        videoUrl = existingTrade.video;
      }

      if (selectedScreenshotFile) {
        saveBtnText.innerText = 'Uploading Screenshot...';
        const uploadedImg = await uploadMediaToSupabaseStorage(selectedScreenshotFile, 'screenshots');
        if (uploadedImg) screenshotUrl = uploadedImg;
      } else if (removeScreenshotFlag) {
        screenshotUrl = null;
      }

      const tradeRow = {
        id: isEdit ? editId : 'trade_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
        user_id: currentUser.id,
        user_email: currentUser.email,
        pair,
        direction,
        rr,
        result,
        pnl,
        notes,
        screenshot: screenshotUrl,
        video: videoUrl,
        date: new Date().toISOString().split('T')[0],
        time: new Date().toTimeString().split(' ')[0].substring(0, 5),
        updated_at: new Date().toISOString()
      };

      if (!isEdit) {
        tradeRow.created_at = new Date().toISOString();
      }

      const { data, error } = isEdit
        ? await supabaseClient.from('trades').update(tradeRow).eq('id', editId).select()
        : await supabaseClient.from('trades').insert(tradeRow).select();

      if (error) {
        throw new Error('Supabase save error: ' + error.message);
      }

      showToast(isEdit ? 'Trade updated in Supabase cloud!' : 'Trade saved to your Gmail account!', 'success');
      closeTradeModal();
      await fetchTrades();
      return;
    }

    // Fallback: Local Server Saving or LocalStorage
    const formData = new FormData();
    formData.append('pair', pair);
    formData.append('direction', direction);
    formData.append('rr', rr);
    formData.append('result', result);
    formData.append('notes', notes);

    if (selectedScreenshotFile) {
      formData.append('screenshot', selectedScreenshotFile);
    } else if (removeScreenshotFlag) {
      formData.append('removeScreenshot', 'true');
    }

    if (selectedVideoFile) {
      formData.append('video', selectedVideoFile);
    } else if (removeVideoFlag) {
      formData.append('removeVideo', 'true');
    }

    const url = isEdit ? `/api/trades/${editId}` : '/api/trades';
    const method = isEdit ? 'PUT' : 'POST';

    try {
      const res = await fetch(url, { method, body: formData });
      const data = await res.json();
      if (data.success) {
        showToast('Trade saved to file!', 'success');
        closeTradeModal();
        await loadData();
        return;
      }
    } catch (e) {
      // LocalStorage mode if static
      const localTrade = {
        id: isEdit ? editId : 'trade_' + Date.now(),
        pair,
        direction,
        rr,
        result,
        pnl,
        notes,
        date: new Date().toISOString().split('T')[0],
        time: new Date().toTimeString().split(' ')[0].substring(0, 5),
        screenshot: selectedScreenshotFile ? URL.createObjectURL(selectedScreenshotFile) : (isEdit ? allTrades.find(t=>t.id===editId)?.screenshot : null),
        video: selectedVideoFile ? URL.createObjectURL(selectedVideoFile) : (isEdit ? allTrades.find(t=>t.id===editId)?.video : null),
      };

      if (isEdit) {
        const idx = allTrades.findIndex(t => t.id === editId);
        if (idx !== -1) allTrades[idx] = localTrade;
      } else {
        allTrades.unshift(localTrade);
      }
      localStorage.setItem('ADIL_LOCAL_TRADES', JSON.stringify(allTrades));
      showToast('Trade saved in local storage!', 'success');
      closeTradeModal();
      renderTrades();
    }
  } catch (err) {
    console.error('Error saving trade:', err);
    showToast('Error saving: ' + err.message, 'error');
  } finally {
    saveBtn.disabled = false;
    saveBtnText.innerText = isEdit ? 'Update Trade' : 'Save Trade';
    saveSpinner.classList.add('hidden');
  }
}

// ----------------- MODAL ANIMATION HELPER -----------------

function closeModalAnimated(modalId, onClosed) {
  const modal = document.getElementById(modalId);
  if (!modal || modal.classList.contains('hidden')) {
    if (onClosed) onClosed();
    return;
  }
  if (modal.classList.contains('modal-closing')) return;

  modal.classList.add('modal-closing');
  setTimeout(() => {
    modal.classList.add('hidden');
    modal.classList.remove('modal-closing');
    if (onClosed) onClosed();
  }, 160);
}

// ----------------- NEW / EDIT TRADE MODAL -----------------

function openNewTradeModal() {
  document.getElementById('modalTitle').innerText = 'Log Trade';
  document.getElementById('saveBtnText').innerText = 'Save Trade';
  document.getElementById('editTradeId').value = '';
  document.getElementById('tradeForm').reset();

  removeImagePreview();
  if (typeof removeVideoPreview === 'function') {
    try { removeVideoPreview(); } catch (e) {}
  }
  document.getElementById('inputResult').value = 'WIN';
  closeAllCustomSelects();
  initCustomSelects();
  syncCustomSelect('inputResult');
  updatePnlPreview();

  // Reset Trade Notes toggle (default untoggled/hidden)
  const notesSwitch = document.getElementById('toggleNotesSwitch');
  const notesContainer = document.getElementById('notesContainer');
  if (notesSwitch) notesSwitch.checked = false;
  if (notesContainer) notesContainer.classList.add('hidden');
  const notesInput = document.getElementById('inputNotes');
  if (notesInput) notesInput.value = '';

  // Render dynamic user pair & R:R suggestions
  renderDynamicPairSuggestions();
  renderDynamicRRSuggestions();

  const predMenu = document.getElementById('pairPredictionsMenu');
  if (predMenu) predMenu.classList.add('hidden');

  const modal = document.getElementById('tradeModal');
  modal.classList.remove('modal-closing');
  modal.classList.remove('hidden');
}

function openEditTradeModal(trade) {
  document.getElementById('modalTitle').innerText = `Edit Trade: ${trade.pair}`;
  document.getElementById('saveBtnText').innerText = 'Update Trade';
  document.getElementById('editTradeId').value = trade.id;

  document.getElementById('inputPair').value = trade.pair || '';
  const dirRadio = document.querySelector(`input[name="direction"][value="${trade.direction}"]`);
  if (dirRadio) dirRadio.checked = true;

  document.getElementById('inputRR').value = trade.rr || '';
  document.getElementById('inputResult').value = trade.result || 'WIN';
  closeAllCustomSelects();
  initCustomSelects();
  syncCustomSelect('inputResult');

  // Handle Notes Toggle state for existing trade
  const notesSwitch = document.getElementById('toggleNotesSwitch');
  const notesContainer = document.getElementById('notesContainer');
  const notesInput = document.getElementById('inputNotes');
  const hasNotes = !!(trade.notes && trade.notes.trim());
  if (notesSwitch) notesSwitch.checked = hasNotes;
  if (notesContainer) {
    if (hasNotes) notesContainer.classList.remove('hidden');
    else notesContainer.classList.add('hidden');
  }
  if (notesInput) notesInput.value = trade.notes || '';

  // Render dynamic pair & R:R suggestions
  renderDynamicPairSuggestions();
  renderDynamicRRSuggestions();

  const predMenu = document.getElementById('pairPredictionsMenu');
  if (predMenu) predMenu.classList.add('hidden');

  updatePnlPreview();

  // Existing image preview
  if (trade.screenshot) {
    document.getElementById('imagePlaceholder').classList.add('hidden');
    document.getElementById('imagePreviewContainer').classList.remove('hidden');
    document.getElementById('imagePreview').src = trade.screenshot;
    removeScreenshotFlag = false;
  } else {
    removeImagePreview();
  }

  selectedScreenshotFile = null;

  const modal = document.getElementById('tradeModal');
  modal.classList.remove('modal-closing');
  modal.classList.remove('hidden');
}

function closeTradeModal() {
  closeAllCustomSelects();
  closeModalAnimated('tradeModal');
}

// ----------------- DETAIL MODAL -----------------

function openDetailModal(tradeId) {
  const trade = allTrades.find((t) => t.id === tradeId);
  if (!trade) return;
  activeDetailTrade = trade;

  const isWin = trade.result === 'WIN';
  const isLoss = trade.result === 'LOSS';
  const isLong = trade.direction === 'LONG';

  // Badges
  const dirBadge = document.getElementById('detailDirectionBadge');
  if (dirBadge) {
    dirBadge.innerText = isLong ? 'BUY' : 'SELL';
    dirBadge.className = `text-xs sm:text-sm font-extrabold font-mono ${
      isLong ? 'text-[#a6e22e]' : 'text-[#f92672]'
    }`;
  }

  document.getElementById('detailPair').innerText = trade.pair;

  const resBadge = document.getElementById('detailResultBadge');
  if (resBadge) {
    resBadge.innerText = '';
    resBadge.className = 'hidden';
  }

  document.getElementById('detailRRBadge').innerText = `R:R ${trade.rr || '-'}`;

  const pnlBadge = document.getElementById('detailPnlBadge');
  const pnlPrefix = trade.pnl > 0 ? '+' : '';
  pnlBadge.innerText = `${pnlPrefix}${trade.pnl}R`;
  pnlBadge.className = `text-xs sm:text-sm font-bold font-mono ${isWin ? 'text-[#a6e22e]' : isLoss ? 'text-[#f92672]' : 'text-[#e6db74]'}`;

  // Date
  document.getElementById('detailDateTime').innerText = `Logged on: ${trade.date || ''} ${trade.time || ''}`;

  // Screenshot
  const ssSec = document.getElementById('detailScreenshotSection');
  if (trade.screenshot) {
    ssSec.classList.remove('hidden');
    document.getElementById('detailScreenshotImg').src = trade.screenshot;
    document.getElementById('detailScreenshotLink').href = trade.screenshot;
  } else {
    ssSec.classList.add('hidden');
  }

  // Video
  const vidSec = document.getElementById('detailVideoSection');
  const vidPlayer = document.getElementById('detailVideoPlayer');
  if (trade.video) {
    vidSec.classList.remove('hidden');
    vidPlayer.src = trade.video;
  } else {
    vidSec.classList.add('hidden');
    vidPlayer.pause();
    vidPlayer.src = '';
  }

  // Notes
  document.getElementById('detailNotes').innerText = trade.notes || 'No trade notes recorded.';

  const modal = document.getElementById('detailModal');
  modal.classList.remove('modal-closing');
  modal.classList.remove('hidden');
}

function closeDetailModal() {
  const vidPlayer = document.getElementById('detailVideoPlayer');
  if (vidPlayer) {
    vidPlayer.pause();
    vidPlayer.src = '';
  }
  closeModalAnimated('detailModal');
}

function editCurrentTrade() {
  if (!activeDetailTrade) return;
  const trade = activeDetailTrade;
  closeModalAnimated('detailModal', () => {
    openEditTradeModal(trade);
  });
}

async function deleteCurrentTrade() {
  if (!activeDetailTrade) return;
  const confirmDelete = confirm(`Are you sure you want to delete this ${activeDetailTrade.pair} trade?`);
  if (!confirmDelete) return;

  try {
    if (supabaseClient && currentUser && currentUser.id !== 'local_guest') {
      const { error } = await supabaseClient.from('trades').delete().eq('id', activeDetailTrade.id);
      if (error) throw error;
      showToast('Trade deleted from Supabase cloud', 'info');
      closeDetailModal();
      await fetchTrades();
      return;
    }

    // Local delete
    try {
      const res = await fetch(`/api/trades/${activeDetailTrade.id}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        showToast('Trade deleted from file', 'info');
        closeDetailModal();
        await loadData();
        return;
      }
    } catch (e) {
      allTrades = allTrades.filter(t => t.id !== activeDetailTrade.id);
      localStorage.setItem('ADIL_LOCAL_TRADES', JSON.stringify(allTrades));
      showToast('Trade deleted locally', 'info');
      closeDetailModal();
      renderTrades();
    }
  } catch (err) {
    console.error('Error deleting trade:', err);
    showToast('Failed to delete trade: ' + err.message, 'error');
  }
}

// ----------------- LIGHTBOX -----------------

function openLightbox(src) {
  document.getElementById('lightboxImg').src = src;
  const modal = document.getElementById('lightboxModal');
  modal.classList.remove('modal-closing');
  modal.classList.remove('hidden');
}

function closeLightbox() {
  closeModalAnimated('lightboxModal');
}

// ----------------- IMPORT & EXPORT -----------------

function exportTradesJSON() {
  const dataToExport = Array.isArray(allTrades) ? allTrades : [];
  if (dataToExport.length === 0) {
    showToast('No trades found to export. Log some trades first!', 'info');
    return;
  }

  try {
    const jsonStr = JSON.stringify(dataToExport, null, 2);
    const dateStr = new Date().toISOString().split('T')[0];
    const filename = `strifare_trades_${dateStr}.json`;

    let blob;
    try {
      blob = new Blob([jsonStr], { type: 'application/json;charset=utf-8' });
    } catch (e) {
      const BlobBuilder = window.BlobBuilder || window.WebKitBlobBuilder || window.MozBlobBuilder;
      const bb = new BlobBuilder();
      bb.append(jsonStr);
      blob = bb.getBlob('application/json;charset=utf-8');
    }

    if (window.navigator && window.navigator.msSaveOrOpenBlob) {
      window.navigator.msSaveOrOpenBlob(blob, filename);
    } else {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.style.display = 'none';
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();

      // Keep object URL alive so Chrome download manager has ample time to complete reading the stream
      setTimeout(() => {
        if (document.body.contains(a)) {
          document.body.removeChild(a);
        }
        setTimeout(() => {
          try { URL.revokeObjectURL(url); } catch (_) {}
        }, 60000);
      }, 1000);
    }

    showToast(`Exported ${dataToExport.length} trade${dataToExport.length > 1 ? 's' : ''} successfully!`, 'success');
  } catch (err) {
    console.error('Export error:', err);
    try {
      const jsonStr = JSON.stringify(dataToExport, null, 2);
      const dateStr = new Date().toISOString().split('T')[0];
      const a = document.createElement('a');
      a.href = 'data:application/json;charset=utf-8,' + encodeURIComponent(jsonStr);
      a.download = `strifare_trades_${dateStr}.json`;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { if (document.body.contains(a)) document.body.removeChild(a); }, 1000);
      showToast(`Exported ${dataToExport.length} trade${dataToExport.length > 1 ? 's' : ''} successfully!`, 'success');
    } catch (fallbackErr) {
      showToast('Failed to export trades: ' + err.message, 'error');
    }
  }
}

function openImportModal() {
  const modal = document.getElementById('importModal');
  modal.classList.remove('modal-closing');
  modal.classList.remove('hidden');
}

function closeImportModal() {
  closeModalAnimated('importModal');
}

async function handleImport(e) {
  e.preventDefault();
  const fileInput = document.getElementById('importFile');
  if (!fileInput.files[0]) return;

  const mode = document.querySelector('input[name="importMode"]:checked').value;
  const reader = new FileReader();

  reader.onload = async (evt) => {
    try {
      const parsed = JSON.parse(evt.target.result);
      if (!Array.isArray(parsed)) throw new Error('Expected array of trades');

      if (supabaseClient && currentUser && currentUser.id !== 'local_guest') {
        const rowsToInsert = parsed.map(t => ({
          ...t,
          user_id: currentUser.id,
          user_email: currentUser.email
        }));

        if (mode === 'replace') {
          await supabaseClient.from('trades').delete().eq('user_id', currentUser.id);
        }

        const { error } = await supabaseClient.from('trades').upsert(rowsToInsert);
        if (error) throw error;

        showToast(`Imported ${parsed.length} trades into your account!`, 'success');
        closeImportModal();
        await fetchTrades();
        return;
      }

      // Local merge
      if (mode === 'replace') {
        allTrades = parsed;
      } else {
        const existingIds = new Set(allTrades.map(t => t.id));
        parsed.forEach(t => {
          if (!existingIds.has(t.id)) allTrades.push(t);
        });
      }
      localStorage.setItem('ADIL_LOCAL_TRADES', JSON.stringify(allTrades));
      showToast(`Imported ${parsed.length} trades locally!`, 'success');
      closeImportModal();
      renderTrades();
    } catch (err) {
      showToast('Import error: ' + err.message, 'error');
    }
  };
  reader.readAsText(fileInput.files[0]);
}

// ----------------- MONOKAI TOASTS -----------------

function escapeHtml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function showToast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  if (!container) return;

  const cleanMessage = String(message || '')
    .replace(/[\p{Extended_Pictographic}\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F1E6}-\u{1F1FF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{1F900}-\u{1F9FF}\u{1FA70}-\u{1FAFF}]/gu, '')
    .replace(/\s{2,}/g, ' ')
    .trim();

  const toast = document.createElement('div');
  const borderClass =
    type === 'success' ? 'border-[#a6e22e] text-[#a6e22e]' :
    type === 'error' ? 'border-[#f92672] text-[#f92672]' :
    'border-[#66d9ef] text-[#66d9ef]';

  toast.className = `toast px-4 py-2.5 rounded-xl text-xs font-bold font-mono shadow-2xl border bg-[#1e1f1c] flex items-center space-x-2 ${borderClass}`;
  toast.innerHTML = `<span>${cleanMessage}</span>`;

  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
    toast.style.transition = 'all 0.2s ease';
    setTimeout(() => toast.remove(), 200);
  }, 1700);
}

// ----------------- CUSTOM MONOKAI SELECT DROPDOWNS -----------------

function syncCustomSelect(targetId) {
  const cs = document.querySelector(`.custom-select[data-for="${targetId}"]`);
  if (!cs) return;
  const select = document.getElementById(targetId);
  if (!select) return;

  const trigger = cs.querySelector('.cs-trigger');
  const label = cs.querySelector('.cs-label');
  const options = cs.querySelectorAll('.cs-option');
  const activeVal = select.value;

  options.forEach((opt) => {
    const val = opt.getAttribute('data-value');
    const isMatch = val === activeVal;
    const check = opt.querySelector('.cs-check');
    if (isMatch) {
      opt.classList.add('bg-monoGreen/15', 'text-monoGreen', 'font-bold');
      opt.classList.remove('text-monoFg');
      if (check) check.classList.remove('opacity-0');
      if (label) {
        const optText = opt.querySelector('span')?.innerText || opt.innerText.trim();
        label.innerText = optText;
      }
    } else {
      opt.classList.remove('bg-monoGreen/15', 'text-monoGreen', 'font-bold');
      opt.classList.add('text-monoFg');
      if (check) check.classList.add('opacity-0');
    }
  });

  if (targetId === 'inputResult' && trigger) {
    trigger.classList.remove('border-monoGreen', 'text-monoGreen', 'border-monoPink', 'text-monoPink', 'border-monoYellow', 'text-monoYellow', 'border-monoBorder', 'text-monoFg');
    if (activeVal === 'WIN') {
      trigger.classList.add('border-monoGreen', 'text-monoGreen');
    } else if (activeVal === 'LOSS') {
      trigger.classList.add('border-monoPink', 'text-monoPink');
    } else if (activeVal === 'BREAKEVEN') {
      trigger.classList.add('border-monoYellow', 'text-monoYellow');
    } else {
      trigger.classList.add('border-monoBorder', 'text-monoFg');
    }
  } else if (trigger) {
    if (activeVal && activeVal !== 'ALL') {
      trigger.classList.add('border-monoGreen', 'text-monoGreen');
      trigger.classList.remove('border-monoBorder', 'text-monoFg');
    } else {
      trigger.classList.remove('border-monoGreen', 'text-monoGreen');
      trigger.classList.add('border-monoBorder', 'text-monoFg');
    }
  }
}

function initCustomSelects() {
  document.querySelectorAll('.custom-select').forEach((cs) => {
    const targetId = cs.getAttribute('data-for');
    const select = document.getElementById(targetId);
    if (!select) return;

    const trigger = cs.querySelector('.cs-trigger');
    const label = cs.querySelector('.cs-label');
    const caret = cs.querySelector('svg');
    const menu = cs.querySelector('.cs-menu');
    const options = cs.querySelectorAll('.cs-option');
    if (!trigger || !menu) return;

    syncCustomSelect(targetId);

    // Toggle menu
    trigger.onclick = (e) => {
      e.stopPropagation();
      const isCurrentlyOpen = !menu.classList.contains('hidden') && !menu.classList.contains('dropdown-closing');
      closeAllCustomSelects();
      if (!isCurrentlyOpen) {
        if (menu._closingTimer) {
          clearTimeout(menu._closingTimer);
          menu._closingTimer = null;
        }
        cs.classList.add('z-[75]');
        menu.classList.remove('hidden', 'dropdown-closing');

        const inModal = cs.closest('#tradeModal, #detailModal');
        if (inModal) {
          // Inside modal: position absolute relative to container to avoid modal transforms/filters breaking fixed coordinates
          menu.style.position = 'absolute';
          menu.style.top = 'calc(100% + 6px)';
          menu.style.left = '0';
          menu.style.width = '100%';
          menu.style.zIndex = '100';
        } else {
          // Outside modal: position fixed to avoid overflow-x clipping in filter bar
          const rect = trigger.getBoundingClientRect();
          menu.style.position = 'fixed';
          menu.style.top = (rect.bottom + 6) + 'px';
          const targetWidth = Math.max(Math.round(rect.width), 160);
          menu.style.width = targetWidth + 'px';
          menu.style.minWidth = '150px';
          menu.style.maxWidth = '210px';
          let leftPos = rect.left;
          if (leftPos + targetWidth > window.innerWidth - 8) {
            leftPos = window.innerWidth - targetWidth - 8;
          }
          if (leftPos < 8) leftPos = 8;
          menu.style.left = leftPos + 'px';
          menu.style.zIndex = '9999';
        }

        if (caret) caret.classList.add('rotate-180', 'text-monoGreen');
        trigger.classList.add('ring-1', 'ring-monoGreen/40');
      }
    };

    // Option click
    options.forEach((opt) => {
      opt.onclick = (e) => {
        e.stopPropagation();
        const val = opt.getAttribute('data-value');
        const optText = opt.querySelector('span')?.innerText || opt.innerText.trim();
        select.value = val;
        if (label) label.innerText = optText;
        syncCustomSelect(targetId);
        closeAllCustomSelects();
        select.dispatchEvent(new Event('change', { bubbles: true }));
        if (typeof select.onchange === 'function') {
          try { select.onchange(); } catch (err) { console.error('select.onchange error:', err); }
        }
      };
    });
  });
}

function closeAllCustomSelects() {
  document.querySelectorAll('.custom-select').forEach((cs) => {
    cs.classList.remove('z-[75]');
    const menu = cs.querySelector('.cs-menu');
    const caret = cs.querySelector('svg');
    const trigger = cs.querySelector('.cs-trigger');
    const targetId = cs.getAttribute('data-for');
    if (menu) {
      if (menu._closingTimer) {
        clearTimeout(menu._closingTimer);
        menu._closingTimer = null;
      }
      if (!menu.classList.contains('hidden') && !menu.classList.contains('dropdown-closing')) {
        menu.classList.add('dropdown-closing');
        menu._closingTimer = setTimeout(() => {
          menu.classList.add('hidden');
          menu.classList.remove('dropdown-closing');
          menu._closingTimer = null;
          menu.style.position = '';
          menu.style.top = '';
          menu.style.left = '';
          menu.style.width = '';
          menu.style.minWidth = '';
          menu.style.maxWidth = '';
          menu.style.zIndex = '';
        }, 130);
      }
    }
    if (caret) caret.classList.remove('rotate-180', 'text-monoGreen');
    if (trigger) {
      trigger.classList.remove('ring-1', 'ring-monoGreen/40');
      if (targetId) {
        syncCustomSelect(targetId);
      }
    }
  });
}

window.addEventListener('scroll', closeAllCustomSelects, { passive: true });

document.addEventListener('click', (e) => {
  if (!e.target.closest('.custom-select')) {
    closeAllCustomSelects();
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closeAllCustomSelects();
    closeProfileDropdown();

    const lightbox = document.getElementById('lightboxModal');
    const tradeModal = document.getElementById('tradeModal');
    const detailModal = document.getElementById('detailModal');
    const importModal = document.getElementById('importModal');

    if (lightbox && !lightbox.classList.contains('hidden')) {
      closeLightbox();
    } else if (tradeModal && !tradeModal.classList.contains('hidden')) {
      closeTradeModal();
    } else if (detailModal && !detailModal.classList.contains('hidden')) {
      closeDetailModal();
    } else if (importModal && !importModal.classList.contains('hidden')) {
      closeImportModal();
    }
  }
});

// Setup modal backdrop click dismissal
function initModalBackdropDismiss() {
  ['tradeModal', 'detailModal', 'importModal'].forEach((id) => {
    const modal = document.getElementById(id);
    if (modal) {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) {
          if (id === 'tradeModal') closeTradeModal();
          else if (id === 'detailModal') closeDetailModal();
          else if (id === 'importModal') closeImportModal();
        }
      });
    }
  });
}

if (document.readyState !== 'loading') {
  initCustomSelects();
  initModalBackdropDismiss();
  updateViewModeButtons();
} else {
  document.addEventListener('DOMContentLoaded', () => {
    initCustomSelects();
    initModalBackdropDismiss();
    updateViewModeButtons();
  });
}
