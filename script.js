const toggleButtons = document.querySelectorAll('.toggle-card');
const formCards = document.querySelectorAll('.form-card');
const authForms = document.querySelectorAll('.auth-form');
const themeToggles = document.querySelectorAll('.theme-toggle');
const sidebarToggles = document.querySelectorAll('.sidebar-toggle');
const sidebars = document.querySelectorAll('.top-right');
const logoImages = document.querySelectorAll('.logo');
const supabaseConfig = window.SUPABASE_CONFIG || {};
const supabaseClient = window.supabase
  ? window.supabase.createClient(supabaseConfig.url, supabaseConfig.anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true
      }
    })
  : null;

let pendingTransfer = null;
let scannerStream = null;
let scannerTimer = null;
let html5QrScanner = null;
const PROTOTYPE_STARTING_BALANCE = 5000;

function setActiveForm(targetId) {
  toggleButtons.forEach((button) => {
    const isActive = button.dataset.target === targetId;
    button.classList.toggle('active', isActive);
  });

  formCards.forEach((card) => {
    card.classList.toggle('active-form', card.id === targetId);
  });
}

function setTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('finshu-theme', theme);
  logoImages.forEach((logo) => {
    logo.src = theme === 'dark' ? 'Images/logo-dark mode.png' : 'Images/logo.png';
  });
  themeToggles.forEach((toggle) => {
    toggle.textContent = theme === 'dark' ? 'Light mode' : 'Dark mode';
    toggle.setAttribute('aria-label', theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode');
  });
}

function initTheme() {
  const savedTheme = localStorage.getItem('finshu-theme');
  setTheme(savedTheme || 'light');
}

function initMobileSidebar() {
  if (!sidebarToggles.length || !sidebars.length) return;

  const closeSidebar = () => {
    document.body.classList.remove('sidebar-open');
    sidebarToggles.forEach((toggle) => toggle.setAttribute('aria-expanded', 'false'));
  };

  sidebarToggles.forEach((toggle) => {
    toggle.addEventListener('click', (event) => {
      event.stopPropagation();
      const isOpen = document.body.classList.toggle('sidebar-open');
      sidebarToggles.forEach((button) => button.setAttribute('aria-expanded', String(isOpen)));
    });
  });

  document.addEventListener('click', (event) => {
    if (!document.body.classList.contains('sidebar-open')) return;
    const clickedSidebar = Array.from(sidebars).some((sidebar) => sidebar.contains(event.target));
    const clickedToggle = Array.from(sidebarToggles).some((toggle) => toggle.contains(event.target));
    if (clickedSidebar || clickedToggle) return;
    closeSidebar();
  });

  sidebars.forEach((sidebar) => {
    sidebar.querySelectorAll('a, button').forEach((item) => {
      item.addEventListener('click', () => {
        closeSidebar();
      });
    });
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeSidebar();
  });

  window.addEventListener('resize', () => {
    if (window.innerWidth > 680) closeSidebar();
  });
}

function setFormStatus(form, state, message) {
  const status = form.querySelector('.form-status');
  if (!status) return;
  status.className = `form-status ${state}`;
  status.textContent = message;
}

function generateUniqueIdentifier(email, fullName) {
  const seed = `${email || ''}-${fullName || ''}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const hash = Array.from(seed).reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return `FS-${String(hash).slice(-6).padStart(6, '0')}`;
}

function formatCurrency(amount) {
  return `\u20a6${Number(amount || 0).toLocaleString('en-NG', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`;
}

function getWalletBalanceKey(walletId = getLocalWalletId()) {
  return `finshu-wallet-balance-${walletId}`;
}

function initializeWalletBalance(walletId = getLocalWalletId(), forceReset = false) {
  const balanceKey = getWalletBalanceKey(walletId);
  if (forceReset || localStorage.getItem(balanceKey) === null) {
    localStorage.setItem(balanceKey, String(PROTOTYPE_STARTING_BALANCE));
  }
  return Number(localStorage.getItem(balanceKey)) || PROTOTYPE_STARTING_BALANCE;
}

function getWalletBalance() {
  const balanceKey = getWalletBalanceKey();
  const storedBalance = localStorage.getItem(balanceKey);
  if (storedBalance === null) {
    return initializeWalletBalance();
  }
  return Number(storedBalance) || 0;
}

function setWalletBalance(amount) {
  const nextAmount = Math.max(0, Number(amount) || 0);
  localStorage.setItem(getWalletBalanceKey(), String(nextAmount));
  return nextAmount;
}

function getTransferHistory() {
  try {
    return JSON.parse(localStorage.getItem('finshu-transfer-history') || '[]');
  } catch {
    return [];
  }
}

function setTransferHistory(history) {
  localStorage.setItem('finshu-transfer-history', JSON.stringify(history.slice(0, 6)));
}

function getLocalWalletId() {
  return localStorage.getItem('finshu-user-id') || 'FS-000001';
}

function getLocalDisplayName() {
  return localStorage.getItem('finshu-display-name') || 'FinShu user';
}

function persistAuthState(email, role, fullName, userId = null) {
  const resolvedUserId = userId || localStorage.getItem('finshu-user-id') || generateUniqueIdentifier(email, fullName);
  localStorage.setItem('finshu-auth', 'true');
  localStorage.setItem('finshu-display-name', fullName || email.split('@')[0]);
  localStorage.setItem('finshu-role', role || 'commuter');
  localStorage.setItem('finshu-email', email || '');
  localStorage.setItem('finshu-user-id', resolvedUserId);
  localStorage.setItem('finshu-balance-visible', 'true');
  initializeWalletBalance(resolvedUserId);
  return resolvedUserId;
}

function getAuthErrorMessage(error) {
  if (!error) return 'Authentication failed.';
  const status = error.status || error.statusCode;
  return status ? `${error.message || 'Authentication failed.'} (${status})` : error.message || 'Authentication failed.';
}

function isRecoverableSignupError(error) {
  const status = error?.status || error?.statusCode;
  return status >= 500 || /failed to fetch|server|database/i.test(error?.message || '');
}

function completePrototypeSignup(form, submitButton, email, role, fullName) {
  const resolvedUserId = persistAuthState(email, role, fullName);
  initializeWalletBalance(resolvedUserId, true);
  setFormStatus(
    form,
    'success',
    `Supabase sign-up is unavailable, so a prototype wallet was created with ${formatCurrency(PROTOTYPE_STARTING_BALANCE)}.`
  );
  form.reset();
  submitButton.disabled = false;
  window.location.href = 'wallet.html';
}

function syncWalletFromSession() {
  if (!supabaseClient) {
    return Promise.resolve();
  }

  return supabaseClient.auth.getSession().then(({ data }) => {
    const session = data?.session;
    const user = session?.user;
    if (user) {
      const metadata = user.user_metadata || {};
      const resolvedRole = metadata.role || localStorage.getItem('finshu-role') || 'commuter';
      const resolvedName = metadata.full_name || metadata.fullName || localStorage.getItem('finshu-display-name') || user.email?.split('@')[0] || 'FinShu user';
      persistAuthState(user.email || '', resolvedRole, resolvedName, user.id || null);
    }
    renderWalletState();
  });
}

function drawQrCode(container, payload) {
  if (!container) return;

  if (window.QRCode?.toCanvas) {
    container.innerHTML = '';
    container.classList.add('is-real-qr');
    const canvas = document.createElement('canvas');
    container.appendChild(canvas);
    window.QRCode.toCanvas(canvas, payload, {
      width: 174,
      margin: 1,
      color: {
        dark: '#07120f',
        light: '#ffffff'
      }
    });
    return;
  }

  const size = 21;
  container.classList.remove('is-real-qr');
  let hash = 0;
  Array.from(payload).forEach((char) => {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  });

  container.innerHTML = '';
  container.style.setProperty('--qr-size', size);

  const isFinder = (row, col, startRow, startCol) => {
    const r = row - startRow;
    const c = col - startCol;
    if (r < 0 || c < 0 || r > 6 || c > 6) return false;
    return r === 0 || r === 6 || c === 0 || c === 6 || (r >= 2 && r <= 4 && c >= 2 && c <= 4);
  };

  for (let row = 0; row < size; row += 1) {
    for (let col = 0; col < size; col += 1) {
      const cell = document.createElement('span');
      const bit = ((hash >> ((row + col) % 16)) ^ (row * 7) ^ (col * 13)) & 1;
      const dark = isFinder(row, col, 0, 0) || isFinder(row, col, 0, 14) || isFinder(row, col, 14, 0) || bit;
      cell.className = dark ? 'is-dark' : '';
      container.appendChild(cell);
    }
  }
}

function parseWalletPayload(rawValue) {
  if (!rawValue) return null;

  try {
    const parsed = JSON.parse(rawValue);
    if (parsed?.type === 'finshu-wallet' && parsed.walletId) {
      return {
        walletId: String(parsed.walletId),
        recipient: parsed.displayName || 'FinShu user'
      };
    }
  } catch {
    return {
      walletId: String(rawValue).trim(),
      recipient: 'FinShu user'
    };
  }

  return null;
}

function stopCameraScanner() {
  if (html5QrScanner) {
    html5QrScanner.stop().catch(() => {}).finally(() => {
      html5QrScanner?.clear?.();
      html5QrScanner = null;
    });
  }

  if (scannerTimer) {
    clearInterval(scannerTimer);
    scannerTimer = null;
  }

  if (scannerStream) {
    scannerStream.getTracks().forEach((track) => track.stop());
    scannerStream = null;
  }

  const scannerBox = document.querySelector('[data-scanner-box]');
  const video = document.querySelector('[data-scanner-video]');
  const qrReader = document.querySelector('[data-qr-reader]');
  if (video) video.srcObject = null;
  if (qrReader) qrReader.innerHTML = '';
  if (scannerBox) scannerBox.hidden = true;
}

async function findWalletRecord(walletId) {
  if (!supabaseClient || !walletId) return null;

  const attempts = [
    () => supabaseClient.from('wallets').select('*').eq('wallet_id', walletId).maybeSingle(),
    () => supabaseClient.from('wallets').select('*').eq('id', walletId).maybeSingle()
  ];

  for (const attempt of attempts) {
    try {
      const { data, error } = await attempt();
      if (!error && data) return data;
    } catch {
      // Fall through to the next likely schema shape.
    }
  }

  return null;
}

async function ensureSenderWallet() {
  if (!supabaseClient) return null;

  const walletId = getLocalWalletId();
  const existingWallet = await findWalletRecord(walletId);
  if (existingWallet) return existingWallet;

  try {
    const { data: userData } = await supabaseClient.auth.getUser();
    const userId = userData?.user?.id || null;
    const { data, error } = await supabaseClient
      .from('wallets')
      .insert({
        wallet_id: walletId,
        user_id: userId,
        display_name: getLocalDisplayName(),
        balance: PROTOTYPE_STARTING_BALANCE
      })
      .select()
      .single();

    return error ? null : data;
  } catch {
    return null;
  }
}

async function persistTransferToDatabase(transfer) {
  if (!supabaseClient) {
    return { ok: false, reason: 'Supabase is unavailable.' };
  }

  try {
    const { error } = await supabaseClient.rpc('process_peer_transfer', {
      receiver_wallet_code: transfer.walletId,
      transfer_amount: transfer.amount,
      transfer_note: transfer.note
    });

    if (!error) return { ok: true, reason: 'Database transfer completed.' };
  } catch {
    // RPC is optional during local development; direct table writes are attempted next.
  }

  const senderWallet = await ensureSenderWallet();
  const receiverWallet = await findWalletRecord(transfer.walletId);

  try {
    const { error } = await supabaseClient.from('transactions').insert({
      sender_wallet_id: senderWallet?.id || getLocalWalletId(),
      receiver_wallet_id: receiverWallet?.id || transfer.walletId,
      amount: transfer.amount,
      note: transfer.note,
      status: 'completed',
      type: 'peer_transfer'
    });
    if (error) return { ok: false, reason: error.message };
  } catch {
    return { ok: false, reason: 'Transaction table rejected the transfer shape.' };
  }

  const senderBalance = Number(senderWallet?.balance ?? getWalletBalance());
  const receiverBalance = Number(receiverWallet?.balance ?? 0);

  try {
    if (senderWallet?.id) {
      const { error } = await supabaseClient.from('wallets').update({ balance: senderBalance - transfer.amount }).eq('id', senderWallet.id);
      if (error) return { ok: true, reason: 'Transaction saved, but sender balance update failed.' };
    }

    if (receiverWallet?.id) {
      const { error } = await supabaseClient.from('wallets').update({ balance: receiverBalance + transfer.amount }).eq('id', receiverWallet.id);
      if (error) return { ok: true, reason: 'Transaction saved, but receiver balance update failed.' };
    }
  } catch {
    return { ok: true, reason: 'Transaction saved, but wallet balance update failed.' };
  }

  return { ok: true, reason: receiverWallet ? 'Database transfer completed.' : 'Transaction saved without a matching receiver wallet.' };
}

function renderTransferHistory() {
  const historyTarget = document.querySelector('[data-transfer-history]');
  if (!historyTarget) return;

  const history = getTransferHistory();
  if (!history.length) {
    historyTarget.innerHTML = '<p class="mini-copy">No transfers yet.</p>';
    return;
  }

  historyTarget.innerHTML = history
    .map((item) => `
      <div class="transfer-item">
        <span>${item.recipient}</span>
        <strong>${formatCurrency(item.amount)}</strong>
      </div>
    `)
    .join('');
}

function setTransferPanel(open) {
  const panel = document.querySelector('[data-transfer-panel]');
  if (!panel) return;
  panel.classList.toggle('open', open);
  panel.setAttribute('aria-hidden', String(!open));
}

function initPeerTransfers() {
  const qrTarget = document.querySelector('[data-receive-qr]');
  const receiveCode = document.querySelector('[data-receive-code]');
  const scanButton = document.querySelector('[data-scan-qr]');
  const manualScanButton = document.querySelector('[data-manual-scan]');
  const manualCodeInput = document.querySelector('[data-manual-wallet-code]');
  const scannerBox = document.querySelector('[data-scanner-box]');
  const scannerVideo = document.querySelector('[data-scanner-video]');
  const qrReader = document.querySelector('[data-qr-reader]');
  const stopScanButton = document.querySelector('[data-stop-scan]');
  const confirmButton = document.querySelector('[data-transfer-confirm]');
  const cancelButtons = document.querySelectorAll('[data-transfer-cancel]');
  const amountInput = document.querySelector('[data-transfer-amount]');
  const noteInput = document.querySelector('[data-transfer-note]');
  const status = document.querySelector('[data-transfer-status]');
  const confirmAmount = document.querySelector('[data-confirm-amount]');
  const confirmRecipient = document.querySelector('[data-confirm-recipient]');
  const confirmNote = document.querySelector('[data-confirm-note]');

  if (!qrTarget || !scanButton) return;

  const walletId = getLocalWalletId();
  const displayName = getLocalDisplayName();
  const payload = JSON.stringify({ type: 'finshu-wallet', walletId, displayName });
  drawQrCode(qrTarget, payload);
  if (receiveCode) receiveCode.textContent = walletId;
  ensureSenderWallet();

  const openConfirmation = (targetWallet) => {
    const amount = Number(amountInput?.value || 0);
    if (!amount || amount <= 0) {
      if (status) {
        status.className = 'form-status error';
        status.textContent = 'Enter an amount before scanning.';
      }
      return;
    }

    if (!targetWallet?.walletId) {
      if (status) {
        status.className = 'form-status error';
        status.textContent = 'No valid FinShu wallet code was found.';
      }
      return;
    }

    if (targetWallet.walletId === getLocalWalletId()) {
      if (status) {
        status.className = 'form-status error';
        status.textContent = 'Use a different receiver wallet.';
      }
      return;
    }

    pendingTransfer = {
      amount,
      note: noteInput?.value.trim() || 'QR transfer',
      recipient: targetWallet.recipient || 'FinShu user',
      walletId: targetWallet.walletId
    };

    if (confirmAmount) confirmAmount.textContent = formatCurrency(amount);
    if (confirmRecipient) confirmRecipient.textContent = `${pendingTransfer.recipient} (${pendingTransfer.walletId})`;
    if (confirmNote) confirmNote.textContent = pendingTransfer.note;
    if (status) {
      status.className = 'form-status loading';
      status.textContent = 'QR scanned. Confirm the transfer in the side panel.';
    }
    setTransferPanel(true);
  };

  const handleScannedValue = (rawValue) => {
    const parsedWallet = parseWalletPayload(rawValue);
    if (parsedWallet) {
      stopCameraScanner();
      openConfirmation(parsedWallet);
    }
  };

  const startHtml5QrScanner = async () => {
    if (!window.Html5Qrcode || !qrReader) return false;

    if (scannerVideo) scannerVideo.hidden = true;
    if (scannerBox) scannerBox.hidden = false;
    qrReader.innerHTML = '';
    html5QrScanner = new window.Html5Qrcode(qrReader.id);

    await html5QrScanner.start(
      { facingMode: 'environment' },
      {
        fps: 10,
        qrbox: { width: 220, height: 220 },
        aspectRatio: 1
      },
      (decodedText) => {
        handleScannedValue(decodedText);
      }
    );

    return true;
  };

  const startNativeBarcodeScanner = async () => {
    if (scannerVideo) scannerVideo.hidden = false;
    if (scannerBox) scannerBox.hidden = false;

    const detector = new window.BarcodeDetector({ formats: ['qr_code'] });
    scannerStream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: 'environment'
      },
      audio: false
    });

    if (scannerVideo) {
      scannerVideo.srcObject = scannerStream;
      await scannerVideo.play();
    }

    scannerTimer = setInterval(async () => {
      if (!scannerVideo || scannerVideo.readyState < 2) return;
      try {
        const codes = await detector.detect(scannerVideo);
        const qrValue = codes[0]?.rawValue;
        if (qrValue) handleScannedValue(qrValue);
      } catch {
        // Keep the scanner running; individual frame failures are common.
      }
    }, 450);
  };

  scanButton.onclick = async () => {
    const amount = Number(amountInput?.value || 0);
    if (!amount || amount <= 0) {
      if (status) {
        status.className = 'form-status error';
        status.textContent = 'Enter an amount before scanning.';
      }
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      if (status) {
        status.className = 'form-status error';
        status.textContent = 'Camera access is not available in this browser.';
      }
      return;
    }

    try {
      if (status) {
        status.className = 'form-status loading';
        status.textContent = 'Camera is scanning for a FinShu QR code.';
      }

      const startedLibraryScanner = await startHtml5QrScanner();
      if (!startedLibraryScanner) {
        if (!('BarcodeDetector' in window)) {
          if (status) {
            status.className = 'form-status error';
            status.textContent = 'This browser cannot scan QR codes directly. Paste the wallet code below.';
          }
          return;
        }

        await startNativeBarcodeScanner();
      }
    } catch (error) {
      stopCameraScanner();
      if (status) {
        status.className = 'form-status error';
        status.textContent = error?.name === 'NotAllowedError'
          ? 'Camera permission was denied.'
          : 'Unable to start the camera scanner.';
      }
    }
  };

  manualScanButton.onclick = () => {
    handleScannedValue(manualCodeInput?.value.trim());
  };

  stopScanButton.onclick = () => {
    stopCameraScanner();
    if (status) {
      status.className = 'form-status';
      status.textContent = 'Scanner stopped.';
    }
  };

  confirmButton.onclick = async () => {
    if (!pendingTransfer) return;

    const currentBalance = getWalletBalance();
    if (pendingTransfer.amount > currentBalance) {
      if (status) {
        status.className = 'form-status error';
        status.textContent = 'Insufficient balance for this transfer.';
      }
      setTransferPanel(false);
      return;
    }

    confirmButton.disabled = true;
    if (status) {
      status.className = 'form-status loading';
      status.textContent = 'Processing transfer...';
    }

    const databaseResult = await persistTransferToDatabase(pendingTransfer);
    setWalletBalance(currentBalance - pendingTransfer.amount);
    setTransferHistory([
      {
        ...pendingTransfer,
        createdAt: new Date().toISOString(),
        source: databaseResult.ok ? 'database' : 'local'
      },
      ...getTransferHistory()
    ]);

    if (amountInput) amountInput.value = '';
    if (noteInput) noteInput.value = '';
    if (status) {
      status.className = 'form-status success';
      status.textContent = databaseResult.ok
        ? 'Transfer processed instantly and saved to the database.'
        : `Transfer processed locally. ${databaseResult.reason}`;
    }

    confirmButton.disabled = false;
    pendingTransfer = null;
    setTransferPanel(false);
    renderWalletState();
    renderTransferHistory();
  };

  cancelButtons.forEach((button) => {
    button.onclick = () => {
      pendingTransfer = null;
      stopCameraScanner();
      setTransferPanel(false);
    };
  });

  renderTransferHistory();
}

function renderWalletState() {
  const balanceValue = document.querySelector('[data-balance-value]');
  const balanceToggle = document.querySelector('[data-balance-toggle]');
  const walletStatus = document.querySelector('[data-wallet-status]');
  const userName = document.querySelector('[data-user-name]');
  const userRole = document.querySelector('[data-user-role]');
  const walletId = document.querySelector('[data-wallet-id]');
  const nfcActionButton = document.querySelector('[data-nfc-action]');
  const nfcStatus = document.querySelector('[data-nfc-status]');

  if (userName) {
    userName.textContent = localStorage.getItem('finshu-display-name') || 'FinShu commuter';
  }

  if (userRole) {
    const role = localStorage.getItem('finshu-role') || 'commuter';
    userRole.textContent = role === 'driver' ? 'Driver account' : 'Commuter account';
  }

  if (walletId) {
    walletId.textContent = localStorage.getItem('finshu-user-id') || 'Generating...';
  }

  const updateBalanceVisibility = (visible) => {
    if (balanceValue) {
      balanceValue.textContent = visible ? formatCurrency(getWalletBalance()) : '******';
    }

    if (balanceToggle) {
      balanceToggle.textContent = visible ? 'Hide' : 'Show';
      balanceToggle.setAttribute('aria-label', visible ? 'Hide balance' : 'Show balance');
    }

    if (walletStatus) {
      walletStatus.textContent = visible
        ? 'Balance is visible and ready for transfers.'
        : 'Balance is hidden until you choose to view it.';
    }
  };

  if (balanceToggle) {
    const isVisible = localStorage.getItem('finshu-balance-visible') !== 'false';
    updateBalanceVisibility(isVisible);

    balanceToggle.onclick = () => {
      const nextVisible = localStorage.getItem('finshu-balance-visible') !== 'true';
      localStorage.setItem('finshu-balance-visible', String(nextVisible));
      updateBalanceVisibility(nextVisible);
    };
  }

  if (nfcActionButton && nfcStatus) {
    nfcActionButton.onclick = () => {
      nfcStatus.textContent = 'NFC pairing is coming soon. We will enable tap-to-pay card linking next.';
    };
  }

  initPeerTransfers();
}

async function handleSignOut() {
  if (!supabaseClient) {
    localStorage.removeItem('finshu-auth');
    localStorage.removeItem('finshu-display-name');
    localStorage.removeItem('finshu-role');
    localStorage.removeItem('finshu-email');
    localStorage.removeItem('finshu-user-id');
    window.location.href = 'signup.html';
    return;
  }

  await supabaseClient.auth.signOut();
  localStorage.removeItem('finshu-auth');
  localStorage.removeItem('finshu-display-name');
  localStorage.removeItem('finshu-role');
  localStorage.removeItem('finshu-email');
  localStorage.removeItem('finshu-user-id');
  window.location.href = 'signup.html';
}

function initWalletExperience() {
  renderWalletState();
  const signOutButton = document.getElementById('sign-out-button');
  if (signOutButton) {
    signOutButton.addEventListener('click', handleSignOut);
  }

  if (supabaseClient) {
    syncWalletFromSession();
  }
}

async function handleAuthSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const submitButton = form.querySelector('button[type="submit"]');
  const authMode = form.dataset.authMode || 'signup';
  const role = form.dataset.role;
  const fullName = form.querySelector('[name="fullName"]')?.value.trim() || '';
  const email = form.querySelector('[name="email"]')?.value.trim() || '';
  const phone = form.querySelector('[name="phone"]')?.value.trim() || '';
  const password = form.querySelector('[name="password"]').value;

  if (!supabaseClient) {
    setFormStatus(form, 'error', 'Authentication is unavailable right now.');
    return;
  }

  if (!email || password.length < 6) {
    setFormStatus(form, 'error', 'Please enter a valid email and a password with at least 6 characters.');
    return;
  }

  submitButton.disabled = true;
  setFormStatus(form, 'loading', authMode === 'signin' ? 'Signing you in...' : 'Creating your account...');

  const profileData = {
    full_name: fullName,
    role,
    phone
  };

  if (role === 'driver') {
    profileData.dob = form.querySelector('[name="dob"]').value;
    profileData.government_id = form.querySelector('[name="governmentId"]').value.trim();
    profileData.vehicle_registration = form.querySelector('[name="vehicleRegistration"]').value.trim();
    profileData.vehicle_type = form.querySelector('[name="vehicleType"]').value;
    profileData.license_number = form.querySelector('[name="licenseNumber"]').value.trim();
  }

  if (authMode === 'signin') {
    let signInResult;
    try {
      signInResult = await supabaseClient.auth.signInWithPassword({ email, password });
    } catch (error) {
      setFormStatus(form, 'error', getAuthErrorMessage(error));
      submitButton.disabled = false;
      return;
    }

    const { data, error } = signInResult;
    if (error) {
      setFormStatus(form, 'error', getAuthErrorMessage(error));
      submitButton.disabled = false;
      return;
    }

    const resolvedUserId = persistAuthState(email, data.user?.user_metadata?.role || role || 'commuter', data.user?.user_metadata?.full_name || fullName || email.split('@')[0], data.user?.id || null);
    setFormStatus(form, 'success', `Welcome back. Your wallet is now linked to ${resolvedUserId}.`);
    form.reset();
    submitButton.disabled = false;
    window.location.href = 'wallet.html';
    return;
  }

  let signUpResult;
  try {
    signUpResult = await supabaseClient.auth.signUp({
      email,
      password,
      options: {
        data: profileData
      }
    });
  } catch (error) {
    if (isRecoverableSignupError(error)) {
      completePrototypeSignup(form, submitButton, email, role, fullName);
      return;
    }

    setFormStatus(form, 'error', getAuthErrorMessage(error));
    submitButton.disabled = false;
    return;
  }

  const { data, error } = signUpResult;

  if (error) {
    if (isRecoverableSignupError(error)) {
      completePrototypeSignup(form, submitButton, email, role, fullName);
      return;
    }

    setFormStatus(form, 'error', getAuthErrorMessage(error));
    submitButton.disabled = false;
    return;
  }

  const resolvedUserId = persistAuthState(email, role, fullName, data.user?.id || null);
  initializeWalletBalance(resolvedUserId, true);
  setFormStatus(form, 'success', `Account created. Please check ${email} for a confirmation email. Your wallet ID is ${resolvedUserId}.`);
  form.reset();
  submitButton.disabled = false;
  window.location.href = 'wallet.html';
}

if (themeToggles.length) {
  themeToggles.forEach((toggle) => {
    toggle.addEventListener('click', () => {
    const currentTheme = document.documentElement.getAttribute('data-theme');
    setTheme(currentTheme === 'dark' ? 'light' : 'dark');
    });
  });
}

if (toggleButtons.length && formCards.length) {
  toggleButtons.forEach((button) => {
    button.addEventListener('click', () => setActiveForm(button.dataset.target));
  });

  setActiveForm('commuter-form');
}

if (authForms.length) {
  authForms.forEach((form) => {
    form.addEventListener('submit', handleAuthSubmit);
  });
}

initTheme();
initMobileSidebar();
initWalletExperience();
