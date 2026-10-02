// =====================================================
// AUTHENTICATION & REGISTRATION MODULE
// Manages Reporter ID registration, 10-digit mobile number,
// valid email ID, 2 MB photo uploads, login authentication,
// and secure multi-step Forgot Password recovery.
// =====================================================

const USERS_KEY = 'btvNewsUsers';
const CURRENT_USER_KEY = 'btvNewsCurrentUser';
const MAX_PHOTO_SIZE = 2 * 1024 * 1024; // 2 MB maximum file size
const OTP_SALT = 'btv_otp_salt_v1';
const PWD_SALT = 'btv_pwd_salt_v1';

// Registration form: In-memory holder for the validated base64 profile photo
let selectedPhotoBase64 = '';

// Active session state for Forgot Password flow
// // Authentication/security validation
let recoveryState = {
  user: null,
  reporterId: '',
  method: 'mobile',
  maskedMobile: '',
  maskedEmail: '',
  codeHash: '',
  expiresAt: 0,
  attemptsLeft: 5,
  verified: false,
  resetToken: null,
  timerInterval: null
};

// =====================================================
// USER DATA PERSISTENCE
// =====================================================
function getUsers() {
  const storedUsers = localStorage.getItem(USERS_KEY);
  if (!storedUsers) {
    return [];
  }

  try {
    const parsedUsers = JSON.parse(storedUsers);
    return Array.isArray(parsedUsers) ? parsedUsers : [];
  } catch (error) {
    return [];
  }
}

function saveUsers(users) {
  localStorage.setItem(USERS_KEY, JSON.stringify(users));
}

// =====================================================
// SECURITY & CRYPTO HELPERS
// // Authentication/security validation
// Hashes passwords and OTP verification tokens using Web Crypto SHA-256
// =====================================================
async function hashString(value, salt = PWD_SALT) {
  if (typeof crypto !== 'undefined' && crypto.subtle && crypto.subtle.digest) {
    try {
      const encoder = new TextEncoder();
      const data = encoder.encode(`${salt}:${value}`);
      const hashBuffer = await crypto.subtle.digest('SHA-256', data);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
    } catch (e) {
      console.warn('SubtleCrypto error, falling back:', e);
    }
  }

  // Deterministic fallback hash
  let hash = 0;
  const str = `${salt}:${value}`;
  for (let i = 0; i < str.length; i += 1) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0;
  }
  return `h_${Math.abs(hash).toString(16)}`;
}

async function verifyPassword(inputPassword, storedPassword) {
  if (!storedPassword) return false;
  // Match direct plaintext (for legacy demo accounts) or hashed format
  if (inputPassword === storedPassword) return true;
  const hashedInput = await hashString(inputPassword, PWD_SALT);
  return hashedInput === storedPassword;
}

// =====================================================
// UNIFIED PASSWORD VALIDATION
// // Password validation everywhere
// // Authentication/security validation
// Rules:
// 1. Minimum 6 characters
// 2. Must contain at least 1 special character (! @ # $ % ^ & * and symbols)
// 3. Confirm Password must exactly match Password
// =====================================================
const SPECIAL_CHAR_REGEX = /[!@#$%^&*~`()_+\-=\[\]{};':"\\|,.<>\/?]/;

function validatePasswordComplexity(password, fieldLabel = 'Password') {
  if (!password || !password.trim()) {
    return {
      isValid: false,
      error: `${fieldLabel} is required.`
    };
  }

  if (password.length < 6) {
    return {
      isValid: false,
      error: 'Password must contain at least 6 characters.'
    };
  }

  if (!SPECIAL_CHAR_REGEX.test(password)) {
    return {
      isValid: false,
      error: 'Password must contain at least one special character.'
    };
  }

  return {
    isValid: true,
    error: ''
  };
}

function validatePasswordMatch(password, confirmPassword) {
  if (!confirmPassword || !confirmPassword.trim()) {
    return {
      isValid: false,
      error: 'Confirm password is required.'
    };
  }

  if (password !== confirmPassword) {
    return {
      isValid: false,
      error: 'Passwords do not match.'
    };
  }

  return {
    isValid: true,
    error: ''
  };
}

function setupLivePasswordValidation(pwdInputId, confirmInputId) {
  const pwdInput = document.getElementById(pwdInputId);
  const confirmInput = document.getElementById(confirmInputId);
  if (!pwdInput) return;

  pwdInput.addEventListener('input', () => {
    const pwdVal = pwdInput.value;
    if (pwdVal.length > 0) {
      const res = validatePasswordComplexity(pwdVal);
      setInputError(pwdInput, res.isValid ? '' : res.error);
    } else {
      setInputError(pwdInput, '');
    }

    if (confirmInput && confirmInput.value.length > 0) {
      const matchRes = validatePasswordMatch(pwdVal, confirmInput.value);
      setInputError(confirmInput, matchRes.isValid ? '' : matchRes.error);
    }
  });

  if (confirmInput) {
    confirmInput.addEventListener('input', () => {
      const confirmVal = confirmInput.value;
      if (confirmVal.length > 0) {
        const matchRes = validatePasswordMatch(pwdInput.value, confirmVal);
        setInputError(confirmInput, matchRes.isValid ? '' : matchRes.error);
      } else {
        setInputError(confirmInput, '');
      }
    });
  }
}

// =====================================================
// CONTACT MASKING HELPERS
// Ensures user's full mobile number or email is never exposed
// =====================================================
function maskMobileNumber(mobile) {
  const digits = String(mobile || '').replace(/\D/g, '');
  if (digits.length >= 4) {
    const last4 = digits.slice(-4);
    const maskedPrefix = '*'.repeat(Math.max(6, digits.length - 4));
    return `${maskedPrefix}${last4}`;
  }
  return '******1234';
}

function maskEmailAddress(email) {
  const str = String(email || '').trim();
  if (str.includes('@')) {
    const [local, domain] = str.split('@');
    const firstChar = local.charAt(0) || 'u';
    return `${firstChar}*****@${domain}`;
  }
  return 'u*****@domain.com';
}

// =====================================================
// UI STATUS & ERROR HELPERS
// =====================================================
function setStatus(element, message, type) {
  if (!element) return;

  element.textContent = message;
  element.classList.remove('success', 'error', 'visible');

  if (type) {
    element.classList.add(type, 'visible');
  }
}

function setInputError(input, message) {
  if (!input) return;

  const fieldGroup = input.closest('.field-group');
  const errorNode = fieldGroup ? fieldGroup.querySelector('.error-message') : null;

  input.classList.toggle('invalid', Boolean(message));
  input.setAttribute('aria-invalid', message ? 'true' : 'false');

  if (errorNode) {
    errorNode.textContent = message || '';
  }
}

function clearAllFieldErrors() {
  document.querySelectorAll('.field-group input').forEach((input) => {
    setInputError(input, '');
  });
}

function setupPasswordToggle() {
  document.querySelectorAll('.toggle-password').forEach((button) => {
    button.addEventListener('click', () => {
      const targetId = button.getAttribute('data-target');
      const input = document.getElementById(targetId);

      if (!input) return;

      const isPassword = input.type === 'password';
      input.type = isPassword ? 'text' : 'password';
      button.setAttribute('aria-label', isPassword ? 'Hide password' : 'Show password');
      const eye = button.querySelector('.icon-eye');
      if (eye) {
        eye.textContent = isPassword ? '🙈' : '👁';
      }
    });
  });
}

// =====================================================
// LOGIN AUTHENTICATION
// Authenticates the reporter using Reporter ID + Password + CODE (7032).
// =====================================================
const LOGIN_ACCESS_CODE = '7032';

function setupCodeInputFilter() {
  const codeInput = document.getElementById('loginCode');
  if (!codeInput) return;

  // Real-time input sanitizer: restrict to max 4 digits only (no letters, spaces, or symbols)
  codeInput.addEventListener('input', (event) => {
    const original = event.target.value;
    const sanitized = original.replace(/\D/g, '').slice(0, 4);
    if (original !== sanitized) {
      event.target.value = sanitized;
    }
  });

  // Block spaces, letters, and special characters on keystroke
  codeInput.addEventListener('keydown', (event) => {
    if (
      event.key === 'Backspace' ||
      event.key === 'Delete' ||
      event.key === 'Tab' ||
      event.key === 'Escape' ||
      event.key === 'Enter' ||
      event.key === 'ArrowLeft' ||
      event.key === 'ArrowRight' ||
      event.key === 'ArrowUp' ||
      event.key === 'ArrowDown' ||
      event.key === 'Home' ||
      event.key === 'End' ||
      event.ctrlKey ||
      event.metaKey
    ) {
      return;
    }

    if (event.key === ' ' || !/^\d$/.test(event.key)) {
      event.preventDefault();
    }
  });

  // Clean pasted content to numbers only, max 4 digits
  codeInput.addEventListener('paste', (event) => {
    event.preventDefault();
    const pasteData = (event.clipboardData || window.clipboardData)?.getData('text') || '';
    const digits = pasteData.replace(/\D/g, '').slice(0, 4);
    codeInput.value = digits;
    setInputError(codeInput, '');
  });
}

function validateLoginForm() {
  const reporterIdInput = document.getElementById('loginReporterId');
  const passwordInput = document.getElementById('loginPassword');
  const codeInput = document.getElementById('loginCode');
  const reporterId = reporterIdInput ? reporterIdInput.value.trim() : '';
  const password = passwordInput ? passwordInput.value : '';
  const rawCode = codeInput ? codeInput.value : '';
  let isValid = true;

  // 1. Check Reporter ID
  if (!reporterId) {
    setInputError(reporterIdInput, 'Reporter ID cannot be empty.');
    isValid = false;
  } else {
    setInputError(reporterIdInput, '');
  }

  // 2. Check Password
  if (!password) {
    setInputError(passwordInput, 'Password cannot be empty.');
    isValid = false;
  } else {
    setInputError(passwordInput, '');
  }

  // 3. Check CODE
  if (!rawCode || !rawCode.trim()) {
    setInputError(codeInput, 'Please enter the code.');
    isValid = false;
  } else if (rawCode !== LOGIN_ACCESS_CODE) {
    setInputError(codeInput, 'Invalid code. Please enter the correct code.');
    isValid = false;
  } else {
    setInputError(codeInput, '');
  }

  return isValid ? { reporterId, password, code: rawCode } : null;
}

async function handleLoginSubmit(event) {
  event.preventDefault();
  const payload = validateLoginForm();
  const statusElement = document.getElementById('loginStatus');

  if (!payload) {
    setStatus(statusElement, 'Please correct the highlighted fields.', 'error');
    return;
  }

  const users = getUsers();
  // Login authentication: Match by reporterId (case-insensitive)
  const candidateUser = users.find(
    (user) =>
      (user.reporterId && user.reporterId.toLowerCase() === payload.reporterId.toLowerCase()) ||
      (user.username && user.username.toLowerCase() === payload.reporterId.toLowerCase())
  );

  if (candidateUser) {
    const isPasswordValid = await verifyPassword(payload.password, candidateUser.password || candidateUser.passwordHash);
    if (isPasswordValid) {
      const activeReporterId = candidateUser.reporterId || candidateUser.username;
      localStorage.setItem(CURRENT_USER_KEY, JSON.stringify({ reporterId: activeReporterId }));
      setStatus(statusElement, 'Login successful', 'success');
      window.location.href = 'dashboard.html';
      return;
    }
  }

  setStatus(statusElement, 'Invalid Reporter ID or password', 'error');
}

// =====================================================
// CAPTCHA GENERATOR
// =====================================================
function generateCaptcha() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let captcha = '';

  for (let index = 0; index < 5; index += 1) {
    const randomIndex = Math.floor(Math.random() * chars.length);
    captcha += chars[randomIndex];
  }

  return captcha;
}

function setCaptcha() {
  const captchaDisplay = document.getElementById('captchaDisplay');
  const captchaInput = document.getElementById('captchaInput');

  if (!captchaDisplay || !captchaInput) return;

  const newCaptcha = generateCaptcha();
  captchaDisplay.textContent = newCaptcha;
  captchaDisplay.dataset.value = newCaptcha;
  captchaInput.value = '';
  setInputError(captchaInput, '');
}

// =====================================================
// PROFILE PHOTO UPLOAD & PHOTO SIZE VALIDATION
// =====================================================
function setupProfilePhotoUpload() {
  const photoInput = document.getElementById('profilePhoto');
  const previewContainer = document.getElementById('photoPreviewContainer');
  const previewImg = document.getElementById('photoPreviewImg');
  const removeBtn = document.getElementById('removePhotoBtn');
  const photoError = document.getElementById('photoError');

  if (!photoInput) return;

  photoInput.addEventListener('change', (event) => {
    const file = event.target.files && event.target.files[0];
    if (!file) return;

    // Photo size validation: reject files > 2 MB
    if (file.size > MAX_PHOTO_SIZE) {
      if (photoError) photoError.textContent = 'Profile photo cannot exceed 2 MB.';
      photoInput.value = '';
      selectedPhotoBase64 = '';
      if (previewContainer) previewContainer.classList.add('hidden');
      if (previewImg) previewImg.src = '';
      return;
    }

    if (photoError) photoError.textContent = '';

    const reader = new FileReader();
    reader.onload = () => {
      selectedPhotoBase64 = String(reader.result || '');
      if (previewImg) previewImg.src = selectedPhotoBase64;
      if (previewContainer) previewContainer.classList.remove('hidden');
    };
    reader.onerror = () => {
      if (photoError) photoError.textContent = 'Failed to read photo file.';
      selectedPhotoBase64 = '';
    };
    reader.readAsDataURL(file);
  });

  if (removeBtn) {
    removeBtn.addEventListener('click', () => {
      photoInput.value = '';
      selectedPhotoBase64 = '';
      if (previewContainer) previewContainer.classList.add('hidden');
      if (previewImg) previewImg.src = '';
      if (photoError) photoError.textContent = '';
    });
  }
}

// =====================================================
// REGISTRATION FORM VALIDATION & SUBMISSION
// // Mobile/email registration
// Enforces 10-digit mobile number, valid email format,
// First Name, Last Name, DOB, Reporter ID, Password, and CAPTCHA.
// =====================================================
function setupMobileInputFilter() {
  const mobileInput = document.getElementById('mobileNumber');
  if (!mobileInput) return;

  mobileInput.addEventListener('input', (event) => {
    // Restrict to numbers only, max 10 digits
    event.target.value = event.target.value.replace(/\D/g, '').slice(0, 10);
    setInputError(mobileInput, '');
  });
}

function validateRegisterForm() {
  const requiredFields = {
    firstName: document.getElementById('firstName'),
    lastName: document.getElementById('lastName'),
    dob: document.getElementById('dob'),
    reporterId: document.getElementById('reporterId'),
    mobileNumber: document.getElementById('mobileNumber'),
    email: document.getElementById('email'),
    password: document.getElementById('registerPassword'),
    confirmPassword: document.getElementById('confirmPassword'),
    captcha: document.getElementById('captchaInput')
  };

  let isValid = true;

  Object.entries(requiredFields).forEach(([key, input]) => {
    if (!input) return;

    if (key === 'captcha') {
      const expectedCaptcha = document.getElementById('captchaDisplay')?.dataset.value || '';
      const typedCaptcha = input.value.trim();

      if (!typedCaptcha) {
        setInputError(input, 'CAPTCHA is required.');
        isValid = false;
        return;
      }

      if (typedCaptcha.toUpperCase() !== expectedCaptcha.toUpperCase()) {
        setInputError(input, 'CAPTCHA is incorrect.');
        isValid = false;
        return;
      }

      setInputError(input, '');
      return;
    }

    // Mobile Number validation: exactly 10 digits numeric
    // // Mobile/email registration
    if (key === 'mobileNumber') {
      const rawMobile = input.value.trim();
      if (!rawMobile) {
        setInputError(input, 'Mobile number is required.');
        isValid = false;
        return;
      }
      if (!/^\d{10}$/.test(rawMobile)) {
        setInputError(input, 'Mobile number must be exactly 10 digits.');
        isValid = false;
        return;
      }
      setInputError(input, '');
      return;
    }

    // Email ID validation: valid email format
    // // Mobile/email registration
    if (key === 'email') {
      const rawEmail = input.value.trim();
      const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!rawEmail) {
        setInputError(input, 'Email ID is required.');
        isValid = false;
        return;
      }
      if (!emailPattern.test(rawEmail)) {
        setInputError(input, 'Please enter a valid email address.');
        isValid = false;
        return;
      }
      setInputError(input, '');
      return;
    }

    const value = input.value.trim();
    if (!value) {
      const labelMap = {
        firstName: 'First name',
        lastName: 'Last name',
        dob: 'Date of birth',
        reporterId: 'Reporter ID'
      };
      if (key !== 'password' && key !== 'confirmPassword') {
        setInputError(input, `${labelMap[key] || key} is required.`);
        isValid = false;
        return;
      }
    }

    setInputError(input, '');
  });

  // Password Complexity & Match Validation
  // // Password validation everywhere
  const passwordInput = document.getElementById('registerPassword');
  const confirmInput = document.getElementById('confirmPassword');
  const passwordVal = passwordInput ? passwordInput.value : '';
  const confirmVal = confirmInput ? confirmInput.value : '';

  const complexityResult = validatePasswordComplexity(passwordVal, 'Password');
  if (!complexityResult.isValid) {
    setInputError(passwordInput, complexityResult.error);
    isValid = false;
  } else {
    setInputError(passwordInput, '');
  }

  const matchResult = validatePasswordMatch(passwordVal, confirmVal);
  if (!matchResult.isValid) {
    setInputError(confirmInput, matchResult.error);
    isValid = false;
  } else {
    setInputError(confirmInput, '');
  }

  // Reporter ID uniqueness check
  const reporterIdInput = document.getElementById('reporterId');
  if (reporterIdInput && reporterIdInput.value.trim()) {
    const users = getUsers();
    const candidateId = reporterIdInput.value.trim().toLowerCase();
    const reporterIdExists = users.some(
      (user) => (user.reporterId && user.reporterId.toLowerCase() === candidateId) ||
                (user.username && user.username.toLowerCase() === candidateId)
    );

    if (reporterIdExists) {
      setInputError(reporterIdInput, 'This Reporter ID is already registered.');
      isValid = false;
    }
  }

  // Photo size check
  const photoInput = document.getElementById('profilePhoto');
  if (photoInput && photoInput.files && photoInput.files[0]) {
    if (photoInput.files[0].size > MAX_PHOTO_SIZE) {
      const photoError = document.getElementById('photoError');
      if (photoError) photoError.textContent = 'Profile photo cannot exceed 2 MB.';
      isValid = false;
    }
  }

  return isValid;
}

async function handleRegisterSubmit(event) {
  event.preventDefault();

  const form = document.getElementById('registerForm');
  const successBlock = document.getElementById('registerSuccess');

  if (!validateRegisterForm()) {
    return;
  }

  const firstName = document.getElementById('firstName').value.trim();
  const lastName = document.getElementById('lastName').value.trim();
  const dob = document.getElementById('dob').value;
  const reporterId = document.getElementById('reporterId').value.trim();
  const mobileNumber = document.getElementById('mobileNumber').value.trim();
  const email = document.getElementById('email').value.trim();
  const rawPassword = document.getElementById('registerPassword').value;
  const hashedPassword = await hashString(rawPassword, PWD_SALT);

  // Mobile/email registration
  // Data consistency keys: reporterId, mobileNumber, email, reporterName, designation, profilePhoto
  const reporterName = `${firstName} ${lastName}`.trim();
  const newUser = {
    reporterId: reporterId,
    mobileNumber: mobileNumber,
    email: email,
    reporterName: reporterName,
    firstName: firstName,
    lastName: lastName,
    dob: dob,
    designation: 'Reporter',
    profilePhoto: selectedPhotoBase64 || '',
    photo: selectedPhotoBase64 || '',
    password: hashedPassword,
    passwordHash: hashedPassword,
    createdAt: new Date().toISOString()
  };

  const users = getUsers();
  users.push(newUser);
  saveUsers(users);

  if (form) {
    form.classList.add('hidden');
  }

  if (successBlock) {
    successBlock.classList.remove('hidden');
  }
}

// =====================================================
// FORGOT PASSWORD / ACCOUNT RECOVERY FLOW
// Step 1: Account verification & Masked recovery selection
// Step 2: Verification code (OTP) validation with expiry
// Step 3: Password reset & security confirmation
// =====================================================

function resetRecoveryState() {
  if (recoveryState.timerInterval) {
    clearInterval(recoveryState.timerInterval);
  }
  recoveryState = {
    user: null,
    reporterId: '',
    method: 'mobile',
    maskedMobile: '',
    maskedEmail: '',
    codeHash: '',
    expiresAt: 0,
    attemptsLeft: 5,
    verified: false,
    resetToken: null,
    timerInterval: null
  };
}

function showForgotCard() {
  const loginCard = document.getElementById('loginCard');
  const forgotCard = document.getElementById('forgotPasswordCard');
  if (loginCard) loginCard.classList.add('hidden');
  if (forgotCard) forgotCard.classList.remove('hidden');

  switchForgotStep(1);
  resetRecoveryState();

  const reporterIdInput = document.getElementById('forgotReporterId');
  if (reporterIdInput) {
    reporterIdInput.value = '';
    setInputError(reporterIdInput, '');
  }

  const recoveryBox = document.getElementById('recoveryOptionsBox');
  if (recoveryBox) recoveryBox.classList.add('hidden');

  const banner = document.getElementById('forgotNoticeBanner');
  if (banner) banner.classList.add('hidden');
}

function showLoginCard() {
  resetRecoveryState();
  const loginCard = document.getElementById('loginCard');
  const forgotCard = document.getElementById('forgotPasswordCard');
  if (forgotCard) forgotCard.classList.add('hidden');
  if (loginCard) loginCard.classList.remove('hidden');

  const loginStatus = document.getElementById('loginStatus');
  if (loginStatus) setStatus(loginStatus, '', '');
  clearAllFieldErrors();
}

function switchForgotStep(stepNumber) {
  // Update step dots in stepper bar
  for (let i = 1; i <= 3; i += 1) {
    const dot = document.getElementById(`dotStep${i}`);
    if (dot) {
      dot.classList.toggle('active', i === stepNumber);
      dot.classList.toggle('completed', i < stepNumber);
    }
  }

  // Update step pane visibility
  for (let i = 1; i <= 4; i += 1) {
    const pane = document.getElementById(`forgotStep${i}`);
    if (pane) {
      pane.classList.toggle('hidden', i !== stepNumber);
    }
  }
}

// Step 1: Reporter ID Lookup & Recovery Selection
// // Reporter ID lookup
// // Recovery method selection
function handleFindAccount() {
  const idInput = document.getElementById('forgotReporterId');
  const errorElement = document.getElementById('forgotReporterIdError');
  const recoveryBox = document.getElementById('recoveryOptionsBox');
  const banner = document.getElementById('forgotNoticeBanner');

  if (!idInput) return;
  const typedId = idInput.value.trim();

  if (!typedId) {
    if (errorElement) errorElement.textContent = 'Please enter your Reporter ID.';
    idInput.classList.add('invalid');
    if (recoveryBox) recoveryBox.classList.add('hidden');
    return;
  }

  const users = getUsers();
  // Reporter ID lookup: Case-insensitive search
  const foundUser = users.find(
    (u) => (u.reporterId && u.reporterId.toLowerCase() === typedId.toLowerCase()) ||
           (u.username && u.username.toLowerCase() === typedId.toLowerCase())
  );

  if (!foundUser) {
    if (errorElement) errorElement.textContent = 'No registered account found with this Reporter ID.';
    idInput.classList.add('invalid');
    if (recoveryBox) recoveryBox.classList.add('hidden');
    return;
  }

  if (errorElement) errorElement.textContent = '';
  idInput.classList.remove('invalid');

  // Recovery method selection: Display masked mobile & email
  recoveryState.user = foundUser;
  recoveryState.reporterId = foundUser.reporterId || foundUser.username;
  recoveryState.maskedMobile = maskMobileNumber(foundUser.mobileNumber);
  recoveryState.maskedEmail = maskEmailAddress(foundUser.email);

  const maskedMobileEl = document.getElementById('maskedMobileText');
  const maskedEmailEl = document.getElementById('maskedEmailText');
  if (maskedMobileEl) maskedMobileEl.textContent = recoveryState.maskedMobile;
  if (maskedEmailEl) maskedEmailEl.textContent = recoveryState.maskedEmail;

  if (recoveryBox) {
    recoveryBox.classList.remove('hidden');
  }

  if (banner) banner.classList.add('hidden');
}

// Step 1 -> Step 2: Generate & Send Verification Code
// // Verification code
async function handleSendVerificationCode() {
  const methodRadio = document.querySelector('input[name="recoveryMethod"]:checked');
  const method = methodRadio ? methodRadio.value : 'mobile';
  recoveryState.method = method;

  // Generate secure 6-digit random code
  const code = Math.floor(100000 + Math.random() * 900000).toString();
  // Hash code for secure session verification
  recoveryState.codeHash = await hashString(code, OTP_SALT);
  recoveryState.expiresAt = Date.now() + 5 * 60 * 1000; // 5 minutes expiration
  recoveryState.attemptsLeft = 5;
  recoveryState.verified = false;
  recoveryState.resetToken = null;

  // Masked destination summary
  const destinationText = method === 'mobile'
    ? `Mobile (${recoveryState.maskedMobile})`
    : `Email (${recoveryState.maskedEmail})`;

  const summaryEl = document.getElementById('codeSentSummary');
  if (summaryEl) {
    summaryEl.textContent = `A 6-digit verification code was sent to your ${destinationText}.`;
  }

  // Display notice banner for simulated delivery / demo verification
  const banner = document.getElementById('forgotNoticeBanner');
  if (banner) {
    banner.textContent = `Verification code sent to your ${destinationText}. (Demo/Testing Code: ${code})`;
    banner.classList.remove('hidden');
  }

  const otpInput = document.getElementById('otpInput');
  const otpError = document.getElementById('otpError');
  if (otpInput) {
    otpInput.value = '';
    otpInput.classList.remove('invalid');
  }
  if (otpError) otpError.textContent = '';

  switchForgotStep(2);
  startOtpCountdownTimer();
}

function startOtpCountdownTimer() {
  if (recoveryState.timerInterval) {
    clearInterval(recoveryState.timerInterval);
  }

  const timerEl = document.getElementById('otpTimerText');
  const attemptsEl = document.getElementById('otpAttemptsText');

  function updateTimer() {
    const remainingMs = recoveryState.expiresAt - Date.now();
    if (remainingMs <= 0) {
      if (timerEl) timerEl.textContent = 'Code expired';
      clearInterval(recoveryState.timerInterval);
      return;
    }

    const totalSeconds = Math.floor(remainingMs / 1000);
    const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, '0');
    const seconds = String(totalSeconds % 60).padStart(2, '0');
    if (timerEl) timerEl.textContent = `Expires in ${minutes}:${seconds}`;
    if (attemptsEl) attemptsEl.textContent = `${recoveryState.attemptsLeft} attempts remaining`;
  }

  updateTimer();
  recoveryState.timerInterval = setInterval(updateTimer, 1000);
}

// Step 2: Verify OTP Code
// // Verification code
// // Authentication/security validation
async function handleVerifyOtpCode() {
  const otpInput = document.getElementById('otpInput');
  const otpError = document.getElementById('otpError');
  const attemptsEl = document.getElementById('otpAttemptsText');

  if (!otpInput) return;
  const typedCode = otpInput.value.trim();

  if (!typedCode) {
    if (otpError) otpError.textContent = 'Please enter the 6-digit verification code.';
    otpInput.classList.add('invalid');
    return;
  }

  // Check expiration
  if (Date.now() > recoveryState.expiresAt) {
    if (otpError) otpError.textContent = 'Verification code has expired. Please click Resend Code.';
    otpInput.classList.add('invalid');
    return;
  }

  // Check attempts limit
  if (recoveryState.attemptsLeft <= 0) {
    if (otpError) otpError.textContent = 'Maximum attempts exceeded. Please click Resend Code.';
    otpInput.classList.add('invalid');
    return;
  }

  const typedHash = await hashString(typedCode, OTP_SALT);
  if (typedHash === recoveryState.codeHash) {
    // Code verification successful
    if (recoveryState.timerInterval) {
      clearInterval(recoveryState.timerInterval);
    }
    recoveryState.verified = true;
    recoveryState.resetToken = `rst_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    const banner = document.getElementById('forgotNoticeBanner');
    if (banner) banner.classList.add('hidden');

    const newPwdInput = document.getElementById('resetNewPassword');
    const confirmPwdInput = document.getElementById('resetConfirmPassword');
    const resetErr = document.getElementById('resetPasswordError');
    if (newPwdInput) newPwdInput.value = '';
    if (confirmPwdInput) confirmPwdInput.value = '';
    if (resetErr) resetErr.textContent = '';

    switchForgotStep(3);
  } else {
    // Incorrect verification code
    recoveryState.attemptsLeft -= 1;
    if (attemptsEl) attemptsEl.textContent = `${recoveryState.attemptsLeft} attempts remaining`;

    if (recoveryState.attemptsLeft <= 0) {
      if (otpError) otpError.textContent = 'Too many incorrect attempts. Please request a new code.';
    } else {
      if (otpError) otpError.textContent = `Incorrect verification code. ${recoveryState.attemptsLeft} attempts remaining.`;
    }
    otpInput.classList.add('invalid');
  }
}

// Step 3: Password Reset Execution
// // Password reset
// // Authentication/security validation
async function handleSubmitResetPassword() {
  const newPwdInput = document.getElementById('resetNewPassword');
  const confirmPwdInput = document.getElementById('resetConfirmPassword');
  const resetErr = document.getElementById('resetPasswordError');

  // Security guard: verify that user has valid reset token & completed Step 2
  if (!recoveryState.verified || !recoveryState.resetToken || !recoveryState.reporterId) {
    if (resetErr) resetErr.textContent = 'Unauthorized password reset attempt. Please restart recovery.';
    return;
  }

  const newPassword = newPwdInput ? newPwdInput.value : '';
  const confirmPassword = confirmPwdInput ? confirmPwdInput.value : '';

  // Validate using unified password validation
  // // Password validation everywhere
  const complexityResult = validatePasswordComplexity(newPassword, 'Password');
  if (!complexityResult.isValid) {
    setInputError(newPwdInput, complexityResult.error);
    if (resetErr) resetErr.textContent = complexityResult.error;
    return;
  }
  setInputError(newPwdInput, '');

  const matchResult = validatePasswordMatch(newPassword, confirmPassword);
  if (!matchResult.isValid) {
    setInputError(confirmPwdInput, matchResult.error);
    if (resetErr) resetErr.textContent = matchResult.error;
    return;
  }
  setInputError(confirmPwdInput, '');
  if (resetErr) resetErr.textContent = '';

  // Password reset: Securely hash and update user's password
  const newPasswordHash = await hashString(newPassword, PWD_SALT);
  const users = getUsers();
  const userIdx = users.findIndex(
    (u) => (u.reporterId && u.reporterId.toLowerCase() === recoveryState.reporterId.toLowerCase()) ||
           (u.username && u.username.toLowerCase() === recoveryState.reporterId.toLowerCase())
  );

  if (userIdx !== -1) {
    users[userIdx].password = newPasswordHash;
    users[userIdx].passwordHash = newPasswordHash;
    saveUsers(users);
  }

  // Clear sensitive recovery tokens
  resetRecoveryState();

  // Show Step 4 Success screen
  switchForgotStep(4);
}

// =====================================================
// INITIALIZATION
// =====================================================
function attachInputClearHandlers() {
  document.querySelectorAll('.field-group input').forEach((input) => {
    input.addEventListener('input', () => {
      setInputError(input, '');
    });
  });
}

function setupForgotPasswordHandlers() {
  const forgotLink = document.getElementById('forgotPasswordLink');
  if (forgotLink) {
    forgotLink.addEventListener('click', (e) => {
      e.preventDefault();
      showForgotCard();
    });
  }

  const backBtns = document.querySelectorAll('.back-to-login-btn');
  backBtns.forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      showLoginCard();
    });
  });

  const backFromSuccessBtn = document.getElementById('backToLoginFromSuccessBtn');
  if (backFromSuccessBtn) {
    backFromSuccessBtn.addEventListener('click', (e) => {
      e.preventDefault();
      showLoginCard();
    });
  }

  const findBtn = document.getElementById('findAccountBtn');
  if (findBtn) {
    findBtn.addEventListener('click', handleFindAccount);
  }

  const sendCodeBtn = document.getElementById('sendCodeBtn');
  if (sendCodeBtn) {
    sendCodeBtn.addEventListener('click', handleSendVerificationCode);
  }

  const verifyOtpBtn = document.getElementById('verifyOtpBtn');
  if (verifyOtpBtn) {
    verifyOtpBtn.addEventListener('click', handleVerifyOtpCode);
  }

  const resendBtn = document.getElementById('resendCodeBtn');
  if (resendBtn) {
    resendBtn.addEventListener('click', handleSendVerificationCode);
  }

  const changeMethodBtn = document.getElementById('changeMethodBtn');
  if (changeMethodBtn) {
    changeMethodBtn.addEventListener('click', () => {
      switchForgotStep(1);
    });
  }

  const resetPwdBtn = document.getElementById('submitResetPasswordBtn');
  if (resetPwdBtn) {
    resetPwdBtn.addEventListener('click', handleSubmitResetPassword);
  }

  setupLivePasswordValidation('resetNewPassword', 'resetConfirmPassword');

  // OTP input formatting: only numbers, max 6
  const otpInput = document.getElementById('otpInput');
  if (otpInput) {
    otpInput.addEventListener('input', (e) => {
      e.target.value = e.target.value.replace(/\D/g, '').slice(0, 6);
      const err = document.getElementById('otpError');
      if (err) err.textContent = '';
      otpInput.classList.remove('invalid');
    });
  }
}

function initializeLoginPage() {
  const loginForm = document.getElementById('loginForm');
  if (!loginForm) return;

  setupPasswordToggle();
  setupCodeInputFilter();
  attachInputClearHandlers();
  setupForgotPasswordHandlers();
  loginForm.addEventListener('submit', handleLoginSubmit);
}

function initializeRegisterPage() {
  const registerForm = document.getElementById('registerForm');
  if (!registerForm) return;

  setupBackNavigation();
  setupPasswordToggle();
  attachInputClearHandlers();
  setupLivePasswordValidation('registerPassword', 'confirmPassword');
  setupMobileInputFilter();
  setupProfilePhotoUpload();
  setCaptcha();

  const refreshButton = document.getElementById('refreshCaptcha');
  if (refreshButton) {
    refreshButton.addEventListener('click', setCaptcha);
  }

  registerForm.addEventListener('submit', handleRegisterSubmit);
}

// =====================================================
// BACK NAVIGATION
// // Back navigation code: returns user to login/previous page.
// =====================================================
function setupBackNavigation() {
  const backBtn = document.getElementById('backNavBtn');
  if (!backBtn) return;
  backBtn.addEventListener('click', () => {
    if (window.history.length > 1 && document.referrer) {
      window.history.back();
    } else {
      window.location.href = 'index.html';
    }
  });
}

function initializeApp() {
  const currentPage = document.body.dataset.page;

  if (currentPage === 'login') {
    initializeLoginPage();
  }

  if (currentPage === 'register') {
    initializeRegisterPage();
  }
}

if (typeof document !== 'undefined') {
  initializeApp();
}

// =====================================================
// BACKEND & MODULE EXPORT
// Enforces the identical validation logic in server/Node.js environments.
// =====================================================
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    validatePasswordComplexity,
    validatePasswordMatch,
    SPECIAL_CHAR_REGEX,
    hashString,
    verifyPassword
  };
}
