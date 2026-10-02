const POSTS_KEY = 'btvNewsPosts';
const CURRENT_USER_KEY = 'btvNewsCurrentUser';
// Title and Description maximum character limits
const TITLE_MAX_LENGTH = 150;
const DESCRIPTION_MAX_LENGTH = 800;
const BTV_LOGO_PATH = 'assets/btv-logo.png';

// =====================================================
// BTV IMAGE STORAGE
// IndexedDB database for large image data.
// Stores images separately from localStorage to avoid quota issues.
// =====================================================
const BTV_DB_NAME = 'BTVNewsDB';
const BTV_DB_VERSION = 1;
const BTV_IMAGES_STORE = 'images';

let btvDB = null;

// ==========================================
// BTV IMAGE STORAGE
// Stores large image data outside localStorage.
// ==========================================
function dataUrlToBlob(dataUrl) {
  if (!dataUrl || typeof dataUrl !== 'string') return null;

  const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.*)$/.exec(dataUrl);
  if (!match) {
    return null;
  }

  const mimeType = match[1];
  const encoded = match[2];
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return new Blob([bytes], { type: mimeType });
}

function blobToDataUrl(blob) {
  return new Promise((resolve) => {
    if (!blob) {
      resolve('');
      return;
    }

    if (typeof blob === 'string') {
      resolve(blob);
      return;
    }

    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => resolve('');
    reader.readAsDataURL(blob);
  });
}

async function initBTVDatabase() {
  if (btvDB) return btvDB;
  
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(BTV_DB_NAME, BTV_DB_VERSION);
    
    request.onerror = () => {
      console.error('Failed to open IndexedDB:', request.error);
      resolve(null);
    };
    
    request.onsuccess = () => {
      btvDB = request.result;
      resolve(btvDB);
    };
    
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(BTV_IMAGES_STORE)) {
        db.createObjectStore(BTV_IMAGES_STORE);
      }
    };
  });
}

async function saveImageToIndexedDB(imageId, imageData) {
  const db = await initBTVDatabase();
  if (!db || !imageId || !imageData) return false;
  
  return new Promise((resolve) => {
    try {
      const transaction = db.transaction([BTV_IMAGES_STORE], 'readwrite');
      const store = transaction.objectStore(BTV_IMAGES_STORE);
      const imageBlob = imageData instanceof Blob ? imageData : dataUrlToBlob(imageData);
      if (!imageBlob) {
        resolve(false);
        return;
      }
      store.put(imageBlob, imageId);
      transaction.oncomplete = () => resolve(true);
      transaction.onerror = () => resolve(false);
    } catch (error) {
      console.error('Failed to save image to IndexedDB:', error);
      resolve(false);
    }
  });
}

async function getImageFromIndexedDB(imageId) {
  const db = await initBTVDatabase();
  if (!db || !imageId) return null;
  
  return new Promise((resolve) => {
    try {
      const transaction = db.transaction([BTV_IMAGES_STORE], 'readonly');
      const store = transaction.objectStore(BTV_IMAGES_STORE);
      const request = store.get(imageId);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => resolve(null);
    } catch (error) {
      console.error('Failed to get image from IndexedDB:', error);
      resolve(null);
    }
  });
}

async function deleteImageFromIndexedDB(imageId) {
  const db = await initBTVDatabase();
  if (!db) return false;
  
  return new Promise((resolve) => {
    try {
      const transaction = db.transaction([BTV_IMAGES_STORE], 'readwrite');
      const store = transaction.objectStore(BTV_IMAGES_STORE);
      store.delete(imageId);
      transaction.oncomplete = () => resolve(true);
      transaction.onerror = () => resolve(false);
    } catch (error) {
      console.error('Failed to delete image from IndexedDB:', error);
      resolve(false);
    }
  });
}

// =====================================================
// BTV LOGO ASSET LOADER
// Robustly loads the local BTV logo image asset.
// Ensures logo is fully loaded with valid dimensions before Canvas rendering.
// =====================================================
let cachedBtvLogo = null;

function createUntaintedImage(src, label = 'image') {
  if (!src) return Promise.resolve(null);

  return new Promise((resolve, reject) => {
    const image = new Image();
    // Do NOT set crossOrigin (causes taint on local/data URLs)
    image.onload = () => {
      if (image.naturalWidth > 0 && image.naturalHeight > 0) {
        resolve(image);
      } else {
        reject(new Error(`Image ${label} loaded with zero dimensions`));
      }
    };
    image.onerror = (err) => {
      console.warn(`Untainted image load failed for ${label}`);
      reject(new Error(`Failed to load ${label}`));
    };
    image.src = src;
  });
}

function getBtvLogoSize(baseSize = 72) {
  const logo = cachedBtvLogo || state.btvLogoImage;
  if (!logo || !logo.naturalWidth || !logo.naturalHeight) {
    return { width: baseSize, height: baseSize };
  }

  const aspectRatio = logo.naturalWidth / logo.naturalHeight;
  const width = baseSize;
  const height = width / aspectRatio;
  return { width, height };
}

function getImageLogoSize(image, baseSize = 72) {
  if (!image || !image.naturalWidth || !image.naturalHeight) {
    return { width: baseSize, height: baseSize };
  }

  const aspectRatio = image.naturalWidth / image.naturalHeight;
  const width = baseSize;
  const height = width / aspectRatio;
  return { width, height };
}

async function loadBtvLogo() {
  if (cachedBtvLogo && cachedBtvLogo.complete && cachedBtvLogo.naturalWidth > 0) {
    return cachedBtvLogo;
  }

  // Priority 1: Use in-memory Base64 Data URL (Guaranteed zero canvas taint in any browser)
  if (typeof window !== 'undefined' && window.BTV_LOGO_DATA_URL) {
    try {
      const logo = await createUntaintedImage(window.BTV_LOGO_DATA_URL, 'BTV Logo DataURL');
      if (logo && logo.naturalWidth > 0) {
        cachedBtvLogo = logo;
        state.btvLogoImage = logo;
        console.log('BTV logo loaded via in-memory DataURL:', logo.naturalWidth, 'x', logo.naturalHeight);
        return logo;
      }
    } catch (e) {
      console.warn('Failed to load window.BTV_LOGO_DATA_URL:', e);
    }
  }

  // Priority 2: Candidate local asset paths
  const candidateSources = [
    BTV_LOGO_PATH,
    './assets/btv-logo.png',
    '../assets/btv-logo.png',
    '/assets/btv-logo.png',
    '/project/assets/btv-logo.png'
  ];

  for (const src of candidateSources) {
    try {
      const logo = await createUntaintedImage(src, 'BTV Logo local path');
      if (logo && logo.naturalWidth > 0) {
        cachedBtvLogo = logo;
        state.btvLogoImage = logo;
        console.log('BTV logo loaded from path:', src);
        return logo;
      }
    } catch (e) {
      // try next candidate
    }
  }

  console.error('All BTV logo sources failed to load');
  return null;
}

const THEMES = {
  'royal-red': {
    name: 'Royal Red',
    titleColor: '#F3C74A',
    highlightColor: '#A10D1F',
    textColor: '#F5F1F3',
    accentColor: '#3F0A19',
    cardBg: '#1F070E',
    headerGradient: ['#7C0A20', '#A10D1F', '#B4152A'],
    headerBorder: '#E5122E',
    footerGradient: ['#860D20', '#700918', '#4A050F'],
    footerBorder: '#E5122E',
    imageBorder: 'rgba(240, 128, 80, 0.9)',
    shapesColor: 'rgba(229, 18, 46, 0.08)',
    fallbackGradient: ['#3E1129', '#1C0A14']
  },
  'deep-blue': {
    name: 'Deep Blue',
    titleColor: '#93C5FD',
    highlightColor: '#1D4ED8',
    textColor: '#E0EDFD',
    accentColor: '#0F275E',
    cardBg: '#060E24',
    headerGradient: ['#0C2569', '#1D4ED8', '#2563EB'],
    headerBorder: '#3B82F6',
    footerGradient: ['#1E40AF', '#172554', '#0A1538'],
    footerBorder: '#3B82F6',
    imageBorder: 'rgba(96, 165, 250, 0.9)',
    shapesColor: 'rgba(59, 130, 246, 0.09)',
    fallbackGradient: ['#102A6B', '#091536']
  },
  nature: {
    name: 'Nature',
    titleColor: '#86EFAC',
    highlightColor: '#15803D',
    textColor: '#ECFDF5',
    accentColor: '#064E3B',
    cardBg: '#051A10',
    headerGradient: ['#14532D', '#15803D', '#16A34A'],
    headerBorder: '#22C55E',
    footerGradient: ['#166534', '#14532D', '#052E16'],
    footerBorder: '#22C55E',
    imageBorder: 'rgba(74, 222, 128, 0.9)',
    shapesColor: 'rgba(34, 197, 94, 0.08)',
    fallbackGradient: ['#0F3D24', '#072013']
  },
  summer: {
    name: 'Summer',
    titleColor: '#FDE047',
    highlightColor: '#EA580C',
    textColor: '#FFF7ED',
    accentColor: '#7C2D12',
    cardBg: '#210E05',
    headerGradient: ['#C2410C', '#EA580C', '#F97316'],
    headerBorder: '#FB923C',
    footerGradient: ['#9A3412', '#7C2D12', '#431407'],
    footerBorder: '#FB923C',
    imageBorder: 'rgba(251, 146, 60, 0.9)',
    shapesColor: 'rgba(249, 115, 22, 0.08)',
    fallbackGradient: ['#4A1D0B', '#240C03']
  },
  purple: {
    name: 'Purple',
    titleColor: '#E879F9',
    highlightColor: '#7E22CE',
    textColor: '#FAF5FF',
    accentColor: '#3B0764',
    cardBg: '#160826',
    headerGradient: ['#581C87', '#7E22CE', '#9333EA'],
    headerBorder: '#A855F7',
    footerGradient: ['#6B21A8', '#581C87', '#2E1065'],
    footerBorder: '#A855F7',
    imageBorder: 'rgba(192, 132, 252, 0.9)',
    shapesColor: 'rgba(168, 85, 247, 0.09)',
    fallbackGradient: ['#3B125C', '#1B062C']
  },
  pastel: {
    name: 'Pastel',
    titleColor: '#FDE68A',
    highlightColor: '#DB2777',
    textColor: '#FDF2F8',
    accentColor: '#4C1D3D',
    cardBg: '#1A101C',
    headerGradient: ['#831843', '#9D174D', '#BE185D'],
    headerBorder: '#F472B6',
    footerGradient: ['#9D174D', '#701A40', '#3B0E23'],
    footerBorder: '#F472B6',
    imageBorder: 'rgba(244, 114, 182, 0.9)',
    shapesColor: 'rgba(244, 114, 182, 0.08)',
    fallbackGradient: ['#421A33', '#1F0B18']
  },
  gold: {
    name: 'Gold',
    titleColor: '#FACC15',
    highlightColor: '#B45309',
    textColor: '#FEFCE8',
    accentColor: '#451A03',
    cardBg: '#181204',
    headerGradient: ['#78350F', '#92400E', '#B45309'],
    headerBorder: '#F59E0B',
    footerGradient: ['#92400E', '#78350F', '#3B1704'],
    footerBorder: '#F59E0B',
    imageBorder: 'rgba(250, 204, 21, 0.9)',
    shapesColor: 'rgba(245, 158, 11, 0.09)',
    fallbackGradient: ['#45290A', '#1F1203']
  },
  dark: {
    name: 'Dark',
    titleColor: '#F8FAFC',
    highlightColor: '#334155',
    textColor: '#CBD5E1',
    accentColor: '#0F172A',
    cardBg: '#0B0E14',
    headerGradient: ['#1E293B', '#334155', '#475569'],
    headerBorder: '#64748B',
    footerGradient: ['#334155', '#1E293B', '#0F172A'],
    footerBorder: '#64748B',
    imageBorder: 'rgba(148, 163, 184, 0.85)',
    shapesColor: 'rgba(255, 255, 255, 0.05)',
    fallbackGradient: ['#242D3D', '#0F141C']
  },
  cyan: {
    name: 'Cyan',
    titleColor: '#22D3EE',
    highlightColor: '#0891B2',
    textColor: '#ECFEFF',
    accentColor: '#164E63',
    cardBg: '#05151D',
    headerGradient: ['#0E4E63', '#0891B2', '#06B6D4'],
    headerBorder: '#22D3EE',
    footerGradient: ['#0E4E63', '#155E75', '#083344'],
    footerBorder: '#22D3EE',
    imageBorder: 'rgba(34, 211, 238, 0.9)',
    shapesColor: 'rgba(34, 211, 238, 0.09)',
    fallbackGradient: ['#0D3A4B', '#061D26']
  }
};

// ==========================================
// BTV CARD STATE
// Stores all data used by Preview and Export.
// ==========================================
const state = {
  theme: 'royal-red',
  title: 'Breaking update from the newsroom',
  description: 'Your headline and description will appear here as the final published story.',
  // Card Language mode: 'telugu' or 'english'
  language: 'telugu',
  cardLanguage: 'telugu',
  // Title font selection (Noto Sans Telugu for Telugu, Roboto for English)
  titleFont: 'Noto Sans Telugu',
  // Description font selection (Noto Sans Telugu for Telugu, Roboto for English)
  descriptionFont: 'Noto Sans Telugu',
  titleSize: 56,
  descriptionSize: 50,
  gap: 20,
  autoFit: true,
  titleColor: '#F3C74A',
  highlightColor: '#A10D1F',
  textColor: '#F5F1F3',
  accentColor: '#3F0A19',
  imageData: '',
  mediaType: 'image',
  videoFile: null,
  videoUrl: '',
  videoDuration: 0,
  videoMuted: true,
  videoPlaying: false,
  videoCrop: null, // { x, y, w, h, rawW, rawH }
  videoTrim: { start: 0, end: 0 }, // { start: seconds, end: seconds }
  newsImage: null,
  btvLogoImage: null,
  reporterName: '',
  designation: '',
  reporterDesignation: '',
  crop: { zoom: 1, x: 50, y: 50 },
  previewDate: new Date().toISOString(),
  publishedUrl: '',
  renderedCanvas: null
};

const elements = {};

// =====================================================
// USER SESSION
// Reads the active dashboard user from localStorage.
// =====================================================
function getCurrentUser() {
  try {
    const value = localStorage.getItem(CURRENT_USER_KEY);
    return value ? JSON.parse(value) : null;
  } catch (error) {
    return null;
  }
}

function ensureAuthenticated() {
  if (!getCurrentUser()) {
    window.location.href = 'index.html';
    return false;
  }

  return true;
}

// =====================================================
// PUBLISH STORAGE
// Saves metadata and image data without exceeding localStorage quota.
// =====================================================
function getPosts() {
  try {
    const raw = localStorage.getItem(POSTS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (error) {
    return [];
  }
}

function sanitizePostForStorage(post = {}) {
  const metadata = { ...post };
  delete metadata.imageData;
  delete metadata.sourceImage;
  delete metadata.publishedImage;

  if (post.id && !metadata.imageId) {
    metadata.imageId = `${post.id}_source`;
  }

  if (post.id && !metadata.publishedImageId) {
    metadata.publishedImageId = `${post.id}_published`;
  }

  return metadata;
}

function savePosts(posts) {
  const metadataPosts = posts.map((post) => sanitizePostForStorage(post));

  try {
    localStorage.setItem(POSTS_KEY, JSON.stringify(metadataPosts));
  } catch (error) {
    console.error('Failed to save posts to localStorage:', error);
    throw new Error('Unable to save posts. Storage quota may be exceeded.');
  }
}

async function savePostWithImages(post) {
  if (!post || !post.id) {
    return;
  }

  const sourceImageId = `${post.id}_source`;
  const publishedImageId = `${post.id}_published`;

  if (post.imageData) {
    await saveImageToIndexedDB(sourceImageId, post.imageData);
  }

  if (post.publishedImage) {
    await saveImageToIndexedDB(publishedImageId, post.publishedImage);
  }

  const posts = getPosts();
  const nextPost = {
    ...post,
    imageId: sourceImageId,
    publishedImageId
  };

  delete nextPost.imageData;
  delete nextPost.sourceImage;
  delete nextPost.publishedImage;

  const index = posts.findIndex((item) => item.id === post.id);
  const updatedPosts = [...posts];

  if (index >= 0) {
    updatedPosts[index] = sanitizePostForStorage(nextPost);
  } else {
    updatedPosts.unshift(sanitizePostForStorage(nextPost));
  }

  savePosts(updatedPosts);
}

async function loadPostWithImages(post) {
  if (!post || !post.id) {
    return post;
  }

  const sourceImageId = post.imageId || `${post.id}_source`;
  const publishedImageId = post.publishedImageId || `${post.id}_published`;

  if (sourceImageId) {
    const sourceImage = await getImageFromIndexedDB(sourceImageId);
    if (sourceImage) {
      post.imageData = await blobToDataUrl(sourceImage);
    }
  }

  if (publishedImageId) {
    const publishedImage = await getImageFromIndexedDB(publishedImageId);
    if (publishedImage) {
      post.publishedImage = await blobToDataUrl(publishedImage);
    }
  }

  return post;
}

const TELUGU_MONTHS = [
  'జనవరి',
  'ఫిబ్రవరి',
  'మార్చి',
  'ఏప్రిల్',
  'మే',
  'జూన్',
  'జూలై',
  'ఆగస్టు',
  'సెప్టెంబర్',
  'అక్టోబర్',
  'నవంబర్',
  'డిసెంబర్'
];

function formatTeluguDate(dateValue) {
  let d = dateValue ? new Date(dateValue) : new Date();
  if (isNaN(d.getTime())) {
    d = new Date();
  }
  const day = d.getDate();
  const month = TELUGU_MONTHS[d.getMonth()];
  const year = d.getFullYear();
  return `${day} ${month}, ${year}`;
}

function formatDate(dateValue) {
  let d = dateValue ? new Date(dateValue) : new Date();
  if (isNaN(d.getTime())) {
    d = new Date();
  }
  return d.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric'
  });
}

function todayLabel(dateValue) {
  return state.language === 'english' ? formatDate(dateValue) : formatTeluguDate(dateValue);
}

function createId() {
  return `post_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function setStatus(message) {
  if (elements.copyStatus) {
    elements.copyStatus.textContent = message;
  }
}

function setDownloadButtonsState(enabled) {
  const buttons = [
    document.getElementById('downloadCardBtn'),
    document.getElementById('downloadPngBtn'),
    document.getElementById('downloadJpgBtn'),
    document.getElementById('downloadStoryBtn')
  ].filter(Boolean);

  buttons.forEach((button) => {
    button.disabled = !enabled;
    button.style.opacity = enabled ? '1' : '0.55';
    button.style.cursor = enabled ? 'pointer' : 'not-allowed';
  });
}

// =====================================================
// FORM DATA
// Keeps the live editor values and color inputs synced.
// =====================================================
function syncHexInputs() {
  elements.titleColorHex.value = state.titleColor;
  elements.highlightColorHex.value = state.highlightColor;
  elements.textColorHex.value = state.textColor;
  elements.accentColorHex.value = state.accentColor;

  elements.titleColorPicker.value = state.titleColor;
  elements.highlightColorPicker.value = state.highlightColor;
  elements.textColorPicker.value = state.textColor;
  elements.accentColorPicker.value = state.accentColor;
}

function isTeluguFont(fontName) {
  if (!fontName) return true;
  const lower = String(fontName).trim().toLowerCase();
  return lower === 'noto sans telugu' || lower === 'telugu' || lower === 'mandali' || !lower.includes('roboto');
}

function getTitleFontFamily(fontName) {
  return isTeluguFont(fontName)
    ? '"Noto Sans Telugu", sans-serif'
    : '"Roboto", sans-serif';
}

function getDescriptionFontFamily(fontName) {
  return isTeluguFont(fontName)
    ? '"Noto Sans Telugu", sans-serif'
    : '"Roboto", sans-serif';
}

function setCardLanguage(lang) {
  const nextLang = (lang === 'english') ? 'english' : 'telugu';
  state.language = nextLang;
  state.cardLanguage = nextLang;
  if (nextLang === 'english') {
    state.titleFont = 'Roboto';
    state.descriptionFont = 'Roboto';
  } else {
    state.titleFont = 'Noto Sans Telugu';
    state.descriptionFont = 'Noto Sans Telugu';
  }
  syncDisplayValues();
  updateSizeButtonStates();
  updatePreview();
}

function setupLanguageModeHandlers() {
  document.querySelectorAll('.lang-mode-btn[data-lang]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      setCardLanguage(btn.dataset.lang);
    });
  });
}

function syncDisplayValues() {
  if (elements.titleInput) {
    elements.titleInput.value = state.title || '';
    // Roboto font (English) / Mandali font (Telugu) for title input box
    elements.titleInput.style.fontFamily = getTitleFontFamily(state.titleFont);
    elements.titleInput.style.fontWeight = '700';
  }
  if (elements.descriptionInput) {
    elements.descriptionInput.value = state.description || '';
    // Roboto font (English) / Mandali font (Telugu) for description input box
    elements.descriptionInput.style.fontFamily = getDescriptionFontFamily(state.descriptionFont);
    elements.descriptionInput.style.fontWeight = '400';
  }

  // Active state for Live Preview Telugu/English mode toggle buttons
  const activeLang = state.language || (isTeluguFont(state.titleFont) ? 'telugu' : 'english');
  document.querySelectorAll('.lang-mode-btn[data-lang]').forEach((btn) => {
    const isSelected = btn.dataset.lang === activeLang;
    btn.classList.toggle('active', isSelected);
    btn.setAttribute('aria-pressed', isSelected ? 'true' : 'false');
  });

  if (elements.titleSizeValue) elements.titleSizeValue.textContent = `${state.titleSize}px`;
  if (elements.descriptionSizeValue) elements.descriptionSizeValue.textContent = `${state.descriptionSize}px`;
  if (elements.gapValue) elements.gapValue.textContent = `${state.gap}px`;
  if (elements.reporterNameInput) elements.reporterNameInput.value = state.reporterName || '';
  if (elements.reporterDesignationInput) elements.reporterDesignationInput.value = state.designation || state.reporterDesignation || '';
  if (elements.autoFitToggle) elements.autoFitToggle.checked = state.autoFit;
  if (elements.cropZoom) elements.cropZoom.value = state.crop.zoom;
  if (elements.cropX) elements.cropX.value = state.crop.x;
  if (elements.cropY) elements.cropY.value = state.crop.y;
  syncCharacterCounters();
  syncHexInputs();
  updateSizeButtonStates();
}

// =====================================================
// TITLE VALIDATION
// =====================================================
function clampTitleInput(value) {
  return String(value || '').slice(0, TITLE_MAX_LENGTH);
}

// =====================================================
// DESCRIPTION VALIDATION
// =====================================================
function clampDescriptionInput(value) {
  return String(value || '').replace(/\u00ad/g, '').slice(0, DESCRIPTION_MAX_LENGTH);
}

function syncCharacterCounters() {
  const titleCounterEl = elements.titleCounter || document.getElementById('titleCounter');
  const descCounterEl = elements.descriptionCounter || document.getElementById('descriptionCounter');

  const titleVal = elements.titleInput ? elements.titleInput.value : (state.title || '');
  const descVal = elements.descriptionInput ? elements.descriptionInput.value : (state.description || '');

  const titleLen = Math.min(TITLE_MAX_LENGTH, titleVal.length);
  const descLen = Math.min(DESCRIPTION_MAX_LENGTH, descVal.length);

  if (titleCounterEl) {
    titleCounterEl.textContent = `${titleLen} / ${TITLE_MAX_LENGTH}`;
  }
  if (descCounterEl) {
    descCounterEl.textContent = `${descLen} / ${DESCRIPTION_MAX_LENGTH}`;
  }
}

function validateTitle(titleValue) {
  const value = (titleValue || '').trim();
  if (!value) return 'Please enter a title.';
  if (value.length > TITLE_MAX_LENGTH) return 'Title cannot exceed 150 characters.';
  return '';
}

function validateDescription(descriptionValue) {
  const value = (descriptionValue || '').trim();
  if (!value) return 'Please enter a description.';
  if (value.length > DESCRIPTION_MAX_LENGTH) return `Description cannot exceed ${DESCRIPTION_MAX_LENGTH} characters.`;
  return '';
}

function validateFormData() {
  const titleError = validateTitle(state.title);
  if (titleError) {
    return titleError;
  }

  const descriptionError = validateDescription(state.description);
  if (descriptionError) {
    return descriptionError;
  }

  return '';
}

function updateStateFromInputs() {
  const nextTitle = clampTitleInput(elements.titleInput ? elements.titleInput.value : '');
  const nextDescription = clampDescriptionInput(elements.descriptionInput ? elements.descriptionInput.value : '');

  if (elements.titleInput && nextTitle !== elements.titleInput.value) {
    elements.titleInput.value = nextTitle;
  }

  if (elements.descriptionInput && nextDescription !== elements.descriptionInput.value) {
    elements.descriptionInput.value = nextDescription;
  }

  state.title = nextTitle;
  state.description = nextDescription;
  state.reporterName = elements.reporterNameInput ? elements.reporterNameInput.value.trim() : '';
  state.designation = elements.reporterDesignationInput ? elements.reporterDesignationInput.value.trim() : '';
  state.reporterDesignation = state.designation;
  state.autoFit = elements.autoFitToggle ? elements.autoFitToggle.checked : true;
  syncCharacterCounters();
}

function applyTheme(themeKey) {
  const theme = THEMES[themeKey] || THEMES['royal-red'];
  state.titleColor = theme.titleColor;
  state.highlightColor = theme.highlightColor;
  state.textColor = theme.textColor;
  state.accentColor = theme.accentColor;
  syncHexInputs();
  updatePreview();
}

// =====================================================
// FONT LOADER: ROBOTO & NOTO SANS TELUGU
// Ensures Roboto and Noto Sans Telugu fonts are loaded and available before canvas drawing.
// =====================================================
async function ensureCardFontsLoaded(extraFonts = []) {
  try {
    if (typeof document !== 'undefined' && document.fonts && document.fonts.load) {
      const fontLoads = [
        document.fonts.load('900 54px "Noto Sans Telugu"'),
        document.fonts.load('800 54px "Noto Sans Telugu"'),
        document.fonts.load('700 54px "Noto Sans Telugu"'),
        document.fonts.load('600 54px "Noto Sans Telugu"'),
        document.fonts.load('400 54px "Noto Sans Telugu"'),
        document.fonts.load('400 50px "Noto Sans Telugu"'),
        document.fonts.load('400 46px "Noto Sans Telugu"'),
        document.fonts.load('900 48px "Noto Sans Telugu"'),
        document.fonts.load('700 48px "Noto Sans Telugu"'),
        document.fonts.load('800 50px "Noto Sans Telugu"'),
        document.fonts.load('800 46px "Noto Sans Telugu"'),
        document.fonts.load('800 42px "Noto Sans Telugu"'),
        document.fonts.load('800 40px "Noto Sans Telugu"'),
        document.fonts.load('700 40px "Noto Sans Telugu"'),
        document.fonts.load('800 38px "Noto Sans Telugu"'),
        document.fonts.load('800 30px "Noto Sans Telugu"'),
        document.fonts.load('700 38px "Noto Sans Telugu"'),
        document.fonts.load('700 33px "Noto Sans Telugu"'),
        document.fonts.load('700 31px "Noto Sans Telugu"'),
        document.fonts.load('600 29px "Noto Sans Telugu"'),
        document.fonts.load('600 26px "Noto Sans Telugu"'),
        document.fonts.load('500 30px "Noto Sans Telugu"'),
        document.fonts.load('500 28px "Noto Sans Telugu"'),
        document.fonts.load('400 30px "Noto Sans Telugu"'),
        document.fonts.load('400 28px "Noto Sans Telugu"'),
        document.fonts.load('400 24px "Noto Sans Telugu"'),
        document.fonts.load('800 54px "Roboto"'),
        document.fonts.load('900 50px "Roboto"'),
        document.fonts.load('800 50px "Roboto"'),
        document.fonts.load('900 46px "Roboto"'),
        document.fonts.load('800 46px "Roboto"'),
        document.fonts.load('800 42px "Roboto"'),
        document.fonts.load('800 40px "Roboto"'),
        document.fonts.load('700 40px "Roboto"'),
        document.fonts.load('800 38px "Roboto"'),
        document.fonts.load('700 54px "Roboto"'),
        document.fonts.load('700 38px "Roboto"'),
        document.fonts.load('600 29px "Roboto"'),
        document.fonts.load('500 30px "Roboto"'),
        document.fonts.load('500 28px "Roboto"'),
        document.fonts.load('400 30px "Roboto"'),
        document.fonts.load('400 28px "Roboto"'),
        document.fonts.load('400 24px "Roboto"'),
        document.fonts.load('800 54px "Mandali"'),
        document.fonts.load('700 38px "Mandali"'),
        document.fonts.load('400 30px "Mandali"')
      ];

      if (Array.isArray(extraFonts) && extraFonts.length > 0) {
        extraFonts.forEach((f) => {
          if (typeof f === 'string' && f.trim()) {
            fontLoads.push(document.fonts.load(f));
          }
        });
      }

      await Promise.all(fontLoads);
      await document.fonts.ready;
    }
  } catch (err) {
    console.warn('Font load check notice:', err);
  }
}

// =====================================================
// FONT SELECTION HANDLERS
// // Title font selection
// // Description font selection
// // Roboto font
// // Noto Sans Telugu font
// =====================================================
function setupFontSelectionHandlers() {
  document.querySelectorAll('.font-btn[data-field]').forEach((button) => {
    button.addEventListener('click', () => {
      const field = button.dataset.field; // 'title' or 'description'
      const font = button.dataset.font;   // 'Roboto' or 'Mandali' / 'Noto Sans Telugu'

      if (field === 'title') {
        state.titleFont = font;
      } else if (field === 'description') {
        state.descriptionFont = font;
      }

      syncDisplayValues();
      // Applying selected fonts to live preview
      updatePreview();
    });
  });
}

// =====================================================
// 1. Reporter data storage
// Saves reporterName and designation to the logged-in reporter in localStorage.
// =====================================================
function saveReporterData(reporterName, designation) {
  const currentUser = getCurrentUser();
  const currentReporterId = currentUser ? (currentUser.reporterId || currentUser.username || '') : '';

  let users = [];
  try {
    users = JSON.parse(localStorage.getItem('btvNewsUsers') || '[]');
  } catch (e) {
    users = [];
  }

  let updated = false;
  users = users.map((user) => {
    const uId = user.reporterId || user.username || '';
    if (uId && currentReporterId && uId.toLowerCase() === currentReporterId.toLowerCase()) {
      user.reporterName = reporterName;
      user.designation = designation;
      updated = true;
    }
    return user;
  });

  if (!updated && currentReporterId) {
    users.push({
      reporterId: currentReporterId,
      reporterName: reporterName,
      designation: designation
    });
  }

  localStorage.setItem('btvNewsUsers', JSON.stringify(users));

  state.reporterName = reporterName;
  state.designation = designation;
  state.reporterDesignation = designation;
}

// =====================================================
// 2. Add/Update Reporter
// Listens for Add/Update and Remove Reporter buttons to persist data and update preview.
// =====================================================
function setupReporterHandlers() {
  const addBtn = document.getElementById('addReporterBtn');
  const removeBtn = document.getElementById('removeReporterBtn');
  const nameInput = document.getElementById('reporterNameInput');
  const designationInput = document.getElementById('reporterDesignationInput');

  if (addBtn) {
    addBtn.addEventListener('click', () => {
      const name = nameInput ? nameInput.value.trim() : '';
      const desig = designationInput ? designationInput.value.trim() : '';
      saveReporterData(name, desig);
      setStatus('Reporter details updated successfully.');
      updatePreview();
    });
  }

  if (removeBtn) {
    removeBtn.addEventListener('click', () => {
      if (nameInput) nameInput.value = '';
      if (designationInput) designationInput.value = '';
      saveReporterData('', '');
      setStatus('Reporter details removed.');
      updatePreview();
    });
  }

  if (nameInput) {
    nameInput.addEventListener('input', () => {
      state.reporterName = nameInput.value.trim();
      updatePreview();
    });
  }

  if (designationInput) {
    designationInput.addEventListener('input', () => {
      state.designation = designationInput.value.trim();
      state.reporterDesignation = state.designation;
      updatePreview();
    });
  }
}

// =====================================================
// 3. Loading reporter data
// Automatically loads saved reporterName and designation from user profile on initialization.
// =====================================================
function loadSavedReporterData() {
  const currentUser = getCurrentUser();
  const currentReporterId = currentUser ? (currentUser.reporterId || currentUser.username || '') : '';
  let savedName = '';
  let savedDesignation = '';

  if (currentReporterId) {
    try {
      const users = JSON.parse(localStorage.getItem('btvNewsUsers') || '[]');
      const user = users.find(
        (u) => (u.reporterId && u.reporterId.toLowerCase() === currentReporterId.toLowerCase()) ||
               (u.username && u.username.toLowerCase() === currentReporterId.toLowerCase())
      );
      if (user) {
        savedName = user.reporterName || '';
        savedDesignation = user.designation || '';
        if (!savedName && (user.firstName || user.lastName)) {
          savedName = `${user.firstName || ''} ${user.lastName || ''}`.trim();
        }
      }
    } catch (e) {
      console.warn('Error loading saved reporter details:', e);
    }
  }

  state.reporterName = savedName;
  state.designation = savedDesignation;
  state.reporterDesignation = savedDesignation;

  const nameInput = document.getElementById('reporterNameInput');
  const desigInput = document.getElementById('reporterDesignationInput');
  if (nameInput) nameInput.value = savedName;
  if (desigInput) desigInput.value = savedDesignation;
}

// =====================================================
// CARD RENDERING ENGINE (ROBOTO & NOTO SANS TELUGU FONTS & DYNAMIC HEIGHT)
// - Uses selected font (Roboto / Noto Sans Telugu) independently for Title & Description
// - English Title: Roboto + Bold (800)
// - English Description: Roboto + Regular (400)
// - Telugu Title: Noto Sans Telugu + Bold (800)
// - Telugu Description: Noto Sans Telugu + Regular (400)
// - Calculates dynamic card height based on description & title length
// - Reduced image height (480px) to allocate more vertical space to text
// - Aspect ratio preserved with no distortion
// =====================================================
function resolveThemeConfig(cardData = {}) {
  const themeKey = cardData.theme || state.theme || 'royal-red';
  const baseTheme = THEMES[themeKey] || THEMES['royal-red'];

  // Respect explicitly provided or state colors
  const titleColor = cardData.titleColor || state.titleColor || baseTheme.titleColor;
  const textColor = cardData.textColor || state.textColor || baseTheme.textColor;
  const highlightColor = cardData.highlightColor || state.highlightColor || baseTheme.highlightColor;
  const accentColor = cardData.accentColor || state.accentColor || baseTheme.accentColor;

  // Detect custom deviation from theme
  const isCustomHighlight = highlightColor.toUpperCase() !== baseTheme.highlightColor.toUpperCase();
  const isCustomAccent = accentColor.toUpperCase() !== baseTheme.accentColor.toUpperCase();

  let headerGradient = [...baseTheme.headerGradient];
  let footerGradient = [...baseTheme.footerGradient];
  let headerBorder = baseTheme.headerBorder;
  let footerBorder = baseTheme.footerBorder;
  let imageBorder = baseTheme.imageBorder;
  let cardBg = baseTheme.cardBg;
  let shapesColor = baseTheme.shapesColor;
  let fallbackGradient = [...baseTheme.fallbackGradient];

  if (isCustomHighlight) {
    headerGradient = [highlightColor, highlightColor, highlightColor];
    headerBorder = highlightColor;
    imageBorder = highlightColor;
    shapesColor = highlightColor;
  }
  if (isCustomAccent) {
    footerGradient = [accentColor, accentColor, accentColor];
    footerBorder = accentColor;
  }

  return {
    ...baseTheme,
    titleColor,
    textColor,
    highlightColor,
    accentColor,
    cardBg,
    headerGradient,
    footerGradient,
    headerBorder,
    footerBorder,
    imageBorder,
    shapesColor,
    fallbackGradient
  };
}

function applyTheme(themeKey, syncInputs = true) {
  if (!THEMES[themeKey]) return;
  state.theme = themeKey;
  const theme = THEMES[themeKey];

  state.titleColor = theme.titleColor;
  state.highlightColor = theme.highlightColor;
  state.textColor = theme.textColor;
  state.accentColor = theme.accentColor;

  // Update preset buttons active state
  document.querySelectorAll('.preset-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.theme === themeKey);
  });

  if (syncInputs) {
    syncHexInputs();
  }

  updatePreview();
}

async function renderCard(props = {}) {
  const { width = 1080, targetCanvas = null, cardData = state } = props;

  const resolvedTheme = resolveThemeConfig(cardData);

  const isEnglishMode = (cardData.language === 'english' || cardData.cardLanguage === 'english' || (!isTeluguFont(cardData.titleFont) && cardData.titleFont === 'Roboto'));

  const titleFont = cardData.titleFont || (isEnglishMode ? 'Roboto' : 'Noto Sans Telugu');
  const descriptionFont = cardData.descriptionFont || (isEnglishMode ? 'Roboto' : 'Noto Sans Telugu');

  const titleFontFamily = getTitleFontFamily(titleFont);
  const descFontFamily = getDescriptionFontFamily(descriptionFont);

  const titleFontSize = Math.max(28, Math.min(96, Number(cardData.titleSize !== undefined ? cardData.titleSize : state.titleSize) || 56));
  const descriptionFontSize = Math.max(16, Math.min(64, Number(cardData.descriptionSize !== undefined ? cardData.descriptionSize : state.descriptionSize) || 50));

  await ensureCardFontsLoaded([
    `900 ${titleFontSize}px "Noto Sans Telugu"`,
    `700 ${titleFontSize}px "Noto Sans Telugu"`,
    `600 ${titleFontSize}px "Noto Sans Telugu"`,
    `400 ${descriptionFontSize}px "Noto Sans Telugu"`,
    `400 50px "Noto Sans Telugu"`,
    `400 46px "Noto Sans Telugu"`,
    `700 ${titleFontSize}px "Roboto"`,
    `400 ${descriptionFontSize}px "Roboto"`
  ]);

  const data = {
    title: cardData.title || 'Breaking update from the newsroom',
    description: cardData.description || 'Your headline and description will appear here as the final published story.',
    titleFont,
    descriptionFont,
    titleSize: titleFontSize,
    descriptionSize: descriptionFontSize,
    gap: Number(cardData.gap !== undefined ? cardData.gap : state.gap) !== undefined ? Number(cardData.gap !== undefined ? cardData.gap : state.gap) : 20,
    titleColor: resolvedTheme.titleColor,
    textColor: resolvedTheme.textColor,
    highlightColor: resolvedTheme.highlightColor,
    accentColor: resolvedTheme.accentColor,
    reporterName: cardData.reporterName !== undefined ? cardData.reporterName : (state.reporterName || ''),
    designation: cardData.designation || cardData.reporterDesignation || state.designation || state.reporterDesignation || '',
    reporterDesignation: cardData.designation || cardData.reporterDesignation || state.designation || state.reporterDesignation || '',
    imageData: cardData.imageData !== undefined ? cardData.imageData : (state.imageData || ''),
    crop: cardData.crop || state.crop || { zoom: 1, x: 50, y: 50 }
  };

  // Strict 9:16 aspect ratio: ALWAYS exactly 1080 x 1920 (width * 16 / 9)
  const computedHeight = Math.round(width * 16 / 9);

  const canvas = targetCanvas || document.createElement('canvas');
  canvas.width = width;
  canvas.height = computedHeight;
  const ctx = canvas.getContext('2d');

  // Content area boundaries within fixed 9:16 layout
  const titleAreaLeft = 78;
  const titleAreaWidth = width - 156; // 924px
  const headerHeight = 180;
  const imageY = 216;
  const imageH = 410;
  const titleAreaTop = imageY + imageH + 32; // 658px
  const footerHeight = 190;
  const footerStartY = canvas.height - footerHeight; // 1730px
  const contentAreaBottom = footerStartY - 28; // 1702px
  const availableContentHeight = contentAreaBottom - titleAreaTop; // 1044px

  // Generous padding & line-height so top glyph ascenders and matras never clip
  const titlePaddingTop = Math.max(10, Math.round(titleFontSize * 0.10));
  const titleLineHeight = isTeluguFont(titleFont)
    ? Math.round(titleFontSize * 1.30)
    : Math.round(titleFontSize * 1.25);

  // Temporary canvas to measure text with selected font
  const measureCanvas = document.createElement('canvas');
  const measureCtx = measureCanvas.getContext('2d');
  const titleWeight = '700';
  measureCtx.font = isTeluguFont(titleFont)
    ? `700 ${titleFontSize}px "Noto Sans Telugu", sans-serif`
    : `${titleWeight} ${titleFontSize}px ${titleFontFamily}`;
  
  // Wrap complete title text so entire headline is visible
  const titleLines = wrapText(measureCtx, data.title, titleAreaWidth);
  const titleTotalHeight = titlePaddingTop + (titleLines.length * titleLineHeight);

  let effectiveDescSize = descriptionFontSize;
  let effectiveGap = Math.max(4, Math.min(36, Number(data.gap) !== undefined ? Number(data.gap) : 20));
  let descLineHeight = Math.round(effectiveDescSize * 1.48);
  measureCtx.font = isTeluguFont(descriptionFont)
    ? `400 ${effectiveDescSize}px "Noto Sans Telugu", sans-serif`
    : `400 ${effectiveDescSize}px ${descFontFamily}`;
  let descLines = wrapDescriptionLines(measureCtx, data.description, titleAreaWidth);

  // Auto-fit loop: dynamically scales description font size and gap so stories up to 800
  // characters fit comfortably within availableContentHeight (1044px) without overflow!
  const minDescSize = 16;
  while (effectiveDescSize >= minDescSize) {
    descLineHeight = Math.round(effectiveDescSize * 1.48);
    measureCtx.font = isTeluguFont(descriptionFont)
      ? `400 ${effectiveDescSize}px "Noto Sans Telugu", sans-serif`
      : `400 ${effectiveDescSize}px ${descFontFamily}`;
    descLines = wrapDescriptionLines(measureCtx, data.description, titleAreaWidth);
    const descTotalHeight = descLines.length * descLineHeight;
    const totalHeight = titleTotalHeight + effectiveGap + descTotalHeight;

    if (totalHeight <= availableContentHeight || effectiveDescSize <= minDescSize) {
      break;
    }

    if (effectiveGap > 12) {
      effectiveGap = Math.max(8, effectiveGap - 2);
    } else {
      effectiveDescSize -= 1;
    }
  }

  // Use available vertical space: expand line spacing and comfortable padding
  // so the description text fills the available area naturally instead of leaving a large empty gap.
  const currentTotalContent = titleTotalHeight + effectiveGap + (descLines.length * descLineHeight);
  const remainingVerticalSpace = availableContentHeight - currentTotalContent;

  if (remainingVerticalSpace > 20 && descLines.length > 0) {
    // Distribute extra space to line spacing (up to ~1.72 line-height ratio)
    const maxLineHeight = Math.round(effectiveDescSize * 1.72);
    const extraLineSpacing = Math.min(
      maxLineHeight - descLineHeight,
      Math.floor((remainingVerticalSpace * 0.55) / Math.max(1, descLines.length))
    );
    if (extraLineSpacing > 0) {
      descLineHeight += extraLineSpacing;
    }

    // Slightly relax gap between title and description if space permits
    const extraGap = Math.min(14, Math.floor(remainingVerticalSpace * 0.15));
    if (extraGap > 0) {
      effectiveGap = Math.min(36, effectiveGap + extraGap);
    }
  }

  const descriptionStartY = titleAreaTop + titleTotalHeight + effectiveGap;

  let btvLogo = cardData.btvLogoImage || state.btvLogoImage || null;
  if (!btvLogo || !btvLogo.complete || btvLogo.naturalWidth === 0) {
    try {
      btvLogo = await loadBtvLogo();
    } catch (error) {
      console.error('Failed to load BTV logo:', error);
      btvLogo = null;
    }
  }

  let newsImage = cardData.newsImage || null;
  if ((!newsImage || !newsImage.complete || newsImage.naturalWidth === 0) && data.imageData) {
    try {
      newsImage = await loadImageFromDataUrl(data.imageData, 'uploaded news image');
    } catch (error) {
      console.error('Failed to load news image:', error);
      newsImage = null;
    }
  }

  await waitForImagesLoaded([btvLogo, newsImage]);
  state.btvLogoImage = btvLogo || state.btvLogoImage;
  state.newsImage = newsImage || state.newsImage;

  // Background filled with theme card background
  ctx.fillStyle = resolvedTheme.cardBg;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Decorative ambient circles tinted with theme shape color
  ctx.fillStyle = resolvedTheme.shapesColor;
  ctx.beginPath();
  ctx.arc(160, 290, 260, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(930, 820, 260, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(350, canvas.height - 300, 220, 0, Math.PI * 2);
  ctx.fill();

  // =====================================================
  // BTV CARD TOP HEADER (Noto Sans Telugu / Mandali Font)
  // =====================================================
  const headerRadius = 32;

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(0, headerHeight);
  ctx.lineTo(0, headerRadius);
  ctx.quadraticCurveTo(0, 0, headerRadius, 0);
  ctx.lineTo(canvas.width - headerRadius, 0);
  ctx.quadraticCurveTo(canvas.width, 0, canvas.width, headerRadius);
  ctx.lineTo(canvas.width, headerHeight);
  ctx.closePath();

  const headerGradient = ctx.createLinearGradient(0, 0, canvas.width, 0);
  headerGradient.addColorStop(0, resolvedTheme.headerGradient[0]);
  headerGradient.addColorStop(0.5, resolvedTheme.headerGradient[1]);
  headerGradient.addColorStop(1, resolvedTheme.headerGradient[2]);
  ctx.fillStyle = headerGradient;
  ctx.fill();
  ctx.restore();

  // Separator below header
  ctx.fillStyle = resolvedTheme.headerBorder;
  ctx.fillRect(0, headerHeight, canvas.width, 3);

  const headerPaddingX = 54;
  const headerCenterY = headerHeight / 2;

  const repName = (data.reporterName || '').trim();
  const repDesig = (data.designation || data.reporterDesignation || '').trim();
  let reporterLine = '';
  if (repName && repDesig) {
    reporterLine = `${repName} — ${repDesig}`;
  } else if (repName) {
    reporterLine = repName;
  } else if (repDesig) {
    reporterLine = repDesig;
  }

  // Header Right: Date (English format in English mode, Telugu format in Telugu mode)
  const dateText = isEnglishMode
    ? formatDate(cardData.date || cardData.publishedAt)
    : formatTeluguDate(cardData.date || cardData.publishedAt);
  ctx.fillStyle = '#FFFFFF';
  ctx.font = isEnglishMode
    ? '700 30px "Roboto", sans-serif'
    : '700 32px "Noto Sans Telugu", "Mandali", sans-serif';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  ctx.fillText(dateText, canvas.width - headerPaddingX, headerCenterY);

  const maxHeaderWidth = canvas.width - (headerPaddingX * 2);

  // Line 1: FIXED "BTV — TRUE NEWS FOR PEOPLE" (Always fully displayed, never truncated/shortened)
  const btvTagline = 'BTV — TRUE NEWS FOR PEOPLE';
  ctx.fillStyle = '#FFFFFF';
  ctx.font = '900 42px "Roboto", "Noto Sans Telugu", sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';

  if (reporterLine) {
    // 1. Tagline: "BTV — TRUE NEWS FOR PEOPLE" on Line 1
    ctx.fillText(btvTagline, headerPaddingX, 52);

    // 2. Line 2 (Under Tagline): "🎙 Reporter Name — Designation"
    if (repName && repDesig) {
      let curX = headerPaddingX;
      const micStr = '🎙 ';
      ctx.font = '800 38px "Noto Sans Telugu", "Roboto", sans-serif';
      const micW = ctx.measureText(micStr).width;

      ctx.font = '800 38px "Noto Sans Telugu", "Roboto", sans-serif';
      const nameW = ctx.measureText(repName).width;

      const sepStr = ' — ';
      ctx.font = '400 30px "Noto Sans Telugu", "Roboto", sans-serif';
      const sepW = ctx.measureText(sepStr).width;

      ctx.font = '500 30px "Noto Sans Telugu", "Roboto", sans-serif';
      const desigW = ctx.measureText(repDesig).width;

      const totalRepWidth = micW + nameW + sepW + desigW;

      if (totalRepWidth <= maxHeaderWidth) {
        ctx.fillStyle = '#FFFFFF';
        ctx.font = '800 38px "Noto Sans Telugu", "Roboto", sans-serif';
        ctx.fillText(micStr + repName, curX, 126);
        curX += micW + nameW;

        ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
        ctx.font = '400 30px "Noto Sans Telugu", "Roboto", sans-serif';
        ctx.fillText(sepStr, curX, 126);
        curX += sepW;

        ctx.fillStyle = 'rgba(255, 255, 255, 0.90)';
        ctx.font = '500 30px "Noto Sans Telugu", "Roboto", sans-serif';
        ctx.fillText(repDesig, curX, 126);
      } else {
        ctx.font = '800 38px "Noto Sans Telugu", "Roboto", sans-serif';
        const displayRep = fitHeaderLeftText(ctx, `🎙 ${repName} — ${repDesig}`, maxHeaderWidth);
        ctx.fillStyle = '#FFFFFF';
        ctx.fillText(displayRep, headerPaddingX, 126);
      }
    } else {
      const singleText = repName ? `🎙 ${repName}` : `🎙 ${repDesig}`;
      ctx.font = '800 38px "Noto Sans Telugu", "Roboto", sans-serif';
      ctx.fillStyle = '#FFFFFF';
      const displayRep = fitHeaderLeftText(ctx, singleText, maxHeaderWidth);
      ctx.fillText(displayRep, headerPaddingX, 126);
    }
  } else {
    ctx.fillText(btvTagline, headerPaddingX, headerCenterY);
  }

  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';

  // =====================================================
  // NEWS IMAGE / VIDEO MEDIA (Aspect Ratio Preserved, Never Distorted)
  // =====================================================
  const imageX = 70;
  const imageW = canvas.width - 140;

  // Synchronize Live Preview video wrapper border with active theme
  const canvasVideoWrapper = document.getElementById('canvasVideoWrapper');
  if (canvasVideoWrapper) {
    canvasVideoWrapper.style.borderColor = resolvedTheme.imageBorder;
  }

  const isVideoMode = (cardData.mediaType === 'video' || state.mediaType === 'video');
  const videoElement = cardData.videoElement || (elements.cardPreviewVideo && elements.cardPreviewVideo.src ? elements.cardPreviewVideo : null);

  if (props.skipMediaDrawing) {
    // Leave media area transparent / clear for video recording compositor
    ctx.fillStyle = resolvedTheme.cardBg;
    ctx.fillRect(imageX, imageY, imageW, imageH);
  } else if (isVideoMode && videoElement) {
    try {
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.save();
      roundRect(ctx, imageX, imageY, imageW, imageH, 26);
      ctx.clip();

      if (state.videoCrop && state.videoCrop.w > 0 && state.videoCrop.h > 0) {
        ctx.drawImage(
          videoElement,
          state.videoCrop.x,
          state.videoCrop.y,
          state.videoCrop.w,
          state.videoCrop.h,
          imageX,
          imageY,
          imageW,
          imageH
        );
      } else {
        const vW = videoElement.videoWidth || 1920;
        const vH = videoElement.videoHeight || 1080;
        const coverScale = Math.max(imageW / vW, imageH / vH);
        const drawWidth = vW * coverScale;
        const drawHeight = vH * coverScale;
        const offsetX = (imageW - drawWidth) / 2;
        const offsetY = (imageH - drawHeight) / 2;
        ctx.drawImage(videoElement, imageX + offsetX, imageY + offsetY, drawWidth, drawHeight);
      }
      ctx.restore();

      ctx.strokeStyle = resolvedTheme.imageBorder;
      ctx.lineWidth = 2;
      roundRect(ctx, imageX, imageY, imageW, imageH, 26);
      ctx.stroke();
    } catch (error) {
      console.warn('Canvas video drawing notice:', error);
      ctx.fillStyle = '#000000';
      ctx.fillRect(imageX, imageY, imageW, imageH);
    }
  } else if (data.imageData && newsImage) {
    try {
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      const cropZoom = Math.max(1, Number(data.crop.zoom) || 1);
      const cropX = Number(data.crop.x) || 50;
      const cropY = Number(data.crop.y) || 50;
      const imgW = newsImage.naturalWidth || newsImage.width;
      const imgH = newsImage.naturalHeight || newsImage.height;
      const coverScale = Math.max(imageW / imgW, imageH / imgH);
      const drawWidth = imgW * coverScale * cropZoom;
      const drawHeight = imgH * coverScale * cropZoom;
      const maxPanX = Math.max(0, drawWidth - imageW);
      const maxPanY = Math.max(0, drawHeight - imageH);
      const offsetX = -maxPanX * (cropX / 100);
      const offsetY = -maxPanY * (cropY / 100);

      ctx.save();
      roundRect(ctx, imageX, imageY, imageW, imageH, 26);
      ctx.clip();
      ctx.drawImage(newsImage, imageX + offsetX, imageY + offsetY, drawWidth, drawHeight);
      ctx.restore();

      ctx.strokeStyle = resolvedTheme.imageBorder;
      ctx.lineWidth = 2;
      roundRect(ctx, imageX, imageY, imageW, imageH, 26);
      ctx.stroke();
    } catch (error) {
      console.error('News image rendering error:', error);
      ctx.fillStyle = resolvedTheme.fallbackGradient[0];
      ctx.fillRect(imageX, imageY, imageW, imageH);
    }
  } else {
    const fallbackGradient = ctx.createLinearGradient(0, imageY, 0, imageY + imageH);
    fallbackGradient.addColorStop(0, resolvedTheme.fallbackGradient[0]);
    fallbackGradient.addColorStop(1, resolvedTheme.fallbackGradient[1]);
    ctx.fillStyle = fallbackGradient;
    ctx.fillRect(imageX, imageY, imageW, imageH);

    ctx.strokeStyle = resolvedTheme.imageBorder;
    ctx.lineWidth = 2;
    roundRect(ctx, imageX, imageY, imageW, imageH, 26);
    ctx.stroke();
  }

  // =====================================================
  // TITLE & DESCRIPTION CONTENT RENDERING (Strict 9:16 Bounds, No Title Clipping)
  // Complete title always visible; no overflow:hidden clipping on title!
  // =====================================================
  // Title rendering (English: Roboto Bold, Telugu: Noto Sans Telugu Bold)
  ctx.save();
  ctx.fillStyle = data.titleColor;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.font = isTeluguFont(titleFont)
    ? `700 ${titleFontSize}px "Noto Sans Telugu", sans-serif`
    : `${titleWeight} ${titleFontSize}px ${titleFontFamily}`;

  const titleStartY = titleAreaTop + titlePaddingTop;
  titleLines.forEach((line, index) => {
    const y = titleStartY + (index * titleLineHeight);
    ctx.fillText(line, titleAreaLeft, y);
  });
  ctx.restore();

  // Description rendering (English: Roboto Regular 400, Telugu: Noto Sans Telugu Regular 400)
  ctx.save();
  ctx.fillStyle = data.textColor;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.font = isTeluguFont(descriptionFont)
    ? `400 ${effectiveDescSize}px "Noto Sans Telugu", sans-serif`
    : `400 ${effectiveDescSize}px ${descFontFamily}`;
  if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
  if ('wordSpacing' in ctx) ctx.wordSpacing = '0px';

  descLines.forEach((line, index) => {
    const y = descriptionStartY + (index * descLineHeight);
    if (y + descLineHeight <= contentAreaBottom + 4) {
      renderJustifiedDescriptionLine(ctx, line, titleAreaLeft, y, titleAreaWidth);
    }
  });
  ctx.restore();

  // =====================================================
  // BTV CARD FOOTER (Strict 9:16 Bounds, Fixed Height, 3-Column Layout)
  // Order: [BTV LOGO]   [Telugu text + BTV News]   [Follow Us + icons]
  // =====================================================
  const footerRadius = 32;

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(0, footerStartY);
  ctx.lineTo(canvas.width, footerStartY);
  ctx.lineTo(canvas.width, canvas.height - footerRadius);
  ctx.quadraticCurveTo(canvas.width, canvas.height, canvas.width - footerRadius, canvas.height);
  ctx.lineTo(footerRadius, canvas.height);
  ctx.quadraticCurveTo(0, canvas.height, 0, canvas.height - footerRadius);
  ctx.closePath();

  const footerGradient = ctx.createLinearGradient(0, footerStartY, 0, canvas.height);
  footerGradient.addColorStop(0, resolvedTheme.footerGradient[0]);
  footerGradient.addColorStop(0.4, resolvedTheme.footerGradient[1]);
  footerGradient.addColorStop(1, resolvedTheme.footerGradient[2]);
  ctx.fillStyle = footerGradient;
  ctx.fill();
  ctx.restore();

  // Top separator on footer
  ctx.fillStyle = resolvedTheme.footerBorder;
  ctx.fillRect(0, footerStartY, canvas.width, 3);

  // Geometry scaling relative to 1080p base
  const footerScale = canvas.width / 1080;
  const footerCenterY = footerStartY + (footerHeight / 2);
  const sideMargin = Math.round(48 * footerScale);

  // -----------------------------------------------------
  // 1. LEFT: Existing BTV logo
  // -----------------------------------------------------
  const logo = (btvLogo && btvLogo.complete && btvLogo.naturalWidth > 0)
    ? btvLogo
    : ((state.btvLogoImage && state.btvLogoImage.complete && state.btvLogoImage.naturalWidth > 0)
      ? state.btvLogoImage
      : cachedBtvLogo);

  const maxLogoW = Math.round(180 * footerScale);
  const maxLogoH = Math.round(114 * footerScale);
  let footerLogoWidth = maxLogoW;
  let footerLogoHeight = maxLogoH;

  if (logo && logo.naturalWidth > 0 && logo.naturalHeight > 0) {
    const naturalRatio = logo.naturalWidth / logo.naturalHeight;
    if (naturalRatio > maxLogoW / maxLogoH) {
      footerLogoWidth = maxLogoW;
      footerLogoHeight = Math.round(maxLogoW / naturalRatio);
    } else {
      footerLogoHeight = maxLogoH;
      footerLogoWidth = Math.round(maxLogoH * naturalRatio);
    }
  }

  const footerLogoX = sideMargin;
  const footerLogoY = Math.round(footerCenterY - (footerLogoHeight / 2));

  if (logo && logo.complete && logo.naturalWidth > 0 && logo.naturalHeight > 0) {
    ctx.drawImage(
      logo,
      footerLogoX,
      footerLogoY,
      footerLogoWidth,
      footerLogoHeight
    );
  } else {
    console.error('BTV logo not ready for Canvas rendering:', logo);
  }

  // -----------------------------------------------------
  // 2. FAR RIGHT: "Follow Us" + 4 Social Icons (YouTube, Facebook, X, Instagram)
  // Sized +30-40% larger for high prominence and readability
  // -----------------------------------------------------
  const iconRadius = Math.round(25 * footerScale);
  const iconGap = Math.round(14 * footerScale);
  const numIcons = 4;
  const iconsTotalWidth = (numIcons * (iconRadius * 2)) + ((numIcons - 1) * iconGap);
  const rightSectionX = canvas.width - sideMargin - iconsTotalWidth;
  const rightCenterX = rightSectionX + (iconsTotalWidth / 2);

  // "Follow Us" text (30-40% larger, vertically centered above icons)
  const followUsFontSize = Math.round(33 * footerScale);
  ctx.save();
  ctx.fillStyle = '#FFFFFF';
  ctx.font = `700 ${followUsFontSize}px "Roboto", "Noto Sans Telugu", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('Follow Us', rightCenterX, footerCenterY - Math.round(26 * footerScale));
  ctx.restore();

  // 4 Social Icons (Row beneath "Follow Us", vertically centered)
  const iconCenterY = footerCenterY + Math.round(25 * footerScale);
  const firstIconCenterX = rightSectionX + iconRadius;

  // Helper for rounded rect inside icons
  function drawDashboardSocialRoundedRect(c, rx, ry, rw, rh, rr) {
    const cr = Math.min(rr, rw / 2, rh / 2);
    c.beginPath();
    c.moveTo(rx + cr, ry);
    c.lineTo(rx + rw - cr, ry);
    c.quadraticCurveTo(rx + rw, ry, rx + rw, ry + cr);
    c.lineTo(rx + rw, ry + rh - cr);
    c.quadraticCurveTo(rx + rw, ry + rh, rx + rw - cr, ry + rh);
    c.lineTo(rx + cr, ry + rh);
    c.quadraticCurveTo(rx, ry + rh, rx, ry + rh - cr);
    c.lineTo(rx, ry + cr);
    c.quadraticCurveTo(rx, ry, rx + cr, ry);
    c.closePath();
  }

  // 2a. YouTube Icon
  const ytX = firstIconCenterX;
  ctx.save();
  ctx.beginPath();
  ctx.arc(ytX, iconCenterY, iconRadius, 0, Math.PI * 2);
  ctx.fillStyle = '#FF0000';
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(ytX - Math.round(6 * footerScale), iconCenterY - Math.round(9 * footerScale));
  ctx.lineTo(ytX + Math.round(9 * footerScale), iconCenterY);
  ctx.lineTo(ytX - Math.round(6 * footerScale), iconCenterY + Math.round(9 * footerScale));
  ctx.closePath();
  ctx.fillStyle = '#FFFFFF';
  ctx.fill();
  ctx.restore();

  // 2b. Facebook Icon
  const fbX = firstIconCenterX + (iconRadius * 2 + iconGap);
  ctx.save();
  ctx.beginPath();
  ctx.arc(fbX, iconCenterY, iconRadius, 0, Math.PI * 2);
  ctx.fillStyle = '#1877F2';
  ctx.fill();
  ctx.fillStyle = '#FFFFFF';
  ctx.font = `bold ${Math.round(33 * footerScale)}px "Roboto", Arial, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('f', fbX + Math.round(1.5 * footerScale), iconCenterY + Math.round(2 * footerScale));
  ctx.restore();

  // 2c. X (formerly Twitter) Icon
  const xX = firstIconCenterX + 2 * (iconRadius * 2 + iconGap);
  ctx.save();
  ctx.beginPath();
  ctx.arc(xX, iconCenterY, iconRadius, 0, Math.PI * 2);
  ctx.fillStyle = '#000000';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.28)';
  ctx.lineWidth = Math.max(1, Math.round(1.2 * footerScale));
  ctx.stroke();

  const xScale = 1.14 * footerScale;
  ctx.translate(xX, iconCenterY);
  ctx.scale(xScale, xScale);
  ctx.translate(-12, -12);
  const xPath = new Path2D("M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z");
  ctx.fillStyle = '#FFFFFF';
  ctx.fill(xPath);
  ctx.restore();

  // 2d. Instagram Icon
  const igX = firstIconCenterX + 3 * (iconRadius * 2 + iconGap);
  ctx.save();
  const igGrad = ctx.createLinearGradient(igX - iconRadius, iconCenterY + iconRadius, igX + iconRadius, iconCenterY - iconRadius);
  igGrad.addColorStop(0, '#f09433');
  igGrad.addColorStop(0.3, '#e6683c');
  igGrad.addColorStop(0.6, '#dc2743');
  igGrad.addColorStop(0.85, '#cc2366');
  igGrad.addColorStop(1, '#bc1888');
  ctx.beginPath();
  ctx.arc(igX, iconCenterY, iconRadius, 0, Math.PI * 2);
  ctx.fillStyle = igGrad;
  ctx.fill();

  ctx.strokeStyle = '#FFFFFF';
  ctx.lineWidth = Math.max(2, 2.6 * footerScale);
  drawDashboardSocialRoundedRect(ctx, igX - Math.round(12 * footerScale), iconCenterY - Math.round(12 * footerScale), Math.round(24 * footerScale), Math.round(24 * footerScale), Math.round(6.5 * footerScale));
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(igX, iconCenterY, Math.round(5.8 * footerScale), 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(igX + Math.round(6.2 * footerScale), iconCenterY - Math.round(6.2 * footerScale), Math.max(1.2, 1.8 * footerScale), 0, Math.PI * 2);
  ctx.fillStyle = '#FFFFFF';
  ctx.fill();
  ctx.restore();

  // -----------------------------------------------------
  // 3. MIDDLE: Telugu / English main text + BTV News
  // Telugu: "నిజమైన వార్తలు కోసం"
  // English: "For True News"
  // Subtitle: "BTV News · btvmedia.info"
  // Perfectly centered horizontally and vertically
  // -----------------------------------------------------
  const middleCenterX = canvas.width / 2;
  const maxMiddleWidth = rightSectionX - (footerLogoX + footerLogoWidth) - Math.round(32 * footerScale);

  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // Primary text: "For True News" (English) vs "నిజమైన వార్తలు కోసం" (Telugu)
  const footerMainText = isEnglishMode ? 'For True News' : 'నిజమైన వార్తలు కోసం';
  const footerMainFont = isEnglishMode ? '"Roboto", sans-serif' : '"Noto Sans Telugu", "Mandali", sans-serif';
  let footerMainFontSize = Math.round((isEnglishMode ? 36 : 34) * footerScale);
  ctx.font = `700 ${footerMainFontSize}px ${footerMainFont}`;
  while (ctx.measureText(footerMainText).width > maxMiddleWidth && footerMainFontSize > 18 * footerScale) {
    footerMainFontSize -= 1;
    ctx.font = `700 ${footerMainFontSize}px ${footerMainFont}`;
  }
  ctx.fillStyle = '#FFFFFF';
  ctx.fillText(footerMainText, middleCenterX, footerCenterY - Math.round(20 * footerScale));

  // Subtitle line: "BTV News · btvmedia.info"
  let subtitleFontSize = Math.round(23 * footerScale);
  const footerSubFont = isEnglishMode ? '"Roboto", sans-serif' : '"Noto Sans Telugu", "Mandali", sans-serif';
  ctx.font = `500 ${subtitleFontSize}px ${footerSubFont}`;
  while (ctx.measureText('BTV News · btvmedia.info').width > maxMiddleWidth && subtitleFontSize > 14 * footerScale) {
    subtitleFontSize -= 1;
    ctx.font = `500 ${subtitleFontSize}px ${footerSubFont}`;
  }
  ctx.fillStyle = 'rgba(255, 255, 255, 0.78)';
  ctx.fillText('BTV News · btvmedia.info', middleCenterX, footerCenterY + Math.round(22 * footerScale));
  ctx.restore();

  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  return canvas;
}

async function updatePreview() {
  updateStateFromInputs();
  setDownloadButtonsState(!validateFormData());

  const canvas = document.getElementById('newsCanvas');
  if (!canvas) return;

  if (!state.btvLogoImage || !state.btvLogoImage.complete || state.btvLogoImage.naturalWidth === 0) {
    try {
      state.btvLogoImage = await loadBtvLogo();
    } catch (error) {
      console.warn('BTV logo load warning in updatePreview:', error);
    }
  }

  try {
    await renderCard({ targetCanvas: canvas, cardData: state });
  } catch (error) {
    console.error('BTV renderCard preview failed:', error);
  }
}

function applyAutoFit() {
  const titleEl = elements.previewTitle;
  const descEl = elements.previewDescription;

  titleEl.style.fontSize = `${state.titleSize}px`;
  descEl.style.fontSize = `${state.descriptionSize}px`;

  let titleSize = state.titleSize;
  let descSize = state.descriptionSize;

  while (titleSize > 22 && titleEl.scrollHeight > 120) {
    titleSize -= 2;
    titleEl.style.fontSize = `${titleSize}px`;
  }

  while (descSize > 16 && descEl.scrollHeight > 150) {
    descSize -= 2;
    descEl.style.fontSize = `${descSize}px`;
  }
}

function handleColorInput(colorKey, value) {
  const normalized = value.startsWith('#') ? value : `#${value}`;
  if (!/^#[0-9A-Fa-f]{6}$/.test(normalized)) {
    return;
  }

  state[colorKey] = normalized.toUpperCase();
  syncHexInputs();

  // Check if current colors match any preset; if not, remove active class
  let matchingPreset = null;
  for (const [key, theme] of Object.entries(THEMES)) {
    if (
      theme.titleColor.toUpperCase() === state.titleColor.toUpperCase() &&
      theme.highlightColor.toUpperCase() === state.highlightColor.toUpperCase() &&
      theme.textColor.toUpperCase() === state.textColor.toUpperCase() &&
      theme.accentColor.toUpperCase() === state.accentColor.toUpperCase()
    ) {
      matchingPreset = key;
      break;
    }
  }

  document.querySelectorAll('.preset-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.theme === matchingPreset);
  });

  if (matchingPreset) {
    state.theme = matchingPreset;
  }

  updatePreview();
}

// =====================================================
// FIXED 9:16 CONTENT AREA FIT MEASUREMENT
// Ensures complete title and description fit inside the fixed 9:16 card without overflowing.
// =====================================================
function measureTitleHeight(titleSize, titleText = state.title, font = state.titleFont) {
  const width = 1080;
  const titleAreaWidth = width - 156; // 924px
  const titleFontFamily = getTitleFontFamily(font || 'Noto Sans Telugu');
  const measureCanvas = document.createElement('canvas');
  const measureCtx = measureCanvas.getContext('2d');
  const titleWeight = '700';
  measureCtx.font = isTeluguFont(font)
    ? `700 ${titleSize}px "Noto Sans Telugu", sans-serif`
    : `${titleWeight} ${titleSize}px ${titleFontFamily}`;
  const titleLines = wrapText(measureCtx, titleText || 'Breaking update from the newsroom', titleAreaWidth);
  const titlePaddingTop = Math.max(10, Math.round(titleSize * 0.10));
  const titleLineHeight = isTeluguFont(font)
    ? Math.round(titleSize * 1.30)
    : Math.round(titleSize * 1.25);
  return titlePaddingTop + (titleLines.length * titleLineHeight);
}

function measureDescriptionHeight(descSize, descText = state.description, font = state.descriptionFont) {
  const width = 1080;
  const titleAreaWidth = width - 156; // 924px
  const measureCanvas = document.createElement('canvas');
  const measureCtx = measureCanvas.getContext('2d');
  const descFontFamily = getDescriptionFontFamily(font || 'Noto Sans Telugu');
  measureCtx.font = isTeluguFont(font)
    ? `400 ${descSize}px "Noto Sans Telugu", sans-serif`
    : `400 ${descSize}px ${descFontFamily}`;
  const descLines = wrapDescriptionLines(measureCtx, descText || 'Your headline and description will appear here as the final published story.', titleAreaWidth);
  const descLineHeight = Math.round(descSize * 1.48);
  return descLines.length * descLineHeight;
}

function calculateCardContentHeight(titleSize, descSize, titleText = state.title, descText = state.description, gap = state.gap, titleFont = state.titleFont, descFont = state.descriptionFont) {
  const titleTotalHeight = measureTitleHeight(titleSize, titleText, titleFont);
  const descTotalHeight = measureDescriptionHeight(descSize, descText, descFont);
  const contentGap = Math.max(4, Math.min(36, Number(gap) !== undefined ? Number(gap) : 20));
  const totalContentHeight = titleTotalHeight + contentGap + descTotalHeight;
  return {
    titleTotalHeight,
    descTotalHeight,
    contentGap,
    totalContentHeight,
    availableContentHeight: 1044 // Fixed 9:16 content area: 1702 (footer top margin) - 658 (image bottom margin)
  };
}

function canTextFit(titleSize, descSize, titleText = state.title, descText = state.description, gap = state.gap, titleFont = state.titleFont, descFont = state.descriptionFont) {
  const res = calculateCardContentHeight(titleSize, descSize, titleText, descText, gap, titleFont, descFont);
  return res.totalContentHeight <= res.availableContentHeight;
}

function canTitleFit(targetTitleSize, titleText = state.title, titleFont = state.titleFont) {
  const availableContentHeight = 1044;
  const currentDescSize = Number(state.descriptionSize) || 50;
  const descHeight = measureDescriptionHeight(currentDescSize, state.description, state.descriptionFont);
  const gap = Math.max(4, Math.min(36, Number(state.gap) !== undefined ? Number(state.gap) : 20));

  // Protect description space while allowing title to utilize available space
  const descReservedHeight = Math.min(descHeight, Math.max(160, availableContentHeight - 420));
  const availableTitleHeight = availableContentHeight - descReservedHeight - gap;

  const nextTitleHeight = measureTitleHeight(targetTitleSize, titleText, titleFont);
  return nextTitleHeight <= availableTitleHeight;
}

function canDescriptionFit(targetDescSize, descText = state.description, descFont = state.descriptionFont) {
  const availableContentHeight = 1044;
  const currentTitleSize = Number(state.titleSize) || 56;
  const titleHeight = measureTitleHeight(currentTitleSize, state.title, state.titleFont);
  const gap = Math.max(4, Math.min(36, Number(state.gap) !== undefined ? Number(state.gap) : 20));

  const availableDescHeight = availableContentHeight - titleHeight - gap;
  const nextDescHeight = measureDescriptionHeight(targetDescSize, descText, descFont);
  return nextDescHeight <= availableDescHeight;
}

function updateSizeButtonStates() {
  const currentTitleSize = Number(state.titleSize) || 56;
  const currentDescSize = Number(state.descriptionSize) || 50;
  const currentGap = Number(state.gap) !== undefined ? Number(state.gap) : 20;

  // Title buttons (+ and -): bounded by template content fitting and min 28px
  const titlePlusBtn = document.querySelector('.step-btn[data-target="titleSize"][data-step="2"]');
  const titleMinusBtn = document.querySelector('.step-btn[data-target="titleSize"][data-step="-2"]');

  if (titlePlusBtn) {
    const nextTitleSize = currentTitleSize + 2;
    const canIncrease = canTitleFit(nextTitleSize);
    titlePlusBtn.disabled = !canIncrease;
    if (!canIncrease) {
      titlePlusBtn.setAttribute('title', `Next title size (${nextTitleSize}px) exceeds available area`);
    } else {
      titlePlusBtn.removeAttribute('title');
    }
  }
  if (titleMinusBtn) {
    const isAtMin = currentTitleSize <= 28;
    titleMinusBtn.disabled = isAtMin;
    if (isAtMin) {
      titleMinusBtn.setAttribute('title', 'Minimum title size is 28px');
    } else {
      titleMinusBtn.removeAttribute('title');
    }
  }

  // Description buttons (+ and -): bounded by template content fitting and min 16px
  const descPlusBtn = document.querySelector('.step-btn[data-target="descriptionSize"][data-step="2"]');
  const descMinusBtn = document.querySelector('.step-btn[data-target="descriptionSize"][data-step="-2"]');

  if (descPlusBtn) {
    const nextDescSize = currentDescSize + 2;
    const canIncrease = canDescriptionFit(nextDescSize);
    descPlusBtn.disabled = !canIncrease;
    if (!canIncrease) {
      descPlusBtn.setAttribute('title', `Next description size (${nextDescSize}px) exceeds available card area`);
    } else {
      descPlusBtn.removeAttribute('title');
    }
  }
  if (descMinusBtn) {
    const isAtMin = currentDescSize <= 16;
    descMinusBtn.disabled = isAtMin;
    if (isAtMin) {
      descMinusBtn.setAttribute('title', 'Minimum description size is 16px');
    } else {
      descMinusBtn.removeAttribute('title');
    }
  }

  // Gap buttons (+ and -) bounded strictly to configured range (4px - 36px)
  const gapPlusBtn = document.querySelector('.step-btn[data-target="gap"][data-step="2"]');
  const gapMinusBtn = document.querySelector('.step-btn[data-target="gap"][data-step="-2"]');
  if (gapPlusBtn) {
    const nextGap = currentGap + 2;
    const titleHeight = measureTitleHeight(currentTitleSize);
    const descHeight = measureDescriptionHeight(currentDescSize);
    const canIncreaseGap = nextGap <= 36 && (titleHeight + nextGap + descHeight) <= 1044;
    gapPlusBtn.disabled = !canIncreaseGap;
  }
  if (gapMinusBtn) {
    gapMinusBtn.disabled = currentGap <= 4;
  }
}

// =====================================================
// STEP CONTROLS (Title Size, Description Size, Gap/Spacing)
// Font size +/- controls operate directly on user-selected base size.
// Stops when next size step would no longer fit in available card area.
// =====================================================
function handleStepChange(target, stepValue) {
  const step = Number(stepValue) || 2;

  if (target === 'titleSize') {
    const currentSize = Number(state.titleSize) || 56;
    if (step > 0) {
      const nextSize = currentSize + step;
      if (!canTitleFit(nextSize)) {
        updateSizeButtonStates();
        return; // STOP: next size would overflow available area
      }
      state.titleSize = nextSize;
    } else if (step < 0) {
      state.titleSize = Math.max(28, currentSize + step);
    }
    if (elements.titleSizeValue) {
      elements.titleSizeValue.textContent = `${state.titleSize}px`;
    }
  }

  if (target === 'descriptionSize') {
    const currentSize = Number(state.descriptionSize) || 50;
    if (step > 0) {
      const nextSize = currentSize + step;
      if (!canDescriptionFit(nextSize)) {
        updateSizeButtonStates();
        return; // STOP: next size would overflow available area
      }
      state.descriptionSize = nextSize;
    } else if (step < 0) {
      state.descriptionSize = Math.max(16, currentSize + step);
    }
    if (elements.descriptionSizeValue) {
      elements.descriptionSizeValue.textContent = `${state.descriptionSize}px`;
    }
  }

  if (target === 'gap') {
    const currentGap = Number(state.gap) !== undefined ? Number(state.gap) : 20;
    if (step > 0) {
      const nextGap = currentGap + step;
      const titleHeight = measureTitleHeight(Number(state.titleSize) || 56);
      const descHeight = measureDescriptionHeight(Number(state.descriptionSize) || 50);
      if (nextGap > 36 || (titleHeight + nextGap + descHeight) > 1044) {
        updateSizeButtonStates();
        return;
      }
      state.gap = nextGap;
    } else if (step < 0) {
      state.gap = Math.max(4, currentGap + step);
    }
    if (elements.gapValue) {
      elements.gapValue.textContent = `${state.gap}px`;
    }
  }

  updateSizeButtonStates();
  updatePreview();
}

function addPresetHandlers() {
  document.querySelectorAll('.preset-btn').forEach((button) => {
    button.addEventListener('click', () => {
      applyTheme(button.dataset.theme);
    });
  });
}

// ==========================================
// SAFE IMAGE LOADING (ZERO CANVAS TAINT)
// Converts files to DataURLs and loads Images
// with strict same-origin semantics (no crossOrigin).
// ==========================================
function loadFileAsImage(file) {
  return new Promise((resolve, reject) => {
    if (!file) {
      reject(new Error('No image file selected.'));
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result;
      const image = new Image();
      image.onload = () => {
        if (image.naturalWidth > 0 && image.naturalHeight > 0) {
          resolve(image);
        } else {
          reject(new Error('Image has zero dimensions.'));
        }
      };
      image.onerror = () => reject(new Error('Failed to load selected image.'));
      image.src = dataUrl;
    };
    reader.onerror = () => reject(new Error('Failed to read selected image file.'));
    reader.readAsDataURL(file);
  });
}

// =====================================================
// DEDICATED IMAGE CROP MODAL CONTROLLER
// Immediately opens when an image is selected.
// Provides professional photo-editor controls:
// - Aspect ratio presets: Card (47:24 ~ 940:480), 16:9, 4:3, 1:1, Freeform
// - 4 Corner handles (dots) and 4 Middle / edge handles for resizing
// - Center drag for positioning
// - Rule-of-thirds grid lines
// - Clear Cancel and Confirm Crop buttons
// - Offscreen canvas extraction at high resolution
// =====================================================
const cropModalState = {
  mode: 'image', // 'image' | 'video'
  activeRatio: 'card',
  image: null,
  video: null,
  rawWidth: 0,
  rawHeight: 0,
  stageW: 0,
  stageH: 0,
  box: { x: 0, y: 0, w: 100, h: 100 },
  dragMode: null, // 'move' | 'nw' | 'ne' | 'se' | 'sw' | 'n' | 'e' | 's' | 'w'
  startX: 0,
  startY: 0,
  startBox: null,
  trimStart: 0,
  trimEnd: 0,
  videoDuration: 0,
  trimDragging: null // null | 'start' | 'end' | 'scrub'
};

const CROP_RATIO_VALUES = {
  card: 940 / 480, // ~1.95833 (matches card news photo area)
  '16:9': 16 / 9,
  '4:3': 4 / 3,
  '1:1': 1,
  free: null
};

function getCropRatioValue(ratioKey) {
  return CROP_RATIO_VALUES[ratioKey] || null;
}

function updateCropBoxDom() {
  const cropBox = document.getElementById('cropBox');
  if (!cropBox) return;
  const { box } = cropModalState;
  cropBox.style.left = `${Math.round(box.x)}px`;
  cropBox.style.top = `${Math.round(box.y)}px`;
  cropBox.style.width = `${Math.round(box.w)}px`;
  cropBox.style.height = `${Math.round(box.h)}px`;
}

function initCropBoxForCurrentRatio() {
  const { stageW, stageH, activeRatio } = cropModalState;
  if (!stageW || !stageH) return;

  const ratio = getCropRatioValue(activeRatio);
  let w = stageW * 0.92;
  let h = stageH * 0.92;

  if (ratio) {
    if (w / h > ratio) {
      w = h * ratio;
    } else {
      h = w / ratio;
    }
  }

  w = Math.max(48, Math.min(stageW, w));
  h = Math.max(32, Math.min(stageH, h));

  cropModalState.box = {
    x: Math.max(0, (stageW - w) / 2),
    y: Math.max(0, (stageH - h) / 2),
    w: w,
    h: h
  };

  updateCropBoxDom();
}

function adjustCropBoxToRatio(newRatioKey) {
  cropModalState.activeRatio = newRatioKey;
  const { stageW, stageH, box } = cropModalState;
  const ratio = getCropRatioValue(newRatioKey);

  if (!ratio) {
    return; // Freeform preserves current dimensions
  }

  const centerX = box.x + box.w / 2;
  const centerY = box.y + box.h / 2;

  let newW = box.w;
  let newH = newW / ratio;

  if (newH > stageH) {
    newH = stageH * 0.92;
    newW = newH * ratio;
  }
  if (newW > stageW) {
    newW = stageW * 0.92;
    newH = newW / ratio;
  }

  let newX = centerX - newW / 2;
  let newY = centerY - newH / 2;

  newX = Math.max(0, Math.min(stageW - newW, newX));
  newY = Math.max(0, Math.min(stageH - newH, newY));

  cropModalState.box = {
    x: newX,
    y: newY,
    w: newW,
    h: newH
  };

  updateCropBoxDom();
}

// ==========================================
// VIDEO TRIM CONTROLS & TIMELINE LOGIC
// ==========================================
function formatTrimTime(sec, includeTenths = false) {
  if (isNaN(sec) || sec === null || sec === undefined) return '0:00';
  const totalSeconds = Math.max(0, Number(sec) || 0);
  const mins = Math.floor(totalSeconds / 60);
  const secs = Math.floor(totalSeconds % 60);
  const base = `${mins}:${secs.toString().padStart(2, '0')}`;
  if (!includeTenths) return base;
  const tenths = Math.floor((totalSeconds % 1) * 10);
  return `${base}.${tenths}`;
}

// =====================================================
// PROFESSIONAL VIDEO CROP & TRIM STUDIO CONTROLLER
// High-performance NLE style video editor:
// - Aspect ratio presets: Card News (47:24), 16:9, 4:3, 1:1, Freeform
// - Rule-of-thirds grid overlay toggle
// - Zoom +, Zoom -, Fit, Fill, Reset Crop
// - Studio corner brackets and edge handles with drag & touch
// - Video filmstrip canvas timeline with live frame thumbnails
// - Caliper trim handles (start/end) with minimum 1s duration
// - Dimmed scrims outside selection & subtle highlight bar
// - Smooth draggable playhead needle
// - Frame-accurate timecodes: 00:00.000 (Start, End, Duration, Current)
// - Frame stepping (±1 frame = ±0.0333s), Jump to Start/End
// - Playback speed selector (0.25x, 0.5x, 1x, 1.5x, 2x)
// - Audio preview toggle & volume slider
// - Keyboard arrow keys for micro-adjustments (Shift for 0.5s jump)
// - Mobile responsive with touch handles and gesture support
// =====================================================
function formatVcmTimecode(sec) {
  if (isNaN(sec) || sec === null || sec === undefined) return '00:00.000';
  const clamped = Math.max(0, Number(sec) || 0);
  const mins = Math.floor(clamped / 60);
  const secs = Math.floor(clamped % 60);
  const millis = Math.floor((clamped % 1) * 1000);
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${millis.toString().padStart(3, '0')}`;
}

const vcmState = {
  rawWidth: 0,
  rawHeight: 0,
  duration: 0,
  stageW: 0,
  stageH: 0,
  zoom: 1,
  activeRatio: 'card',
  gridVisible: true,
  box: { x: 0, y: 0, w: 100, h: 100 },
  dragMode: null,
  startX: 0,
  startY: 0,
  startBox: null,
  trimStart: 0,
  trimEnd: 0,
  trimDragging: null,
  selectedHandle: null,
  isPlaying: false,
  playbackRate: 1,
  volume: 1,
  isMuted: true
};

const VCM_RATIOS = {
  card: 47 / 24,
  '16:9': 16 / 9,
  '4:3': 4 / 3,
  '1:1': 1,
  free: null
};

function getVcmRatio(key) {
  return VCM_RATIOS[key] !== undefined ? VCM_RATIOS[key] : (47 / 24);
}

function updateVcmCropBoxDom() {
  const cropBox = document.getElementById('vcmCropBox');
  const ratioPill = document.getElementById('vcmBoxRatioPill');
  if (!cropBox) return;

  const { box, activeRatio } = vcmState;
  cropBox.style.left = `${Math.round(box.x)}px`;
  cropBox.style.top = `${Math.round(box.y)}px`;
  cropBox.style.width = `${Math.round(box.w)}px`;
  cropBox.style.height = `${Math.round(box.h)}px`;

  if (ratioPill) {
    if (activeRatio === 'card') ratioPill.textContent = '47:24';
    else if (activeRatio === '16:9') ratioPill.textContent = '16:9';
    else if (activeRatio === '4:3') ratioPill.textContent = '4:3';
    else if (activeRatio === '1:1') ratioPill.textContent = '1:1';
    else {
      const calc = (box.w / (box.h || 1)).toFixed(2);
      ratioPill.textContent = `${calc}:1`;
    }
  }
}

function initVcmCropBox(ratioKey = vcmState.activeRatio) {
  const { stageW, stageH } = vcmState;
  if (!stageW || !stageH) return;

  const ratio = getVcmRatio(ratioKey);
  let w = stageW * 0.92;
  let h = stageH * 0.92;

  if (ratio) {
    if (w / h > ratio) {
      w = h * ratio;
    } else {
      h = w / ratio;
    }
  }

  w = Math.max(50, Math.min(stageW, w));
  h = Math.max(36, Math.min(stageH, h));

  vcmState.box = {
    x: Math.max(0, (stageW - w) / 2),
    y: Math.max(0, (stageH - h) / 2),
    w: w,
    h: h
  };
  vcmState.activeRatio = ratioKey;
  updateVcmCropBoxDom();
}

function vcmFitCropBox() {
  initVcmCropBox(vcmState.activeRatio);
}

function vcmFillCropBox() {
  const { stageW, stageH, activeRatio } = vcmState;
  const ratio = getVcmRatio(activeRatio);

  if (!ratio) {
    vcmState.box = { x: 0, y: 0, w: stageW, h: stageH };
  } else {
    let w = stageW;
    let h = stageH;
    if (w / h > ratio) {
      h = stageH;
      w = Math.min(stageW, h * ratio);
    } else {
      w = stageW;
      h = Math.min(stageH, w / ratio);
    }
    vcmState.box = {
      x: Math.max(0, (stageW - w) / 2),
      y: Math.max(0, (stageH - h) / 2),
      w: w,
      h: h
    };
  }
  updateVcmCropBoxDom();
}

function applyVcmZoom(zoomVal) {
  const clamped = Math.max(0.5, Math.min(2.5, Math.round(zoomVal * 100) / 100));
  vcmState.zoom = clamped;
  const stage = document.getElementById('vcmStage');
  const zoomLevel = document.getElementById('vcmZoomLevel');
  if (stage) {
    stage.style.transform = `scale(${clamped})`;
  }
  if (zoomLevel) {
    zoomLevel.textContent = `${Math.round(clamped * 100)}%`;
  }
}

function vcmResetCrop() {
  applyVcmZoom(1);
  vcmState.activeRatio = 'card';
  document.querySelectorAll('[data-vcm-ratio]').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.vcmRatio === 'card');
  });
  initVcmCropBox('card');
}

function vcmPlay() {
  const video = document.getElementById('vcmPreviewVideo');
  if (!video) return;

  if (video.currentTime < vcmState.trimStart || video.currentTime >= vcmState.trimEnd) {
    video.currentTime = vcmState.trimStart;
  }
  video.playbackRate = vcmState.playbackRate || 1;
  video.play().then(() => {
    vcmState.isPlaying = true;
    const icon = document.getElementById('vcmPlayMasterIcon');
    if (icon) icon.textContent = '⏸';
  }).catch((err) => console.warn('Preview video play warning:', err));
}

function vcmPause() {
  const video = document.getElementById('vcmPreviewVideo');
  if (!video) return;

  video.pause();
  vcmState.isPlaying = false;
  const icon = document.getElementById('vcmPlayMasterIcon');
  if (icon) icon.textContent = '▶';
}

function vcmTogglePlay() {
  const video = document.getElementById('vcmPreviewVideo');
  if (!video) return;
  if (video.paused) {
    vcmPlay();
  } else {
    vcmPause();
  }
}

function vcmStepFrame(direction) {
  const video = document.getElementById('vcmPreviewVideo');
  if (!video) return;
  vcmPause();
  const frameDuration = 1 / 30;
  const targetTime = video.currentTime + (direction * frameDuration);
  video.currentTime = Math.max(vcmState.trimStart, Math.min(vcmState.trimEnd, targetTime));
  vcmUpdatePlayhead(video.currentTime);
}

function vcmJumpToStart() {
  const video = document.getElementById('vcmPreviewVideo');
  if (!video) return;
  video.currentTime = vcmState.trimStart;
  vcmUpdatePlayhead(vcmState.trimStart);
}

function vcmJumpToEnd() {
  const video = document.getElementById('vcmPreviewVideo');
  if (!video) return;
  video.currentTime = vcmState.trimEnd;
  vcmUpdatePlayhead(vcmState.trimEnd);
}

function vcmUpdateTrimUI() {
  const { trimStart, trimEnd, duration } = vcmState;
  const safeDur = duration > 0 ? duration : 1;

  const startPct = Math.max(0, Math.min(100, (trimStart / safeDur) * 100));
  const endPct = Math.max(startPct, Math.min(100, (trimEnd / safeDur) * 100));

  const scrimLeft = document.getElementById('vcmScrimLeft');
  const scrimRight = document.getElementById('vcmScrimRight');
  const highlight = document.getElementById('vcmSelectionHighlight');
  const handleStart = document.getElementById('vcmHandleStart');
  const handleEnd = document.getElementById('vcmHandleEnd');
  const startTag = document.getElementById('vcmStartTag');
  const endTag = document.getElementById('vcmEndTag');

  const startDisp = document.getElementById('vcmStartTimeDisplay');
  const endDisp = document.getElementById('vcmEndTimeDisplay');
  const durDisp = document.getElementById('vcmDurationDisplay');
  const totalTc = document.getElementById('vcmTotalTimeCode');
  const durBadge = document.getElementById('vcmDurationBadge');

  if (scrimLeft) scrimLeft.style.width = `${startPct}%`;
  if (scrimRight) {
    scrimRight.style.left = `${endPct}%`;
    scrimRight.style.width = `${100 - endPct}%`;
  }
  if (highlight) {
    highlight.style.left = `${startPct}%`;
    highlight.style.width = `${Math.max(0, endPct - startPct)}%`;
  }
  if (handleStart) handleStart.style.left = `${startPct}%`;
  if (handleEnd) handleEnd.style.left = `${endPct}%`;

  const startStr = formatVcmTimecode(trimStart);
  const endStr = formatVcmTimecode(trimEnd);
  const durStr = formatVcmTimecode(Math.max(0, trimEnd - trimStart));
  const totalStr = formatVcmTimecode(duration);

  if (startTag) startTag.textContent = startStr;
  if (endTag) endTag.textContent = endStr;
  if (startDisp) startDisp.textContent = startStr;
  if (endDisp) endDisp.textContent = endStr;
  if (durDisp) durDisp.textContent = durStr;
  if (totalTc) totalTc.textContent = totalStr;
  if (durBadge) durBadge.textContent = totalStr;
}

function vcmUpdatePlayhead(time) {
  const { duration } = vcmState;
  const safeDur = duration > 0 ? duration : 1;
  const playhead = document.getElementById('vcmPlayhead');
  const curTc = document.getElementById('vcmCurrentTimeCode');

  const pct = Math.max(0, Math.min(100, (time / safeDur) * 100));
  if (playhead) playhead.style.left = `${pct}%`;
  if (curTc) curTc.textContent = formatVcmTimecode(time);
}

async function generateVcmFilmstrip(videoUrl, duration) {
  const canvas = document.getElementById('vcmFilmstripCanvas');
  if (!canvas || !videoUrl || !duration || duration <= 0) return;

  const rect = canvas.getBoundingClientRect();
  const width = Math.max(300, Math.floor(rect.width || canvas.parentElement?.clientWidth || 700));
  const height = Math.max(48, Math.floor(rect.height || 54));

  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  ctx.fillStyle = '#0F1524';
  ctx.fillRect(0, 0, width, height);

  const slotCount = Math.max(8, Math.min(16, Math.floor(width / 60)));
  const slotW = width / slotCount;

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
  ctx.lineWidth = 1;
  for (let i = 1; i < slotCount; i++) {
    ctx.beginPath();
    ctx.moveTo(i * slotW, 0);
    ctx.lineTo(i * slotW, height);
    ctx.stroke();
  }

  const offVideo = document.createElement('video');
  offVideo.src = videoUrl;
  offVideo.muted = true;
  offVideo.playsInline = true;
  offVideo.crossOrigin = 'anonymous';
  offVideo.preload = 'auto';

  try {
    await new Promise((resolve) => {
      offVideo.onloadedmetadata = () => resolve();
      offVideo.onerror = () => resolve();
      setTimeout(resolve, 2000);
    });

    const offCanvas = document.createElement('canvas');
    offCanvas.width = 120;
    offCanvas.height = Math.round(120 * (offVideo.videoHeight / offVideo.videoWidth || 9 / 16));
    const offCtx = offCanvas.getContext('2d');

    for (let i = 0; i < slotCount; i++) {
      const targetTime = Math.min(duration - 0.05, Math.max(0, (i / (slotCount - 1 || 1)) * duration));
      offVideo.currentTime = targetTime;

      await new Promise((res) => {
        const onSeeked = () => {
          offVideo.removeEventListener('seeked', onSeeked);
          res();
        };
        offVideo.addEventListener('seeked', onSeeked, { once: true });
        setTimeout(res, 200);
      });

      if (offCtx && offVideo.videoWidth > 0) {
        offCtx.drawImage(offVideo, 0, 0, offCanvas.width, offCanvas.height);
        ctx.drawImage(offCanvas, i * slotW, 0, slotW, height);

        ctx.strokeStyle = 'rgba(0, 0, 0, 0.4)';
        ctx.beginPath();
        ctx.moveTo(i * slotW, 0);
        ctx.lineTo(i * slotW, height);
        ctx.stroke();
      }
    }
  } catch (err) {
    console.warn('Filmstrip generation notice:', err);
  } finally {
    offVideo.removeAttribute('src');
    offVideo.load();
  }
}

function openVideoCropModal() {
  const modal = document.getElementById('videoCropModal');
  const video = document.getElementById('vcmPreviewVideo');
  const stage = document.getElementById('vcmStage');
  const stageArea = document.getElementById('vcmStageArea');
  const resBadge = document.getElementById('vcmResolutionBadge');
  const durBadge = document.getElementById('vcmDurationBadge');

  if (!modal || !video || !state.videoUrl) {
    setStatus('Please upload a video first.');
    return;
  }

  video.src = state.videoUrl;
  video.muted = vcmState.isMuted;
  video.volume = vcmState.volume;
  video.playbackRate = vcmState.playbackRate;
  video.playsInline = true;

  modal.classList.remove('hidden');
  modal.setAttribute('aria-hidden', 'false');

  const onLoaded = () => {
    requestAnimationFrame(() => {
      const vW = video.videoWidth || 1920;
      const vH = video.videoHeight || 1080;
      const dur = video.duration || state.videoDuration || 10;

      vcmState.rawWidth = vW;
      vcmState.rawHeight = vH;
      vcmState.duration = dur;

      if (resBadge) resBadge.textContent = `${vW}×${vH}`;
      if (durBadge) durBadge.textContent = formatVcmTimecode(dur);

      const maxStageW = Math.min(stageArea ? stageArea.clientWidth - 40 : 640, 680);
      const maxStageH = 340;
      let stageW = maxStageW;
      let stageH = Math.round(stageW * (vH / vW));

      if (stageH > maxStageH) {
        stageH = maxStageH;
        stageW = Math.round(stageH * (vW / vH));
      }

      vcmState.stageW = stageW;
      vcmState.stageH = stageH;

      if (stage) {
        stage.style.width = `${stageW}px`;
        stage.style.height = `${stageH}px`;
      }

      if (state.videoCrop && state.videoCrop.rawW) {
        const scaleX = stageW / state.videoCrop.rawW;
        const scaleY = stageH / state.videoCrop.rawH;
        vcmState.box = {
          x: Math.round(state.videoCrop.x * scaleX),
          y: Math.round(state.videoCrop.y * scaleY),
          w: Math.round(state.videoCrop.w * scaleX),
          h: Math.round(state.videoCrop.h * scaleY)
        };
        updateVcmCropBoxDom();
      } else {
        initVcmCropBox('card');
      }

      if (state.videoTrim && state.videoTrim.end > state.videoTrim.start && state.videoTrim.end <= dur) {
        vcmState.trimStart = state.videoTrim.start;
        vcmState.trimEnd = state.videoTrim.end;
      } else {
        vcmState.trimStart = 0;
        vcmState.trimEnd = dur;
      }

      vcmUpdateTrimUI();
      vcmUpdatePlayhead(vcmState.trimStart);

      generateVcmFilmstrip(state.videoUrl, dur);

      video.currentTime = vcmState.trimStart;
      vcmPlay();
    });
  };

  if (video.readyState >= 2 && video.videoWidth > 0 && video.duration > 0) {
    onLoaded();
  } else {
    video.onloadedmetadata = onLoaded;
  }
}

function closeVideoCropModal() {
  const modal = document.getElementById('videoCropModal');
  const video = document.getElementById('vcmPreviewVideo');
  if (video) {
    video.pause();
    video.removeAttribute('src');
    video.load();
  }
  if (modal) {
    modal.classList.add('hidden');
    modal.setAttribute('aria-hidden', 'true');
  }
  vcmState.isPlaying = false;
  vcmState.dragMode = null;
  vcmState.startBox = null;
  vcmState.trimDragging = null;
  vcmState.selectedHandle = null;
}

function confirmVideoCropAndTrim() {
  const { box, stageW, stageH, rawWidth, rawHeight, trimStart, trimEnd } = vcmState;
  if (!stageW || !stageH || box.w <= 0 || box.h <= 0) {
    closeVideoCropModal();
    return;
  }

  const scaleX = rawWidth / stageW;
  const scaleY = rawHeight / stageH;

  const sourceX = Math.max(0, Math.min(rawWidth - 1, Math.round(box.x * scaleX)));
  const sourceY = Math.max(0, Math.min(rawHeight - 1, Math.round(box.y * scaleY)));
  const sourceW = Math.max(10, Math.min(rawWidth - sourceX, Math.round(box.w * scaleX)));
  const sourceH = Math.max(10, Math.min(rawHeight - sourceY, Math.round(box.h * scaleY)));

  state.videoCrop = {
    x: sourceX,
    y: sourceY,
    w: sourceW,
    h: sourceH,
    rawW: rawWidth,
    rawH: rawHeight,
    zoom: vcmState.zoom
  };

  state.videoTrim = {
    start: trimStart,
    end: trimEnd
  };

  applyVideoCropToPreview();

  if (elements.videoDurationLabel) {
    const selectedSecs = Math.max(0, trimEnd - trimStart);
    elements.videoDurationLabel.textContent = formatTrimTime(selectedSecs);
  }

  if (elements.cardPreviewVideo) {
    elements.cardPreviewVideo.currentTime = trimStart;
  }

  closeVideoCropModal();
  updatePreview();
  setStatus('Video crop & trim settings applied successfully!');
}

let vcmHandlersAttached = false;
function setupVideoCropModalHandlers() {
  if (vcmHandlersAttached) return;
  vcmHandlersAttached = true;

  const modal = document.getElementById('videoCropModal');
  const closeBtn = document.getElementById('closeVideoCropModal');
  const cancelBtn = document.getElementById('vcmCancelBtn');
  const resetAllBtn = document.getElementById('vcmResetAllBtn');
  const confirmBtn = document.getElementById('vcmConfirmBtn');
  const resetCropBtn = document.getElementById('vcmResetCropBtn');
  const fitBtn = document.getElementById('vcmFitBtn');
  const fillBtn = document.getElementById('vcmFillBtn');
  const zoomInBtn = document.getElementById('vcmZoomInBtn');
  const zoomOutBtn = document.getElementById('vcmZoomOutBtn');
  const gridToggleBtn = document.getElementById('vcmGridToggleBtn');
  const gridLines = document.getElementById('vcmGridLines');
  const stageArea = document.getElementById('vcmStageArea');
  const cropBox = document.getElementById('vcmCropBox');
  const trackContainer = document.getElementById('vcmTrackContainer');
  const handleStart = document.getElementById('vcmHandleStart');
  const handleEnd = document.getElementById('vcmHandleEnd');
  const resetTrimBtn = document.getElementById('vcmResetTrimBtn');
  const playPauseBtn = document.getElementById('vcmPlayPauseBtn');
  const stepBackBtn = document.getElementById('vcmStepBackBtn');
  const stepFwdBtn = document.getElementById('vcmStepFwdBtn');
  const jumpStartBtn = document.getElementById('vcmJumpStartBtn');
  const jumpEndBtn = document.getElementById('vcmJumpEndBtn');
  const speedSelect = document.getElementById('vcmSpeedSelect');
  const muteBtn = document.getElementById('vcmMuteBtn');
  const volumeSlider = document.getElementById('vcmVolumeSlider');
  const previewVideo = document.getElementById('vcmPreviewVideo');

  if (closeBtn) closeBtn.addEventListener('click', closeVideoCropModal);
  if (cancelBtn) cancelBtn.addEventListener('click', closeVideoCropModal);
  if (resetAllBtn) {
    resetAllBtn.addEventListener('click', () => {
      vcmResetCrop();
      vcmState.trimStart = 0;
      vcmState.trimEnd = vcmState.duration;
      vcmUpdateTrimUI();
      if (previewVideo) previewVideo.currentTime = 0;
    });
  }
  if (confirmBtn) confirmBtn.addEventListener('click', confirmVideoCropAndTrim);

  // Aspect ratio presets
  document.querySelectorAll('[data-vcm-ratio]').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('[data-vcm-ratio]').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      initVcmCropBox(btn.dataset.vcmRatio);
    });
  });

  // Fit / Fill / Reset Crop / Zoom / Grid
  if (fitBtn) fitBtn.addEventListener('click', vcmFitCropBox);
  if (fillBtn) fillBtn.addEventListener('click', vcmFillCropBox);
  if (resetCropBtn) resetCropBtn.addEventListener('click', vcmResetCrop);
  if (zoomInBtn) zoomInBtn.addEventListener('click', () => applyVcmZoom(vcmState.zoom + 0.1));
  if (zoomOutBtn) zoomOutBtn.addEventListener('click', () => applyVcmZoom(vcmState.zoom - 0.1));
  if (gridToggleBtn && gridLines) {
    gridToggleBtn.addEventListener('click', () => {
      vcmState.gridVisible = !vcmState.gridVisible;
      gridLines.classList.toggle('vcm-grid-hidden', !vcmState.gridVisible);
      gridToggleBtn.classList.toggle('active', vcmState.gridVisible);
    });
  }

  // Mouse wheel zoom on stage area
  if (stageArea) {
    stageArea.addEventListener('wheel', (e) => {
      e.preventDefault();
      const delta = e.deltaY < 0 ? 0.05 : -0.05;
      applyVcmZoom(vcmState.zoom + delta);
    }, { passive: false });
  }

  // Crop Box pointer drag & resize
  if (cropBox) {
    cropBox.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      e.preventDefault();
      const handle = e.target.closest('[data-handle]');
      vcmState.dragMode = handle ? handle.dataset.handle : 'move';
      vcmState.startX = e.clientX;
      vcmState.startY = e.clientY;
      vcmState.startBox = { ...vcmState.box };
      cropBox.setPointerCapture(e.pointerId);
    });

    cropBox.addEventListener('pointermove', (e) => {
      if (!vcmState.dragMode || !vcmState.startBox) return;
      e.preventDefault();

      const { stageW, stageH, dragMode, startBox, activeRatio } = vcmState;
      const dx = e.clientX - vcmState.startX;
      const dy = e.clientY - vcmState.startY;
      const ratio = getVcmRatio(activeRatio);
      const minSize = 40;

      let nextX = startBox.x;
      let nextY = startBox.y;
      let nextW = startBox.w;
      let nextH = startBox.h;

      if (dragMode === 'move') {
        nextX = Math.max(0, Math.min(stageW - startBox.w, startBox.x + dx));
        nextY = Math.max(0, Math.min(stageH - startBox.h, startBox.y + dy));
      } else {
        if (dragMode.includes('e')) nextW = Math.max(minSize, Math.min(stageW - startBox.x, startBox.w + dx));
        if (dragMode.includes('s')) nextH = Math.max(minSize, Math.min(stageH - startBox.y, startBox.h + dy));
        if (dragMode.includes('w')) {
          const maxDx = startBox.w - minSize;
          const clampedDx = Math.max(-startBox.x, Math.min(maxDx, dx));
          nextX = startBox.x + clampedDx;
          nextW = startBox.w - clampedDx;
        }
        if (dragMode.includes('n')) {
          const maxDy = startBox.h - minSize;
          const clampedDy = Math.max(-startBox.y, Math.min(maxDy, dy));
          nextY = startBox.y + clampedDy;
          nextH = startBox.h - clampedDy;
        }

        if (ratio) {
          if (dragMode === 'e' || dragMode === 'w') {
            nextH = nextW / ratio;
            if (nextY + nextH > stageH) {
              nextH = stageH - nextY;
              nextW = nextH * ratio;
            }
          } else if (dragMode === 's' || dragMode === 'n') {
            nextW = nextH * ratio;
            if (nextX + nextW > stageW) {
              nextW = stageW - nextX;
              nextH = nextW / ratio;
            }
          } else if (dragMode === 'se' || dragMode === 'sw') {
            nextH = nextW / ratio;
            if (nextY + nextH > stageH) {
              nextH = stageH - nextY;
              nextW = nextH * ratio;
            }
          } else if (dragMode === 'ne' || dragMode === 'nw') {
            nextH = nextW / ratio;
            nextY = startBox.y + (startBox.h - nextH);
            if (nextY < 0) {
              nextY = 0;
              nextH = startBox.y + startBox.h;
              nextW = nextH * ratio;
            }
          }
        }
      }

      nextX = Math.max(0, Math.min(stageW - minSize, nextX));
      nextY = Math.max(0, Math.min(stageH - minSize, nextY));
      nextW = Math.max(minSize, Math.min(stageW - nextX, nextW));
      nextH = Math.max(minSize, Math.min(stageH - nextY, nextH));

      vcmState.box = { x: nextX, y: nextY, w: nextW, h: nextH };
      updateVcmCropBoxDom();
    });

    const endCropDrag = () => {
      vcmState.dragMode = null;
      vcmState.startBox = null;
    };
    cropBox.addEventListener('pointerup', endCropDrag);
    cropBox.addEventListener('pointercancel', endCropDrag);
  }

  // Timeline Trim Handle Dragging & Track Scrubbing
  const minTrimDuration = 1.0;
  const setTrimFromPointer = (clientX, targetType) => {
    if (!trackContainer) return;
    const rect = trackContainer.getBoundingClientRect();
    if (!rect.width) return;
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const timeAtPointer = ratio * vcmState.duration;

    if (targetType === 'start') {
      const maxStart = Math.max(0, vcmState.trimEnd - minTrimDuration);
      vcmState.trimStart = Math.max(0, Math.min(maxStart, timeAtPointer));
      vcmUpdateTrimUI();
      if (previewVideo) {
        previewVideo.currentTime = vcmState.trimStart;
        vcmUpdatePlayhead(vcmState.trimStart);
      }
    } else if (targetType === 'end') {
      const minEnd = Math.min(vcmState.duration, vcmState.trimStart + minTrimDuration);
      vcmState.trimEnd = Math.max(minEnd, Math.min(vcmState.duration, timeAtPointer));
      vcmUpdateTrimUI();
      if (previewVideo) {
        previewVideo.currentTime = vcmState.trimEnd;
        vcmUpdatePlayhead(vcmState.trimEnd);
      }
    } else if (targetType === 'scrub') {
      const clampedTime = Math.max(vcmState.trimStart, Math.min(vcmState.trimEnd, timeAtPointer));
      if (previewVideo) {
        previewVideo.currentTime = clampedTime;
        vcmUpdatePlayhead(clampedTime);
      }
    }
  };

  if (handleStart) {
    handleStart.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      e.preventDefault();
      vcmState.trimDragging = 'start';
      vcmState.selectedHandle = 'start';
      handleStart.classList.add('dragging');
      handleStart.setPointerCapture(e.pointerId);
    });
    handleStart.addEventListener('pointermove', (e) => {
      if (vcmState.trimDragging !== 'start') return;
      e.preventDefault();
      setTrimFromPointer(e.clientX, 'start');
    });
    const finishStart = () => {
      if (vcmState.trimDragging === 'start') {
        vcmState.trimDragging = null;
        handleStart.classList.remove('dragging');
      }
    };
    handleStart.addEventListener('pointerup', finishStart);
    handleStart.addEventListener('pointercancel', finishStart);
  }

  if (handleEnd) {
    handleEnd.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      e.preventDefault();
      vcmState.trimDragging = 'end';
      vcmState.selectedHandle = 'end';
      handleEnd.classList.add('dragging');
      handleEnd.setPointerCapture(e.pointerId);
    });
    handleEnd.addEventListener('pointermove', (e) => {
      if (vcmState.trimDragging !== 'end') return;
      e.preventDefault();
      setTrimFromPointer(e.clientX, 'end');
    });
    const finishEnd = () => {
      if (vcmState.trimDragging === 'end') {
        vcmState.trimDragging = null;
        handleEnd.classList.remove('dragging');
      }
    };
    handleEnd.addEventListener('pointerup', finishEnd);
    handleEnd.addEventListener('pointercancel', finishEnd);
  }

  if (trackContainer) {
    trackContainer.addEventListener('pointerdown', (e) => {
      if (e.target.closest('.vcm-trim-caliper')) return;
      vcmState.trimDragging = 'scrub';
      vcmState.selectedHandle = null;
      trackContainer.setPointerCapture(e.pointerId);
      setTrimFromPointer(e.clientX, 'scrub');
    });
    trackContainer.addEventListener('pointermove', (e) => {
      if (vcmState.trimDragging !== 'scrub') return;
      setTrimFromPointer(e.clientX, 'scrub');
    });
    const finishScrub = () => {
      if (vcmState.trimDragging === 'scrub') {
        vcmState.trimDragging = null;
      }
    };
    trackContainer.addEventListener('pointerup', finishScrub);
    trackContainer.addEventListener('pointercancel', finishScrub);
  }

  // Playback transport buttons
  if (playPauseBtn) playPauseBtn.addEventListener('click', vcmTogglePlay);
  if (stepBackBtn) stepBackBtn.addEventListener('click', () => vcmStepFrame(-1));
  if (stepFwdBtn) stepFwdBtn.addEventListener('click', () => vcmStepFrame(1));
  if (jumpStartBtn) jumpStartBtn.addEventListener('click', vcmJumpToStart);
  if (jumpEndBtn) jumpEndBtn.addEventListener('click', vcmJumpToEnd);
  if (resetTrimBtn) {
    resetTrimBtn.addEventListener('click', () => {
      vcmState.trimStart = 0;
      vcmState.trimEnd = vcmState.duration;
      vcmUpdateTrimUI();
      if (previewVideo) {
        previewVideo.currentTime = 0;
        vcmUpdatePlayhead(0);
      }
    });
  }

  // Speed and audio controls
  if (speedSelect) {
    speedSelect.addEventListener('change', (e) => {
      const rate = parseFloat(e.target.value) || 1;
      vcmState.playbackRate = rate;
      if (previewVideo) previewVideo.playbackRate = rate;
    });
  }

  if (muteBtn) {
    muteBtn.addEventListener('click', () => {
      vcmState.isMuted = !vcmState.isMuted;
      if (previewVideo) previewVideo.muted = vcmState.isMuted;
      muteBtn.textContent = vcmState.isMuted ? '🔇' : '🔊';
    });
  }

  if (volumeSlider) {
    volumeSlider.addEventListener('input', (e) => {
      const vol = parseFloat(e.target.value) || 0;
      vcmState.volume = vol;
      if (previewVideo) {
        previewVideo.volume = vol;
        if (vol > 0 && previewVideo.muted) {
          previewVideo.muted = false;
          vcmState.isMuted = false;
          if (muteBtn) muteBtn.textContent = '🔊';
        }
      }
    });
  }

  // Preview video playback loop constrained to [trimStart, trimEnd]
  if (previewVideo) {
    previewVideo.addEventListener('timeupdate', () => {
      const cur = previewVideo.currentTime;
      vcmUpdatePlayhead(cur);

      if (cur < vcmState.trimStart) {
        previewVideo.currentTime = vcmState.trimStart;
      } else if (cur >= vcmState.trimEnd) {
        previewVideo.currentTime = vcmState.trimStart;
      }
    });

    previewVideo.addEventListener('play', () => {
      const icon = document.getElementById('vcmPlayMasterIcon');
      if (icon) icon.textContent = '⏸';
    });

    previewVideo.addEventListener('pause', () => {
      const icon = document.getElementById('vcmPlayMasterIcon');
      if (icon) icon.textContent = '▶';
    });
  }

  // Keyboard navigation & fine frame adjustments
  document.addEventListener('keydown', (e) => {
    if (!modal || modal.classList.contains('hidden')) return;

    if (e.key === 'Escape') {
      closeVideoCropModal();
      return;
    }

    if (e.key === ' ' || e.code === 'Space') {
      if (e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') {
        e.preventDefault();
        vcmTogglePlay();
      }
      return;
    }

    if (e.key === 'Home') {
      e.preventDefault();
      vcmJumpToStart();
      return;
    }

    if (e.key === 'End') {
      e.preventDefault();
      vcmJumpToEnd();
      return;
    }

    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      const direction = e.key === 'ArrowLeft' ? -1 : 1;
      const step = e.shiftKey ? 0.5 : (1 / 30); // 0.5s jump with Shift, or 1 frame

      if (vcmState.selectedHandle === 'start') {
        const nextStart = Math.max(0, Math.min(vcmState.trimEnd - minTrimDuration, vcmState.trimStart + (direction * step)));
        vcmState.trimStart = nextStart;
        vcmUpdateTrimUI();
        if (previewVideo) {
          previewVideo.currentTime = nextStart;
          vcmUpdatePlayhead(nextStart);
        }
      } else if (vcmState.selectedHandle === 'end') {
        const nextEnd = Math.max(vcmState.trimStart + minTrimDuration, Math.min(vcmState.duration, vcmState.trimEnd + (direction * step)));
        vcmState.trimEnd = nextEnd;
        vcmUpdateTrimUI();
        if (previewVideo) {
          previewVideo.currentTime = nextEnd;
          vcmUpdatePlayhead(nextEnd);
        }
      } else {
        if (previewVideo) {
          const nextCur = Math.max(vcmState.trimStart, Math.min(vcmState.trimEnd, previewVideo.currentTime + (direction * step)));
          previewVideo.currentTime = nextCur;
          vcmUpdatePlayhead(nextCur);
        }
      }
    }
  });

  // Modal backdrop click to close
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeVideoCropModal();
  });
}

// =====================================================
// DEDICATED IMAGE CROP MODAL
// =====================================================
function openCropModal(mediaElement, mode = 'image') {
  const modal = document.getElementById('imageCropModal');
  const targetImg = document.getElementById('cropTargetImage');
  const cropStage = document.getElementById('cropStage');
  const titleEl = document.getElementById('cropModalTitle');
  const subtitleEl = document.querySelector('.crop-modal-subtitle');
  const confirmBtn = document.getElementById('confirmCropBtn');
  if (!modal || !cropStage) return;

  cropModalState.mode = 'image';

  document.querySelectorAll('.crop-ratio-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.ratio === 'card');
  });
  cropModalState.activeRatio = 'card';

  const imgToUse = mediaElement || state.newsImage;
  if (!imgToUse || !imgToUse.src) {
    setStatus('Please upload an image first.');
    return;
  }

  if (titleEl) titleEl.textContent = '✂️ Crop Card Image';
  if (subtitleEl) subtitleEl.textContent = 'Drag box to reposition · Drag corner or edge handles to resize';
  if (confirmBtn) confirmBtn.textContent = 'Confirm Crop';

  if (targetImg) {
    targetImg.classList.remove('hidden');
    targetImg.src = imgToUse.src;
  }

  cropModalState.image = imgToUse;
  cropModalState.video = null;
  cropModalState.rawWidth = imgToUse.naturalWidth || imgToUse.width || 1080;
  cropModalState.rawHeight = imgToUse.naturalHeight || imgToUse.height || 720;

  modal.classList.remove('hidden');
  modal.setAttribute('aria-hidden', 'false');

  const onImageReady = () => {
    requestAnimationFrame(() => {
      const stageW = targetImg.clientWidth || targetImg.naturalWidth;
      const stageH = targetImg.clientHeight || targetImg.naturalHeight;
      cropModalState.stageW = stageW;
      cropModalState.stageH = stageH;
      cropStage.style.width = `${stageW}px`;
      cropStage.style.height = `${stageH}px`;
      initCropBoxForCurrentRatio();
    });
  };

  if (targetImg.complete && targetImg.naturalWidth > 0) {
    onImageReady();
  } else {
    targetImg.onload = onImageReady;
  }
}

function closeCropModal() {
  const modal = document.getElementById('imageCropModal');
  if (modal) {
    modal.classList.add('hidden');
    modal.setAttribute('aria-hidden', 'true');
  }
  cropModalState.dragMode = null;
  cropModalState.startBox = null;
  if (elements.imageUpload) {
    elements.imageUpload.value = '';
  }
}

async function confirmCropSelection() {
  const { image, box, stageW, stageH, rawWidth, rawHeight } = cropModalState;
  if (!stageW || !stageH || box.w <= 0 || box.h <= 0 || !image) {
    closeCropModal();
    return;
  }

  const scaleX = rawWidth / stageW;
  const scaleY = rawHeight / stageH;

  const sourceX = Math.max(0, Math.min(rawWidth - 1, Math.round(box.x * scaleX)));
  const sourceY = Math.max(0, Math.min(rawHeight - 1, Math.round(box.y * scaleY)));
  const sourceW = Math.max(10, Math.min(rawWidth - sourceX, Math.round(box.w * scaleX)));
  const sourceH = Math.max(10, Math.min(rawHeight - sourceY, Math.round(box.h * scaleY)));

  const offscreenCanvas = document.createElement('canvas');
  offscreenCanvas.width = sourceW;
  offscreenCanvas.height = sourceH;
  const offCtx = offscreenCanvas.getContext('2d');
  offCtx.imageSmoothingEnabled = true;
  offCtx.imageSmoothingQuality = 'high';

  offCtx.drawImage(
    image,
    sourceX,
    sourceY,
    sourceW,
    sourceH,
    0,
    0,
    sourceW,
    sourceH
  );

  const croppedDataUrl = offscreenCanvas.toDataURL('image/jpeg', 0.95);

  try {
    const croppedImage = await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Cropped image failed to load'));
      img.src = croppedDataUrl;
    });

    state.newsImage = croppedImage;
    state.imageData = croppedDataUrl;
    state.crop = { zoom: 1, x: 50, y: 50 };
    syncDisplayValues();
    await updatePreview();
    closeCropModal();
    setStatus('Image cropped and applied successfully!');
  } catch (err) {
    console.error('Failed applying cropped image:', err);
    closeCropModal();
    setStatus('Error applying cropped image.');
  }
}

function setupCropModalHandlers() {
  const modal = document.getElementById('imageCropModal');
  const cropBox = document.getElementById('cropBox');
  const stageContainer = document.getElementById('cropStageContainer');
  const closeBtn = document.getElementById('closeCropModal');
  const cancelBtn = document.getElementById('cancelCropBtn');
  const confirmBtn = document.getElementById('confirmCropBtn');
  const resetBtn = document.getElementById('resetCropBoxBtn');
  const openBtn = document.getElementById('openCropModalBtn');

  if (openBtn) {
    openBtn.addEventListener('click', () => {
      if (state.newsImage || state.imageData) {
        openCropModal(state.newsImage, 'image');
      } else {
        elements.imageUpload?.click();
      }
    });
  }

  if (closeBtn) closeBtn.addEventListener('click', closeCropModal);
  if (cancelBtn) cancelBtn.addEventListener('click', closeCropModal);
  if (confirmBtn) confirmBtn.addEventListener('click', confirmCropSelection);
  if (resetBtn) resetBtn.addEventListener('click', initCropBoxForCurrentRatio);

  if (modal) {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeCropModal();
    });
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modal && !modal.classList.contains('hidden')) {
      closeCropModal();
    }
  });

  // Mouse wheel / trackpad zoom on crop stage (zoom in/out crop box)
  if (stageContainer) {
    stageContainer.addEventListener('wheel', (e) => {
      e.preventDefault();
      const { box, stageW, stageH, activeRatio } = cropModalState;
      if (!stageW || !stageH || !box.w) return;
      const ratio = getCropRatioValue(activeRatio);
      const zoomFactor = e.deltaY < 0 ? 0.95 : 1.05;
      let newW = box.w * zoomFactor;
      let newH = ratio ? newW / ratio : box.h * zoomFactor;

      if (newW < 48 || newH < 32 || newW > stageW || newH > stageH) return;

      let newX = box.x - (newW - box.w) * 0.5;
      let newY = box.y - (newH - box.h) * 0.5;

      newX = Math.max(0, Math.min(stageW - newW, newX));
      newY = Math.max(0, Math.min(stageH - newH, newY));

      cropModalState.box = { x: newX, y: newY, w: newW, h: newH };
      updateCropBoxDom();
    }, { passive: false });

    // Touch pinch-to-zoom on mobile/touchscreen
    let initialTouchDist = null;
    let initialTouchBox = null;

    stageContainer.addEventListener('touchstart', (e) => {
      if (e.touches.length === 2) {
        initialTouchDist = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY
        );
        initialTouchBox = { ...cropModalState.box };
      }
    });

    stageContainer.addEventListener('touchmove', (e) => {
      if (e.touches.length === 2 && initialTouchDist && initialTouchBox) {
        const curDist = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY
        );
        const factor = initialTouchDist / curDist;
        const { stageW, stageH, activeRatio } = cropModalState;
        const ratio = getCropRatioValue(activeRatio);

        let newW = initialTouchBox.w * factor;
        let newH = ratio ? newW / ratio : initialTouchBox.h * factor;

        if (newW >= 48 && newH >= 32 && newW <= stageW && newH <= stageH) {
          let newX = initialTouchBox.x - (newW - initialTouchBox.w) * 0.5;
          let newY = initialTouchBox.y - (newH - initialTouchBox.h) * 0.5;
          newX = Math.max(0, Math.min(stageW - newW, newX));
          newY = Math.max(0, Math.min(stageH - newH, newY));
          cropModalState.box = { x: newX, y: newY, w: newW, h: newH };
          updateCropBoxDom();
        }
      }
    });

    stageContainer.addEventListener('touchend', () => {
      initialTouchDist = null;
      initialTouchBox = null;
    });
  }

  // Aspect ratio presets
  document.querySelectorAll('.crop-ratio-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.crop-ratio-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      adjustCropBoxToRatio(btn.dataset.ratio);
    });
  });

  // Pointer drag & resize handling
  if (cropBox) {
    cropBox.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      e.preventDefault();
      const handle = e.target.closest('[data-handle]');
      cropModalState.dragMode = handle ? handle.dataset.handle : 'move';
      cropModalState.startX = e.clientX;
      cropModalState.startY = e.clientY;
      cropModalState.startBox = { ...cropModalState.box };

      cropBox.setPointerCapture(e.pointerId);
    });

    cropBox.addEventListener('pointermove', (e) => {
      if (!cropModalState.dragMode || !cropModalState.startBox) return;
      e.preventDefault();

      const { stageW, stageH, dragMode, startBox, activeRatio } = cropModalState;
      const dx = e.clientX - cropModalState.startX;
      const dy = e.clientY - cropModalState.startY;
      const ratio = getCropRatioValue(activeRatio);
      const minSize = 36;

      let nextX = startBox.x;
      let nextY = startBox.y;
      let nextW = startBox.w;
      let nextH = startBox.h;

      if (dragMode === 'move') {
        nextX = Math.max(0, Math.min(stageW - startBox.w, startBox.x + dx));
        nextY = Math.max(0, Math.min(stageH - startBox.h, startBox.y + dy));
      } else {
        // Resizing
        if (dragMode.includes('e')) {
          nextW = Math.max(minSize, Math.min(stageW - startBox.x, startBox.w + dx));
        }
        if (dragMode.includes('s')) {
          nextH = Math.max(minSize, Math.min(stageH - startBox.y, startBox.h + dy));
        }
        if (dragMode.includes('w')) {
          const maxDx = startBox.w - minSize;
          const clampedDx = Math.max(-startBox.x, Math.min(maxDx, dx));
          nextX = startBox.x + clampedDx;
          nextW = startBox.w - clampedDx;
        }
        if (dragMode.includes('n')) {
          const maxDy = startBox.h - minSize;
          const clampedDy = Math.max(-startBox.y, Math.min(maxDy, dy));
          nextY = startBox.y + clampedDy;
          nextH = startBox.h - clampedDy;
        }

        // Apply aspect ratio lock if active
        if (ratio) {
          if (dragMode === 'e' || dragMode === 'w') {
            nextH = nextW / ratio;
            if (nextY + nextH > stageH) {
              nextH = stageH - nextY;
              nextW = nextH * ratio;
            }
          } else if (dragMode === 's' || dragMode === 'n') {
            nextW = nextH * ratio;
            if (nextX + nextW > stageW) {
              nextW = stageW - nextX;
              nextH = nextW / ratio;
            }
          } else if (dragMode === 'se') {
            nextH = nextW / ratio;
            if (nextY + nextH > stageH) {
              nextH = stageH - nextY;
              nextW = nextH * ratio;
            }
          } else if (dragMode === 'sw') {
            nextH = nextW / ratio;
            if (nextY + nextH > stageH) {
              nextH = stageH - nextY;
              nextW = nextH * ratio;
            }
          } else if (dragMode === 'ne') {
            nextH = nextW / ratio;
            nextY = startBox.y + (startBox.h - nextH);
            if (nextY < 0) {
              nextY = 0;
              nextH = startBox.y + startBox.h;
              nextW = nextH * ratio;
            }
          } else if (dragMode === 'nw') {
            nextH = nextW / ratio;
            nextY = startBox.y + (startBox.h - nextH);
            if (nextY < 0) {
              nextY = 0;
              nextH = startBox.y + startBox.h;
              nextW = nextH * ratio;
              nextX = startBox.x + (startBox.w - nextW);
            }
          }
        }
      }

      // Clamping within stage boundaries
      nextX = Math.max(0, Math.min(stageW - minSize, nextX));
      nextY = Math.max(0, Math.min(stageH - minSize, nextY));
      nextW = Math.max(minSize, Math.min(stageW - nextX, nextW));
      nextH = Math.max(minSize, Math.min(stageH - nextY, nextH));

      cropModalState.box = { x: nextX, y: nextY, w: nextW, h: nextH };
      updateCropBoxDom();
    });

    const finishDrag = () => {
      cropModalState.dragMode = null;
      cropModalState.startBox = null;
    };

    cropBox.addEventListener('pointerup', finishDrag);
    cropBox.addEventListener('pointercancel', finishDrag);
  }

  // Handle window resizing
  window.addEventListener('resize', () => {
    const modal = document.getElementById('imageCropModal');
    const targetImg = document.getElementById('cropTargetImage');
    const cropStage = document.getElementById('cropStage');
    if (!modal || modal.classList.contains('hidden') || !targetImg || !cropStage) return;

    requestAnimationFrame(() => {
      const stageW = targetImg.clientWidth || targetImg.naturalWidth;
      const stageH = targetImg.clientHeight || targetImg.naturalHeight;
      if (stageW && stageH) {
        cropModalState.stageW = stageW;
        cropModalState.stageH = stageH;
        cropStage.style.width = `${stageW}px`;
        cropStage.style.height = `${stageH}px`;
        initCropBoxForCurrentRatio();
      }
    });
  });
}

// =====================================================
// DIRECT TOUCH & MOUSE PREVIEW MANIPULATION
// Natural gestures on the live preview card:
// - Drag/pan image horizontally & vertically (mouse / touch)
// - Mouse wheel & pinchpad zoom on desktop
// - 2-finger pinch-to-zoom on touchscreen/mobile
// - Strictly bounded within card image area (clamped 0..100)
// - Synchronized with range sliders & live preview
// =====================================================
function setupCanvasTouchZone() {
  const touchZone = document.getElementById('canvasImageTouchZone');
  if (!touchZone) return;

  let isInteracting = false;
  let startX = 0;
  let startY = 0;
  let startCropX = 50;
  let startCropY = 50;
  let initialPinchDist = null;
  let initialPinchZoom = 1;
  const activePointers = new Map();

  touchZone.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    if (!state.imageData && !state.newsImage) return;

    touchZone.setPointerCapture(e.pointerId);
    activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (activePointers.size === 1) {
      isInteracting = true;
      touchZone.classList.add('active-drag');
      startX = e.clientX;
      startY = e.clientY;
      startCropX = state.crop.x !== undefined ? state.crop.x : 50;
      startCropY = state.crop.y !== undefined ? state.crop.y : 50;
    } else if (activePointers.size === 2) {
      const points = Array.from(activePointers.values());
      initialPinchDist = Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
      initialPinchZoom = state.crop.zoom || 1;
    }
  });

  touchZone.addEventListener('pointermove', (e) => {
    if (!activePointers.has(e.pointerId)) return;
    activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (activePointers.size === 2 && initialPinchDist && initialPinchDist > 0) {
      // 2-finger pinch zoom
      const points = Array.from(activePointers.values());
      const currentDist = Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
      const scaleFactor = currentDist / initialPinchDist;
      const newZoom = Math.max(1, Math.min(3, initialPinchZoom * scaleFactor));
      state.crop.zoom = Math.round(newZoom * 100) / 100;
      if (elements.cropZoom) elements.cropZoom.value = state.crop.zoom;
      updatePreview();
    } else if (isInteracting && activePointers.size === 1) {
      // 1-pointer / mouse pan
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      const rect = touchZone.getBoundingClientRect();

      // Dragging right moves image right, revealing left content (decreases cropX)
      const sensitivity = 1.3;
      const deltaPercentX = -(dx / rect.width) * 100 * sensitivity;
      const deltaPercentY = -(dy / rect.height) * 100 * sensitivity;

      const nextCropX = Math.max(0, Math.min(100, Math.round(startCropX + deltaPercentX)));
      const nextCropY = Math.max(0, Math.min(100, Math.round(startCropY + deltaPercentY)));

      if (nextCropX !== state.crop.x || nextCropY !== state.crop.y) {
        state.crop.x = nextCropX;
        state.crop.y = nextCropY;
        if (elements.cropX) elements.cropX.value = state.crop.x;
        if (elements.cropY) elements.cropY.value = state.crop.y;
        updatePreview();
      }
    }
  });

  const endInteraction = (e) => {
    activePointers.delete(e.pointerId);
    if (activePointers.size === 0) {
      isInteracting = false;
      touchZone.classList.remove('active-drag');
      initialPinchDist = null;
    } else if (activePointers.size === 1) {
      const remaining = Array.from(activePointers.values())[0];
      startX = remaining.x;
      startY = remaining.y;
      startCropX = state.crop.x;
      startCropY = state.crop.y;
      initialPinchDist = null;
    }
  };

  touchZone.addEventListener('pointerup', endInteraction);
  touchZone.addEventListener('pointercancel', endInteraction);

  // Mouse wheel / trackpad pinch zoom on preview
  touchZone.addEventListener('wheel', (e) => {
    if (!state.imageData && !state.newsImage) return;
    e.preventDefault();
    const currentZoom = state.crop.zoom || 1;
    const zoomStep = e.deltaY < 0 ? 0.08 : -0.08;
    const nextZoom = Math.max(1, Math.min(3, Math.round((currentZoom + zoomStep) * 100) / 100));

    if (nextZoom !== currentZoom) {
      state.crop.zoom = nextZoom;
      if (elements.cropZoom) elements.cropZoom.value = state.crop.zoom;
      updatePreview();
    }
  }, { passive: false });
}

// ==========================================
// VIDEO UPLOAD & CONTROLS CONTROLLER
// Handles MP4 / WebM / MOV / OGG video selection, MIME and magic number validation,
// preview in 9:16 card, play/pause, sound toggle, and MP4 export.
// ==========================================
async function validateVideoFile(file) {
  if (!file) {
    return { valid: false, message: 'No file selected.' };
  }

  // 1. Extension check
  const fileName = (file.name || '').toLowerCase();
  const validExtensions = ['.mp4', '.webm', '.mov', '.ogv', '.ogg', '.m4v'];
  const hasValidExt = validExtensions.some(ext => fileName.endsWith(ext));

  // 2. MIME type check
  const validMimes = [
    'video/mp4',
    'video/webm',
    'video/quicktime',
    'video/ogg',
    'video/x-m4v',
    'video/x-matroska'
  ];
  const mimeType = (file.type || '').toLowerCase();
  const hasValidMime = validMimes.includes(mimeType) || mimeType.startsWith('video/');

  if (!hasValidExt && !hasValidMime) {
    return {
      valid: false,
      message: 'Unsupported format. Please select an MP4, WebM, MOV, or OGG video.'
    };
  }

  // 3. Deep Magic Number (binary signature) check to prevent spoofed/unsafe files
  try {
    const slice = file.slice(0, 64);
    const buffer = await slice.arrayBuffer();
    const bytes = new Uint8Array(buffer);

    const checkAscii = (target) => {
      const len = target.length;
      for (let i = 0; i <= bytes.length - len; i++) {
        let match = true;
        for (let j = 0; j < len; j++) {
          if (bytes[i + j] !== target.charCodeAt(j)) {
            match = false;
            break;
          }
        }
        if (match) return true;
      }
      return false;
    };

    // MP4 / MOV / M4V: contains 'ftyp', 'moov', 'mdat', 'wide', or 'free'
    const isMp4OrMov = checkAscii('ftyp') || checkAscii('moov') || checkAscii('mdat') || checkAscii('wide') || checkAscii('free');

    // WebM / MKV: starts with EBML ID 0x1A 0x45 0xDF 0xA3 or contains 'webm'
    const isWebM = (bytes[0] === 0x1A && bytes[1] === 0x45 && bytes[2] === 0xDF && bytes[3] === 0xA3) || checkAscii('webm');

    // Ogg: starts with 'OggS'
    const isOgg = bytes.length >= 4 && bytes[0] === 0x4F && bytes[1] === 0x67 && bytes[2] === 0x67 && bytes[3] === 0x53;

    if (!isMp4OrMov && !isWebM && !isOgg) {
      return {
        valid: false,
        message: 'File content does not match a valid video stream (MP4, WebM, MOV, OGG). File rejected for security.'
      };
    }
  } catch (err) {
    console.warn('Binary signature inspection skipped:', err);
  }

  return { valid: true };
}

function applyVideoCropToPreview() {
  const videoEl = elements.cardPreviewVideo;
  if (!videoEl) return;

  if (!state.videoCrop || !state.videoCrop.w || !state.videoCrop.h) {
    videoEl.style.width = '100%';
    videoEl.style.height = '100%';
    videoEl.style.left = '0%';
    videoEl.style.top = '0%';
    videoEl.style.maxWidth = '100%';
    videoEl.style.maxHeight = '100%';
    videoEl.style.objectFit = 'cover';
    return;
  }

  const { x, y, w, h, rawW, rawH } = state.videoCrop;
  const scaleX = rawW / w;
  const scaleY = rawH / h;

  videoEl.style.position = 'absolute';
  videoEl.style.maxWidth = 'none';
  videoEl.style.maxHeight = 'none';
  videoEl.style.width = `${scaleX * 100}%`;
  videoEl.style.height = `${scaleY * 100}%`;
  videoEl.style.left = `${-(x / rawW) * scaleX * 100}%`;
  videoEl.style.top = `${-(y / rawH) * scaleY * 100}%`;
  videoEl.style.objectFit = 'fill';
}

function cleanupVideo() {
  if (elements.cardPreviewVideo) {
    elements.cardPreviewVideo.pause();
    elements.cardPreviewVideo.removeAttribute('src');
    elements.cardPreviewVideo.load();
  }
  if (state.videoUrl) {
    try { URL.revokeObjectURL(state.videoUrl); } catch (e) {}
    state.videoUrl = '';
  }
  state.videoFile = null;
  state.videoPlaying = false;
  state.videoDuration = 0;
  state.videoCrop = null;
  state.videoTrim = { start: 0, end: 0 };
  applyVideoCropToPreview();
}

function updateMediaModeUI() {
  const isVideo = state.mediaType === 'video';

  if (elements.activeMediaBadge) {
    elements.activeMediaBadge.textContent = isVideo ? 'Video Mode' : 'Photo Mode';
    elements.activeMediaBadge.classList.toggle('video', isVideo);
  }

  // Live preview video container
  if (elements.canvasVideoWrapper) {
    elements.canvasVideoWrapper.classList.toggle('hidden', !isVideo);
  }
  const touchZone = document.getElementById('canvasImageTouchZone');
  if (touchZone) {
    touchZone.style.display = isVideo ? 'none' : 'flex';
  }

  // Photo & Crop panel controls
  if (elements.videoControlsRow) {
    elements.videoControlsRow.classList.toggle('hidden', !isVideo);
  }
  if (elements.imageCropControls) {
    elements.imageCropControls.classList.toggle('hidden', isVideo);
  }
  if (elements.imageActionButtons) {
    elements.imageActionButtons.classList.toggle('hidden', isVideo);
  }

  // Download section: hide PNG/JPG when video is active, show Download Video
  if (elements.imageDownloadGrid) {
    elements.imageDownloadGrid.classList.toggle('hidden', isVideo);
  }
  if (elements.videoDownloadGrid) {
    elements.videoDownloadGrid.classList.toggle('hidden', !isVideo);
  }
}

async function handleImageUpload(event) {
  const [file] = event.target.files || [];
  if (!file) return;

  try {
    // If switching from video mode, clean up video
    if (state.mediaType === 'video') {
      cleanupVideo();
      if (elements.videoUpload) elements.videoUpload.value = '';
    }
    state.mediaType = 'image';
    updateMediaModeUI();

    const image = await loadFileAsImage(file);
    state.newsImage = image;
    state.imageData = image.src;
    state.crop = { zoom: 1, x: 50, y: 50 };
    syncDisplayValues();
    await updatePreview();

    // Immediately open the dedicated crop editor modal!
    openCropModal(image, 'image');
  } catch (error) {
    console.error('BTV IMAGE UPLOAD ERROR:', error);
    setStatus('Unable to load the selected image.');
  }
}

async function handleVideoUpload(event) {
  const [file] = event.target.files || [];
  if (!file) return;

  const validation = await validateVideoFile(file);
  if (!validation.valid) {
    setStatus(validation.message);
    if (elements.videoUpload) elements.videoUpload.value = '';
    return;
  }

  try {
    cleanupVideo();

    state.mediaType = 'video';
    state.videoFile = file;
    state.videoUrl = URL.createObjectURL(file);
    state.videoCrop = null;
    state.videoTrim = { start: 0, end: 0 };

    const videoEl = elements.cardPreviewVideo;
    if (!videoEl) return;

    videoEl.src = state.videoUrl;
    videoEl.muted = true;
    videoEl.loop = true;
    videoEl.playsInline = true;

    if (elements.videoFileName) {
      elements.videoFileName.textContent = `🎬 ${file.name}`;
      elements.videoFileName.setAttribute('title', file.name);
    }

    videoEl.onloadedmetadata = () => {
      state.videoDuration = videoEl.duration || 0;
      state.videoTrim = { start: 0, end: state.videoDuration };
      if (elements.videoDurationLabel) {
        elements.videoDurationLabel.textContent = formatTrimTime(state.videoDuration);
      }
      applyVideoCropToPreview();
      updatePreview();
      // Immediately open the professional video Crop & Trim studio!
      openVideoCropModal();
    };

    updateMediaModeUI();

    // Start playback (muted so browser autoplay policy permits it)
    try {
      await videoEl.play();
      state.videoPlaying = true;
      if (elements.videoTogglePlayBtn) elements.videoTogglePlayBtn.textContent = '⏸ Pause Video';
      if (elements.cardVideoPlayToggle) elements.cardVideoPlayToggle.classList.add('hidden');
    } catch (playErr) {
      console.warn('Autoplay notice:', playErr);
      state.videoPlaying = false;
      if (elements.videoTogglePlayBtn) elements.videoTogglePlayBtn.textContent = '▶ Play Video';
      if (elements.cardVideoPlayToggle) elements.cardVideoPlayToggle.classList.remove('hidden');
    }

    setStatus('Video uploaded successfully. Opening Crop & Trim Studio.');
    updatePreview();
  } catch (error) {
    console.error('Video upload error:', error);
    setStatus('Failed to load video file: ' + error.message);
  }
}

function toggleVideoPlayPause() {
  const videoEl = elements.cardPreviewVideo;
  if (!videoEl || !videoEl.src) return;

  if (videoEl.paused) {
    if (state.videoTrim && state.videoTrim.end > state.videoTrim.start) {
      if (videoEl.currentTime < state.videoTrim.start || videoEl.currentTime >= state.videoTrim.end) {
        videoEl.currentTime = state.videoTrim.start;
      }
    }
    videoEl.play().then(() => {
      state.videoPlaying = true;
      if (elements.videoTogglePlayBtn) elements.videoTogglePlayBtn.textContent = '⏸ Pause Video';
      if (elements.cardVideoPlayToggle) elements.cardVideoPlayToggle.classList.add('hidden');
    }).catch((err) => {
      console.warn('Video play error:', err);
    });
  } else {
    videoEl.pause();
    state.videoPlaying = false;
    if (elements.videoTogglePlayBtn) elements.videoTogglePlayBtn.textContent = '▶ Play Video';
    if (elements.cardVideoPlayToggle) elements.cardVideoPlayToggle.classList.remove('hidden');
  }
}

function toggleVideoMute() {
  const videoEl = elements.cardPreviewVideo;
  if (!videoEl) return;

  videoEl.muted = !videoEl.muted;
  state.videoMuted = videoEl.muted;
  if (elements.videoMuteToggleBtn) {
    elements.videoMuteToggleBtn.textContent = videoEl.muted ? '🔇 Sound: Off' : '🔊 Sound: On';
  }
}

function removeVideo() {
  cleanupVideo();
  state.mediaType = 'image';
  if (elements.videoUpload) elements.videoUpload.value = '';
  updateMediaModeUI();
  updatePreview();
  setStatus('Video removed. Switched back to Photo Mode.');
}

// ==========================================
// EXPORT CARD AS PLAYABLE MP4 VIDEO
// Renders the complete 9:16 card (header, title,
// description, reporter details, footer, and playing video)
// and exports it as a high-quality playable MP4 video.
// ==========================================
async function exportCardAsVideo() {
  const validationError = validateFormData();
  if (validationError) {
    setStatus(validationError);
    return;
  }

  const video = elements.cardPreviewVideo;
  if (!video || !video.src) {
    setStatus('No video loaded. Please upload a video first.');
    return;
  }

  const progressWrap = elements.videoExportProgressWrap;
  const progressBar = elements.videoExportBarFill;
  const progressStatus = elements.videoExportStatus;
  const downloadBtn = elements.downloadVideoBtn;

  if (downloadBtn) downloadBtn.disabled = true;
  if (progressWrap) progressWrap.classList.remove('hidden');
  if (progressBar) progressBar.style.width = '0%';
  if (progressStatus) progressStatus.textContent = 'Preparing 9:16 video card export...';

  try {
    // 1. Offscreen 1080 x 1920 canvas for video recording
    const exportCanvas = document.createElement('canvas');
    exportCanvas.width = 1080;
    exportCanvas.height = 1920;
    const exportCtx = exportCanvas.getContext('2d');

    // 2. Pre-render static card template (Everything except video media)
    const templateCanvas = document.createElement('canvas');
    templateCanvas.width = 1080;
    templateCanvas.height = 1920;
    await renderCard({
      targetCanvas: templateCanvas,
      cardData: state,
      skipMediaDrawing: true
    });

    const resolvedTheme = resolveThemeConfig(state);

    // 3. Determine export duration from trim settings
    let trimStart = 0;
    let trimEnd = video.duration || 5;
    if (state.videoTrim && state.videoTrim.end > state.videoTrim.start) {
      trimStart = state.videoTrim.start;
      trimEnd = Math.min(video.duration || 60, state.videoTrim.end);
    }
    const targetDuration = Math.max(1, trimEnd - trimStart);

    // 4. Capture canvas stream at 30fps
    const stream = exportCanvas.captureStream(30);

    // 5. Try capturing audio from source video if present
    try {
      const videoStream = video.captureStream ? video.captureStream() : (video.mozCaptureStream ? video.mozCaptureStream() : null);
      if (videoStream) {
        const audioTracks = videoStream.getAudioTracks();
        if (audioTracks && audioTracks.length > 0) {
          stream.addTrack(audioTracks[0]);
        }
      }
    } catch (audioErr) {
      console.warn('Audio stream capture notice:', audioErr);
    }

    // 6. MediaRecorder options - prioritize MP4 container
    const candidateMimes = [
      'video/mp4;codecs=avc1,mp4a.40.2',
      'video/mp4;codecs=avc1',
      'video/mp4;codecs=h264',
      'video/mp4',
      'video/webm;codecs=h264',
      'video/webm;codecs=vp9',
      'video/webm'
    ];

    let chosenMime = '';
    for (const mime of candidateMimes) {
      if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(mime)) {
        chosenMime = mime;
        break;
      }
    }

    const recorderOptions = chosenMime
      ? { mimeType: chosenMime, videoBitsPerSecond: 8000000 }
      : { videoBitsPerSecond: 8000000 };

    const recorder = new MediaRecorder(stream, recorderOptions);
    const chunks = [];
    recorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) {
        chunks.push(event.data);
      }
    };

    // Helper to draw a single 9:16 frame onto exportCanvas
    const drawExportFrame = () => {
      exportCtx.drawImage(templateCanvas, 0, 0);

      const imageX = 70;
      const imageY = 216;
      const imageW = 940;
      const imageH = 410;

      exportCtx.save();
      roundRect(exportCtx, imageX, imageY, imageW, imageH, 26);
      exportCtx.clip();

      if (state.videoCrop && state.videoCrop.w > 0 && state.videoCrop.h > 0) {
        exportCtx.drawImage(
          video,
          state.videoCrop.x,
          state.videoCrop.y,
          state.videoCrop.w,
          state.videoCrop.h,
          imageX,
          imageY,
          imageW,
          imageH
        );
      } else {
        const vW = video.videoWidth || 1920;
        const vH = video.videoHeight || 1080;
        const coverScale = Math.max(imageW / vW, imageH / vH);
        const drawW = vW * coverScale;
        const drawH = vH * coverScale;
        const offsetX = (imageW - drawW) / 2;
        const offsetY = (imageH - drawH) / 2;
        exportCtx.drawImage(video, imageX + offsetX, imageY + offsetY, drawW, drawH);
      }
      exportCtx.restore();

      exportCtx.strokeStyle = resolvedTheme.imageBorder;
      exportCtx.lineWidth = 2;
      roundRect(exportCtx, imageX, imageY, imageW, imageH, 26);
      exportCtx.stroke();
    };

    // Draw initial frame
    drawExportFrame();

    // 7. Execute recording
    await new Promise((resolve, reject) => {
      let isRecording = true;
      let animId = null;

      const finish = () => {
        if (!isRecording) return;
        isRecording = false;
        if (animId) cancelAnimationFrame(animId);
        if (progressBar) progressBar.style.width = '100%';
        if (progressStatus) progressStatus.textContent = 'Generating MP4 file... 100%';

        recorder.onstop = () => {
          try {
            const finalType = (chosenMime && chosenMime.includes('mp4')) ? 'video/mp4' : (chosenMime || 'video/mp4');
            const blob = new Blob(chunks, { type: finalType });
            downloadBlob(blob, 'btv-news-card.mp4');
            setStatus('Playable 9:16 MP4 video downloaded successfully.');
            resolve();
          } catch (e) {
            reject(e);
          }
        };

        try {
          recorder.stop();
        } catch (e) {
          resolve();
        }
      };

      video.pause();
      video.currentTime = trimStart;

      const startRecording = () => {
        try {
          recorder.start(100);
        } catch (err) {
          reject(err);
          return;
        }

        video.play().catch((e) => console.warn('Video play warning during export:', e));

        const loop = () => {
          if (!isRecording) return;

          drawExportFrame();

          const elapsed = Math.max(0, video.currentTime - trimStart);
          const progress = Math.min(99, Math.round((elapsed / targetDuration) * 100));
          if (progressBar) progressBar.style.width = `${progress}%`;
          if (progressStatus) progressStatus.textContent = `Exporting MP4 video... ${progress}%`;

          if (video.currentTime >= trimEnd || video.ended) {
            finish();
          } else {
            animId = requestAnimationFrame(loop);
          }
        };

        animId = requestAnimationFrame(loop);
      };

      // Listen for seeked to trimStart before starting
      video.addEventListener('seeked', function onSeeked() {
        video.removeEventListener('seeked', onSeeked);
        startRecording();
      }, { once: true });

      // Fallback if seeked doesn't fire immediately
      setTimeout(() => {
        if (isRecording && recorder.state === 'inactive') {
          startRecording();
        }
      }, 300);

      // Hard timeout for safety
      setTimeout(() => {
        if (isRecording) {
          finish();
        }
      }, (targetDuration + 6) * 1000);
    });

  } catch (err) {
    console.error('Video export error:', err);
    setStatus('Unable to export video card: ' + err.message);
  } finally {
    if (progressWrap) progressWrap.classList.add('hidden');
    if (downloadBtn) downloadBtn.disabled = false;
    // Resume preview video looping at trim start
    if (video) {
      video.loop = true;
      video.currentTime = (state.videoTrim && state.videoTrim.start) || 0;
      video.play().catch(() => {});
    }
  }
}

function loadSafeImage(src, label = 'image') {
  if (!src) return Promise.resolve(null);

  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      if (image.naturalWidth > 0 && image.naturalHeight > 0) {
        resolve(image);
      } else {
        reject(new Error(`Image ${label} loaded with zero dimensions`));
      }
    };
    image.onerror = () => {
      console.error(`Safe image load failed: ${label}`);
      resolve(null);
    };
    image.src = src;
  });
}

function readImageElement(src) {
  return loadSafeImage(src, 'readImageElement');
}

async function loadImage(src, label = 'canvas image') {
  return loadSafeImage(src, label);
}

async function loadImageFromDataUrl(dataUrl, label = 'uploaded image') {
  return loadSafeImage(dataUrl, label);
}

async function waitForImagesLoaded(images = []) {
  const pending = images.filter(Boolean);
  if (!pending.length) return [];

  await Promise.all(pending.map((image) => new Promise((resolve) => {
    if (image.complete && image.naturalWidth > 0) {
      resolve(image);
      return;
    }

    image.onload = () => resolve(image);
    image.onerror = () => {
      console.warn('Image failed to load before render:', image.src);
      resolve(image);
    };
  })));

  return pending;
}

// ==========================================
// TEXT WRAPPING
// Calculates the natural lines from measured width,
// ensuring no word or character overflows horizontally.
// ==========================================
function wrapText(ctx, text, maxWidth) {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim();
  if (!normalized) return [''];

  const words = normalized.split(' ');
  const lines = [];
  let currentLine = '';

  for (const word of words) {
    const candidate = currentLine ? `${currentLine} ${word}` : word;
    const measuredWidth = ctx.measureText(candidate).width;

    if (measuredWidth <= maxWidth || !currentLine) {
      if (measuredWidth > maxWidth && !currentLine) {
        // Individual word exceeds max width — break down by characters
        let partial = '';
        for (const char of word) {
          if (ctx.measureText(partial + char).width <= maxWidth) {
            partial += char;
          } else {
            lines.push(partial);
            partial = char;
          }
        }
        currentLine = partial;
      } else {
        currentLine = candidate;
      }
    } else {
      lines.push(currentLine);
      if (ctx.measureText(word).width > maxWidth) {
        let partial = '';
        for (const char of word) {
          if (ctx.measureText(partial + char).width <= maxWidth) {
            partial += char;
          } else {
            lines.push(partial);
            partial = char;
          }
        }
        currentLine = partial;
      } else {
        currentLine = word;
      }
    }
  }

  if (currentLine) {
    lines.push(currentLine);
  }

  return lines;
}

function wrapTextLines(ctx, text, maxWidth, maxLines = 24) {
  const allLines = wrapText(ctx, text, maxWidth);
  if (allLines.length <= maxLines) return allLines;
  const safeMaxLines = Math.max(1, maxLines);
  const result = allLines.slice(0, safeMaxLines);
  let lastLine = result[result.length - 1];
  if (!lastLine) return result;
  while (lastLine.length > 0 && ctx.measureText(lastLine + '…').width > maxWidth) {
    lastLine = lastLine.slice(0, -1).trim();
  }
  result[result.length - 1] = lastLine ? lastLine + '…' : '…';
  return result;
}

function fitHeaderLeftText(ctx, text, maxWidth) {
  if (!text || ctx.measureText(text).width <= maxWidth) return text;
  let truncated = text;
  while (truncated.length > 0 && ctx.measureText(truncated + '…').width > maxWidth) {
    truncated = truncated.slice(0, -1).trim();
  }
  return truncated ? truncated + '…' : text;
}

// ==========================================
// JUSTIFIED DESCRIPTION TEXT ENGINE
// Formats description lines with newspaper-style justification:
// - Evenly distributes words across the available width for intermediate lines
// - First word pinned to left boundary, last word pinned to right boundary
// - Leaves the final line of each paragraph naturally left-aligned
// - Does not add manual spaces or stretch characters
// - Fully compatible with both Telugu (Mandali / Noto Sans Telugu) and English (Roboto)
// ==========================================
function wrapDescriptionLines(ctx, text, maxWidth, maxLines = 24) {
  // 1. Completely remove all soft hyphens (\u00ad) that render as small "-" symbols on canvas
  let cleanText = String(text || '').replace(/\u00ad/g, '');

  // 2. Heal any words that were broken with hyphens across line breaks in pasted text
  // so the complete unbroken word wraps naturally to the next line without hyphens
  cleanText = cleanText.replace(/([\p{L}\p{M}]+)-[\t ]*\r?\n[\t ]*([\p{L}\p{M}]+)/gu, '$1$2');

  const normalized = cleanText.trim();
  if (!normalized) {
    return [{ text: '', words: [], isLastInParagraph: true, toString() { return this.text; } }];
  }

  // Preserve intentional paragraphs by splitting on line breaks
  const paragraphs = normalized.split(/\r?\n+/);
  const resultLines = [];

  for (let pIdx = 0; pIdx < paragraphs.length; pIdx++) {
    const pText = paragraphs[pIdx].trim();
    if (!pText) continue;

    // Split words strictly on whitespace (\s+) so words wrap naturally as complete units.
    // NEVER split words using hyphens, and NEVER insert "-" characters.
    // Preserves Indic conjuncts and matras in Telugu (Mandali / Noto Sans Telugu) and English (Roboto).
    const words = pText.split(/\s+/).filter(Boolean);
    if (!words.length) continue;

    let currentWords = [];
    let currentText = '';

    for (let wIdx = 0; wIdx < words.length; wIdx++) {
      const word = words[wIdx];
      const candidateText = currentText ? `${currentText} ${word}` : word;
      const candidateWidth = ctx.measureText(candidateText).width;

      if (candidateWidth <= maxWidth || currentWords.length === 0) {
        currentWords.push(word);
        currentText = candidateText;
      } else {
        // Line wrap: word does not fit on the current line.
        // Move the ENTIRE word completely to the next line naturally.
        // NEVER insert '-' or hyphen characters to force a line break.
        // NEVER split words across lines using hyphens.
        resultLines.push({
          text: currentText,
          words: currentWords,
          isLastInParagraph: false,
          toString() { return this.text; }
        });
        currentWords = [word];
        currentText = word;
      }
    }

    if (currentWords.length > 0) {
      resultLines.push({
        text: currentText,
        words: currentWords,
        isLastInParagraph: true, // End of this paragraph
        toString() { return this.text; }
      });
    }
  }

  if (resultLines.length === 0) {
    return [{ text: '', words: [], isLastInParagraph: true, toString() { return this.text; } }];
  }

  if (resultLines.length <= maxLines) {
    return resultLines;
  }

  // Handle truncation to maxLines safely
  const safeMaxLines = Math.max(1, maxLines);
  const truncated = resultLines.slice(0, safeMaxLines);
  const lastItem = truncated[truncated.length - 1];
  let lastText = lastItem.text;
  while (lastText.length > 0 && ctx.measureText(lastText + '…').width > maxWidth) {
    lastText = lastText.slice(0, -1).trim();
  }
  lastText = lastText ? lastText + '…' : '…';
  truncated[truncated.length - 1] = {
    text: lastText,
    words: lastText.split(/\s+/).filter(Boolean),
    isLastInParagraph: true, // Final truncated line aligns naturally left
    toString() { return this.text; }
  };
  return truncated;
}

function renderJustifiedDescriptionLine(ctx, lineItem, x, y, maxWidth) {
  if (!lineItem) return;

  const text = typeof lineItem === 'string' ? lineItem : lineItem.text;
  const words = (lineItem.words && Array.isArray(lineItem.words))
    ? lineItem.words
    : String(text || '').split(/\s+/).filter(Boolean);
  const isLast = typeof lineItem === 'object' && lineItem !== null
    ? Boolean(lineItem.isLastInParagraph)
    : false;

  if (!words.length) return;

  // Final line of paragraph or single-word line: natural left alignment
  if (isLast || words.length <= 1) {
    ctx.textAlign = 'left';
    ctx.fillText(text, x, y);
    return;
  }

  // Calculate total width of all individual words without spaces
  let totalWordsWidth = 0;
  const wordWidths = new Array(words.length);
  for (let i = 0; i < words.length; i++) {
    const w = ctx.measureText(words[i]).width;
    wordWidths[i] = w;
    totalWordsWidth += w;
  }

  const spaceCount = words.length - 1;
  const remainingSpace = maxWidth - totalWordsWidth;

  // If words naturally fill or exceed maxWidth, use standard left rendering
  if (remainingSpace <= 0) {
    ctx.textAlign = 'left';
    ctx.fillText(text, x, y);
    return;
  }

  const normalSpaceWidth = ctx.measureText(' ').width || 8;
  const calculatedSpace = remainingSpace / spaceCount;

  // Check if line contains Telugu script
  const isTelugu = /[\u0C00-\u0C7F]/.test(text);

  // Maximum allowed space between words to maintain natural spacing.
  // For Telugu (Mandali), allow at most ~1.55x normal space (or +5px extra)
  // so Telugu words never have large unnatural gaps.
  // For English (Roboto), allow up to ~1.85x normal space.
  const maxAllowedSpace = isTelugu
    ? Math.min(normalSpaceWidth * 1.55, normalSpaceWidth + 5)
    : Math.min(normalSpaceWidth * 1.85, normalSpaceWidth + 7.5);

  if (calculatedSpace <= maxAllowedSpace) {
    // Spacing is natural and within allowed threshold: full clean justification
    ctx.textAlign = 'left';
    ctx.fillText(words[0], x, y);

    ctx.textAlign = 'right';
    ctx.fillText(words[words.length - 1], x + maxWidth, y);

    if (words.length > 2) {
      ctx.textAlign = 'left';
      let currentX = x + wordWidths[0] + calculatedSpace;
      for (let i = 1; i < words.length - 1; i++) {
        ctx.fillText(words[i], currentX, y);
        currentX += wordWidths[i] + calculatedSpace;
      }
    }
  } else {
    // Normal justification would require excessive, unnatural spacing.
    // Reduce the justification amount to a gentle, natural spacing instead of forcing large word gaps!
    const reducedSpace = normalSpaceWidth * (isTelugu ? 1.15 : 1.25);
    ctx.textAlign = 'left';
    let currentX = x;
    for (let i = 0; i < words.length; i++) {
      ctx.fillText(words[i], currentX, y);
      currentX += wordWidths[i] + reducedSpace;
    }
  }

  // Restore textAlign to 'left'
  ctx.textAlign = 'left';
}

// ==========================================
// TITLE FONT CALCULATION
// Adjusts title size based on title length (supports up to 150 chars).
// ==========================================
function getTitleFontSize(title) {
  const length = String(title || '').length;

  if (length <= 40) return 64;
  if (length <= 70) return 56;
  if (length <= 110) return 50;
  return 46;
}

// ==========================================
// DESCRIPTION FONT CALCULATION
// Adjusts description size based on content (supports up to 600 chars).
// ==========================================
function getDescriptionFontSize(description) {
  const length = String(description || '').length;

  if (length <= 150) return 38;
  if (length <= 300) return 32;
  if (length <= 450) return 28;
  return 26;
}

function getLineHeight(fontSize) {
  return Math.round(fontSize * 1.2);
}

function measureTextBlock(ctx, text, maxWidth, preferredFontSize, fontWeight, minFontSize, maxLines, maxHeight) {
  const safeText = String(text || '').trim() || 'Untitled story';
  let finalFontSize = preferredFontSize;
  let finalLines = wrapText(ctx, safeText, maxWidth);
  let finalLineHeight = getLineHeight(finalFontSize);

  while (finalFontSize >= minFontSize) {
    ctx.font = `${fontWeight} ${finalFontSize}px "Segoe UI", sans-serif`;
    finalLines = wrapTextLines(ctx, safeText, maxWidth, maxLines);
    finalLineHeight = getLineHeight(finalFontSize);
    const totalHeight = finalLines.length * finalLineHeight;

    if (totalHeight <= maxHeight) {
      break;
    }

    finalFontSize -= 2;
  }

  if (finalLines.length === 0) {
    finalLines = [safeText];
  }

  return {
    lines: finalLines,
    size: finalFontSize,
    lineHeight: finalLineHeight,
    totalHeight: finalLines.length * finalLineHeight
  };
}

// ==========================================
// DYNAMIC CONTENT HEIGHT
// Calculates where the description ends before placing the reporter section.
// ==========================================
function getReporterPosition(canvasHeight, descriptionBottom, footerHeight) {
  return canvasHeight - footerHeight;
}

// =====================================================
// UNIFIED EXPORT CANVAS RENDERER (ZERO TAINT GUARANTEE)
// Pre-loads all required images safely (Data URLs / local assets),
// renders the full 1080 × 1920 card onto canvas, verifies untainted status,
// and returns the clean Canvas element for preview, export, and publish.
// =====================================================
async function renderExportCanvas(cardData = state) {
  // 1. Ensure BTV logo is loaded and ready
  let logo = cardData.btvLogoImage || state.btvLogoImage || cachedBtvLogo || null;
  if (!logo || !logo.complete || logo.naturalWidth === 0) {
    try {
      logo = await loadBtvLogo();
    } catch (err) {
      console.error('Error loading BTV logo in renderExportCanvas:', err);
      logo = null;
    }
  }

  // 2. Ensure news image is loaded and ready if imageData exists
  const rawImageData = cardData.imageData || state.imageData || '';
  let newsImage = cardData.newsImage || state.newsImage || null;
  if ((!newsImage || !newsImage.complete || newsImage.naturalWidth === 0) && rawImageData) {
    try {
      newsImage = await loadSafeImage(rawImageData, 'uploaded news image');
    } catch (err) {
      console.error('Error loading news image in renderExportCanvas:', err);
      newsImage = null;
    }
  }

  // 3. Obtain canvas target
  const targetCanvas = document.getElementById('newsCanvas') || document.createElement('canvas');

  // 4. Render card onto canvas
  await renderCard({
    targetCanvas,
    cardData: {
      ...cardData,
      btvLogoImage: logo,
      newsImage: newsImage
    }
  });

  // 5. Test export to verify canvas is 100% untainted and clean
  targetCanvas.toDataURL('image/png');

  state.renderedCanvas = targetCanvas;
  return targetCanvas;
}

const renderCardToCanvas = renderExportCanvas;
window.renderExportCanvas = renderExportCanvas;
window.renderCardToCanvas = renderCardToCanvas;

async function syncRenderedCanvas() {
  return renderExportCanvas();
}

async function createCanvasForDownload(format) {
  return renderExportCanvas();
}

function roundRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function drawWrappedText(ctx, text, x, y, maxWidth, lineHeight, maxLines) {
  const words = String(text || '').split(' ');
  let line = '';
  let lineCount = 0;

  for (let i = 0; i < words.length; i += 1) {
    const word = words[i];
    const testLine = line ? `${line} ${word}` : word;
    const testWidth = ctx.measureText(testLine).width;

    if (testWidth > maxWidth && line) {
      ctx.fillText(line, x, y);
      y += lineHeight;
      line = word;
      lineCount += 1;
      if (lineCount >= maxLines) break;
    } else {
      line = testLine;
    }
  }

  if (line && lineCount < maxLines) {
    ctx.fillText(line, x, y);
  }
}

function titleTextForCanvas() {
  return state.title || 'Breaking update from the newsroom';
}

function descriptionTextForCanvas() {
  return state.description || 'Your headline and description will appear here as the final published story.';
}

// ==========================================
// CANVAS EXPORT
// Exports the exact rendered Preview canvas.
// ==========================================
async function exportCard(format = 'image/png', quality = 1) {
  const canvas = await renderCardToCanvas();
  if (!canvas) {
    throw new Error('Canvas export failed because the final card canvas was not created.');
  }

  const mimeType = format === 'image/jpeg' ? 'image/jpeg' : 'image/png';
  const dataUrl = canvas.toDataURL(mimeType, quality);
  console.log('BTV canvas export check PASSED');

  return new Promise((resolve, reject) => {
    try {
      const blob = dataUrlToBlob(dataUrl);
      if (!blob) {
        reject(new Error('Canvas export returned no Blob.'));
        return;
      }
      resolve(blob);
    } catch (error) {
      reject(error);
    }
  });
}

async function exportCanvasToDataUrl(canvas, mimeType = 'image/png', quality = 1) {
  if (!canvas) {
    throw new Error('No canvas available for export.');
  }

  return canvas.toDataURL(mimeType, quality);
}

function dataUrlToBlob(dataUrl) {
  if (!dataUrl || typeof dataUrl !== 'string') return null;

  const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.*)$/.exec(dataUrl);
  if (!match) return null;

  const binary = atob(match[2]);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return new Blob([bytes], { type: match[1] });
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function downloadDataUrl(dataUrl, filename) {
  const link = document.createElement('a');
  link.href = dataUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

async function generatePublishedImageData() {
  const canvas = await renderCardToCanvas();
  return canvas ? canvas.toDataURL('image/png') : '';
}

// ==========================================
// DOWNLOAD
// Downloads the rendered card.
// ==========================================
async function downloadCard() {
  try {
    if (state.mediaType === 'video') {
      setStatus('Video card selected. Please use "Download Video" to export as MP4.');
      return;
    }

    const validationError = validateFormData();
    if (validationError) {
      setStatus(validationError);
      return;
    }

    const canvas = await renderCardToCanvas();
    const dataUrl = canvas.toDataURL('image/png');
    downloadDataUrl(dataUrl, 'btv-news-card.png');
    setStatus('Card downloaded.');
  } catch (error) {
    console.error('BTV Download Card Error:', error);
    setStatus('Unable to download the card: ' + error.message);
  }
}

async function downloadImage(format) {
  try {
    if (state.mediaType === 'video') {
      setStatus('Video card selected. Please use "Download Video" to export as MP4.');
      return;
    }

    const validationError = validateFormData();
    if (validationError) {
      setStatus(validationError);
      return;
    }

    const mimeTypeMap = {
      png: 'image/png',
      jpg: 'image/jpeg',
      story: 'image/png'
    };
    const qualityMap = {
      png: 1,
      jpg: 0.95,
      story: 1
    };
    const fileNameMap = {
      png: 'btv-news-card.png',
      jpg: 'btv-news-card.jpg',
      story: 'btv-news-story-9x16.png'
    };

    const mimeType = mimeTypeMap[format] || 'image/png';
    const quality = qualityMap[format] || 1;
    const fileName = fileNameMap[format] || 'btv-news-card.png';

    const canvas = await renderCardToCanvas();
    if (!canvas) {
      throw new Error('No canvas available for download.');
    }

    const dataUrl = canvas.toDataURL(mimeType, quality);
    downloadDataUrl(dataUrl, fileName);
    setStatus('Download complete.');
  } catch (error) {
    console.error('BTV Download Error:', error);
    setStatus('Unable to download the current card: ' + error.message);
  }
}

async function triggerPublish(selectedCategories = ['News']) {
  console.group('BTV PUBLISH DEBUG');
  console.log('1. Publish process initiated');

  try {
    console.log('2. Form data collected');
    updateStateFromInputs();

    const title = state.title.trim();
    const description = state.description.trim();
    // Selected categories
    const categories = Array.isArray(selectedCategories) && selectedCategories.length
      ? selectedCategories
      : ['News'];

    const payload = {
      title,
      description,
      language: state.language || (isTeluguFont(state.titleFont) ? 'telugu' : 'english'),
      cardLanguage: state.language || (isTeluguFont(state.titleFont) ? 'telugu' : 'english'),
      // Title font selection
      titleFont: state.titleFont || (state.language === 'english' ? 'Roboto' : 'Noto Sans Telugu'),
      // Description font selection
      descriptionFont: state.descriptionFont || (state.language === 'english' ? 'Roboto' : 'Noto Sans Telugu'),
      categories,
      theme: state.theme || 'royal-red',
      titleSize: state.titleSize,
      descriptionSize: state.descriptionSize,
      gap: state.gap,
      titleColor: state.titleColor,
      highlightColor: state.highlightColor,
      textColor: state.textColor,
      accentColor: state.accentColor,
      reporterName: state.reporterName || '',
      designation: state.designation || state.reporterDesignation || '',
      reporterDesignation: state.designation || state.reporterDesignation || '',
      imageData: state.imageData,
      crop: state.crop,
      autoFit: state.autoFit,
      date: new Date().toISOString(),
      user: getCurrentUser()?.reporterId || null
    };
    console.log('Form data:', payload);

    console.log('3. Validation passed');
    const validationError = validateFormData();
    if (validationError) {
      throw new Error(validationError);
    }

    console.log('4. Rendering card on previewCanvas...');
    // Always render to newsCanvas to guarantee preview and publish share identical pixel pipeline
    const targetCanvas = document.getElementById('newsCanvas') || document.createElement('canvas');
    await renderCard({ targetCanvas, cardData: state });

    console.log('5. Extracting image data URL...');
    let publishedImage = '';
    try {
      publishedImage = targetCanvas.toDataURL('image/jpeg', 0.95);
    } catch (e) {
      console.warn('Direct canvas export failed, attempting untainted re-render:', e);
      try {
        const offscreen = document.createElement('canvas');
        await renderCard({ targetCanvas: offscreen, cardData: state });
        publishedImage = offscreen.toDataURL('image/jpeg', 0.95);
      } catch (err2) {
        console.error('Published image generation failed completely:', err2);
        throw new Error('Image export failed due to security constraints. Please use local image files.');
      }
    }

    if (!publishedImage || publishedImage === 'data:,' || publishedImage.length < 100) {
      throw new Error('Failed to generate published card image.');
    }

    console.log('6. Saving to storage...');
    const id = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : createId();
    const sourceImageId = `${id}_source`;
    const publishedImageId = `${id}_published`;

    // Save categories, language mode and font selections with card
    const post = {
      id,
      title,
      description,
      language: state.language || (isTeluguFont(state.titleFont) ? 'telugu' : 'english'),
      cardLanguage: state.language || (isTeluguFont(state.titleFont) ? 'telugu' : 'english'),
      // Title font selection
      titleFont: state.titleFont || (state.language === 'english' ? 'Roboto' : 'Noto Sans Telugu'),
      // Description font selection
      descriptionFont: state.descriptionFont || (state.language === 'english' ? 'Roboto' : 'Noto Sans Telugu'),
      categories,
      theme: state.theme || 'royal-red',
      date: new Date().toISOString(),
      reporterName: state.reporterName || '',
      designation: state.designation || state.reporterDesignation || '',
      reporterDesignation: state.designation || state.reporterDesignation || '',
      imageData: state.imageData,
      sourceImage: state.imageData,
      publishedImage,
      imageId: sourceImageId,
      publishedImageId,
      titleSize: state.titleSize,
      descriptionSize: state.descriptionSize,
      gap: state.gap,
      titleColor: state.titleColor,
      highlightColor: state.highlightColor,
      textColor: state.textColor,
      accentColor: state.accentColor,
      autoFit: state.autoFit,
      crop: state.crop,
      publishedAt: new Date().toISOString(),
      published: true,
      status: 'published',
      user: payload.user
    };

    if (state.imageData) {
      await saveImageToIndexedDB(sourceImageId, state.imageData);
    }
    await saveImageToIndexedDB(publishedImageId, dataUrlToBlob(publishedImage) || publishedImage);

    const posts = getPosts();
    posts.unshift(sanitizePostForStorage(post));
    savePosts(posts);
    console.log('9. Storage completed');

    const shareUrl = new URL('post.html', window.location.href);
    shareUrl.searchParams.set('id', id);
    state.publishedUrl = shareUrl.toString();
    if (elements.shareLinkInput) {
      elements.shareLinkInput.value = shareUrl.toString();
      elements.shareLinkInput.setAttribute('title', shareUrl.toString());
    }
    console.log('10. Public URL generated:', shareUrl.toString());
    renderMyCards();
    setStatus('Published successfully!');
    console.log('BTV PUBLISH SUCCESS');
    console.groupEnd();
    return;
  } catch (error) {
    console.error('=== BTV PUBLISH FAILED ===');
    console.error('BTV PUBLISH ERROR:', error);
    console.error(error && error.stack ? error.stack : error);
    console.groupEnd();
    setStatus('Publish failed: ' + error.message);
  }
}

function copyPublishedLink() {
  const shareUrl = state.publishedUrl || elements.shareLinkInput.value;

  if (!shareUrl) {
    setStatus('Publish a card first to create a link.');
    return;
  }

  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(shareUrl)
      .then(() => {
        setStatus('Link copied!');
      })
      .catch(() => {
        const fallback = document.createElement('textarea');
        fallback.value = shareUrl;
        document.body.appendChild(fallback);
        fallback.select();
        try {
          document.execCommand('copy');
          setStatus('Link copied!');
        } catch (copyError) {
          setStatus('Clipboard is unavailable. Copy the URL manually.');
        } finally {
          fallback.remove();
        }
      });
    return;
  }

  const fallback = document.createElement('textarea');
  fallback.value = shareUrl;
  document.body.appendChild(fallback);
  fallback.select();
  try {
    document.execCommand('copy');
    setStatus('Link copied!');
  } catch (copyError) {
    setStatus('Clipboard is unavailable. Copy the URL manually.');
  } finally {
    fallback.remove();
  }
}

function createMyCardMarkup(post) {
  const cardImage = post.publishedImage || post.imageData || '';
  const previewStyle = cardImage
    ? `background-image: url('${cardImage}'); background-size: cover; background-position: center;`
    : 'background: linear-gradient(135deg, rgba(11,31,216,0.12), rgba(227,27,35,0.11));';
  const link = new URL('post.html', window.location.href);
  link.searchParams.set('id', post.id);

  return `
    <article class="my-card-item" data-id="${post.id}">
      <div class="my-card-thumb" style="${previewStyle}"></div>
      <div class="my-card-body">
        <h4>${(post.title || 'Untitled card').slice(0, 52)}</h4>
        <div class="meta-row">
          <span>${new Date(post.publishedAt || Date.now()).toLocaleDateString('en-GB')}</span>
          <span class="status-pill">Published</span>
        </div>
        <div class="my-card-actions">
          <button type="button" data-action="view" data-id="${post.id}">View</button>
          <button type="button" data-action="edit" data-id="${post.id}">Edit</button>
          <button type="button" data-action="copy" data-id="${post.id}">Copy Link</button>
          <button type="button" data-action="download" data-id="${post.id}">Download</button>
          <button type="button" class="danger" data-action="delete" data-id="${post.id}">Delete</button>
        </div>
      </div>
    </article>
  `;
}

// =====================================================
// MY CARDS
// Displays the user's published cards in the gallery.
// =====================================================
function renderMyCards() {
  const list = elements.myCardsList;
  if (!list) return;

  const posts = getPosts();

  if (!posts.length) {
    list.innerHTML = '<div class="empty-state">No published cards yet.</div>';
    return;
  }

  list.innerHTML = posts.map(createMyCardMarkup).join('');
}

function applyCardFromStorage(post) {
  state.title = post.title || '';
  state.description = post.description || '';
  state.language = post.language || post.cardLanguage || (isTeluguFont(post.titleFont) ? 'telugu' : 'english');
  state.cardLanguage = state.language;
  // Title font selection
  state.titleFont = post.titleFont || (state.language === 'english' ? 'Roboto' : 'Noto Sans Telugu');
  // Description font selection
  state.descriptionFont = post.descriptionFont || (state.language === 'english' ? 'Roboto' : 'Noto Sans Telugu');
  state.theme = post.theme || 'royal-red';
  state.titleSize = Math.max(28, Math.min(96, Number(post.titleSize) || 48));
  state.descriptionSize = post.descriptionSize || 30;
  state.gap = post.gap || 18;
  state.titleColor = post.titleColor || '#F3C74A';
  state.highlightColor = post.highlightColor || '#A10D1F';
  state.textColor = post.textColor || '#F5F1F3';
  state.accentColor = post.accentColor || '#3F0A19';
  state.imageData = post.imageData || '';
  state.reporterName = post.reporterName || 'Reporter Name';
  state.reporterDesignation = post.reporterDesignation || 'Designation';
  state.autoFit = post.autoFit !== false;
  state.crop = post.crop || { zoom: 1, x: 50, y: 50 };
  document.querySelectorAll('.preset-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.theme === state.theme);
  });
  syncDisplayValues();
  updatePreview();
}

// =====================================================
// REPORTER PROFILE & DROPDOWN MANAGEMENT
// =====================================================
// REPORTER PROFILE & DROPDOWN MANAGEMENT
// Reads the logged-in reporter's actual information from localStorage:
// - Profile Photo (uploaded during registration, max 2MB)
// - Full Name (firstName + lastName)
// - Date of Birth (dob)
// - Reporter ID (reporterId)
// Controls the Profile dropdown, My Cards option, and Logout functionality.
// =====================================================
function getLoggedInReporter() {
  const currentUser = getCurrentUser();
  if (!currentUser) {
    return {
      name: state.reporterName || 'Reporter',
      firstName: '',
      lastName: '',
      dob: '',
      id: 'BTV-REP-01',
      reporterId: 'BTV-REP-01',
      photo: null,
      initial: (state.reporterName || 'R')[0].toUpperCase()
    };
  }

  // Look up full user account in btvNewsUsers by matching reporterId
  let users = [];
  try {
    const raw = localStorage.getItem('btvNewsUsers');
    users = raw ? JSON.parse(raw) : [];
  } catch (e) {
    users = [];
  }

  const currentReporterId = currentUser.reporterId || currentUser.username || '';
  const fullUser = users.find(
    (u) => (u.reporterId && u.reporterId.toLowerCase() === currentReporterId.toLowerCase()) ||
           (u.username && u.username.toLowerCase() === currentReporterId.toLowerCase())
  ) || currentUser;

  let displayName = '';
  if (fullUser.reporterName) {
    displayName = fullUser.reporterName;
  } else if (fullUser.firstName || fullUser.lastName) {
    displayName = `${fullUser.firstName || ''} ${fullUser.lastName || ''}`.trim();
  }
  if (!displayName) {
    displayName = fullUser.name || fullUser.reporterId || fullUser.username || state.reporterName || 'Reporter';
  }

  const reporterId = fullUser.reporterId || fullUser.username || 'BTV-REP-01';
  const photo = fullUser.profilePhoto || fullUser.photo || fullUser.avatar || fullUser.image || null;
  const dob = fullUser.dob || '';
  const initial = displayName && displayName[0] ? displayName[0].toUpperCase() : 'R';

  return {
    name: displayName,
    reporterName: displayName,
    firstName: fullUser.firstName || '',
    lastName: fullUser.lastName || '',
    mobileNumber: fullUser.mobileNumber || '',
    email: fullUser.email || '',
    designation: fullUser.designation || 'Reporter',
    dob: dob,
    id: reporterId,
    reporterId: reporterId,
    profilePhoto: photo,
    photo: photo,
    initial: initial
  };
}

function initializeProfileMenu() {
  // Profile data
  const reporter = getLoggedInReporter();

  // 1. Header Profile Button (Photo thumbnail / initial + Name)
  const headerAvatar = document.getElementById('headerProfileAvatar');
  const headerName = document.getElementById('headerProfileName');
  if (headerAvatar) {
    if (reporter.photo) {
      headerAvatar.innerHTML = `<img src="${reporter.photo}" alt="${reporter.name}" />`;
    } else {
      headerAvatar.textContent = reporter.initial;
    }
  }
  if (headerName) {
    headerName.textContent = reporter.name;
  }

  // 2. Profile Dropdown Card Header (Reporter photo/initial, Name, ID, and DOB)
  const photoEl = document.getElementById('profileCardPhoto');
  const fallbackEl = document.getElementById('profileCardAvatarFallback');
  const nameEl = document.getElementById('profileReporterName');
  const idEl = document.getElementById('profileReporterId');
  const dobEl = document.getElementById('profileReporterDob');
  const dobWrap = document.getElementById('profileDobWrap');

  if (nameEl) nameEl.textContent = reporter.name;
  if (idEl) idEl.textContent = reporter.reporterId;

  if (reporter.dob) {
    if (dobEl) {
      dobEl.textContent = new Date(reporter.dob).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    }
    if (dobWrap) dobWrap.classList.remove('hidden');
  } else if (dobWrap) {
    dobWrap.classList.add('hidden');
  }

  if (reporter.photo && photoEl) {
    photoEl.src = reporter.photo;
    photoEl.classList.remove('hidden');
    if (fallbackEl) fallbackEl.classList.add('hidden');
  } else {
    if (photoEl) photoEl.classList.add('hidden');
    if (fallbackEl) {
      fallbackEl.textContent = reporter.initial;
      fallbackEl.classList.remove('hidden');
    }
  }

  // 3. Profile Dropdown Toggle Behavior (Desktop & Mobile)
  const profileBtn = document.getElementById('profileBtn');
  const profileDropdown = document.getElementById('profileDropdown');

  if (profileBtn && profileDropdown) {
    profileBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      const isOpen = profileDropdown.classList.contains('open');
      if (isOpen) {
        profileDropdown.classList.remove('open');
        profileBtn.setAttribute('aria-expanded', 'false');
      } else {
        profileDropdown.classList.add('open');
        profileBtn.setAttribute('aria-expanded', 'true');
      }
    });

    // Close dropdown when clicking outside
    document.addEventListener('click', (event) => {
      if (!profileDropdown.contains(event.target) && !profileBtn.contains(event.target)) {
        profileDropdown.classList.remove('open');
        profileBtn.setAttribute('aria-expanded', 'false');
      }
    });

    // Close dropdown on Escape key
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && profileDropdown.classList.contains('open')) {
        profileDropdown.classList.remove('open');
        profileBtn.setAttribute('aria-expanded', 'false');
      }
    });
  }

  // 4. Logout Functionality inside Profile dropdown
  const profileLogoutBtn = document.getElementById('profileLogoutBtn');
  if (profileLogoutBtn) {
    profileLogoutBtn.addEventListener('click', () => {
      localStorage.removeItem(CURRENT_USER_KEY);
      window.location.href = 'index.html';
    });
  }
}

// =====================================================
// CATEGORY SELECTION & PUBLISH MODAL
// // Category selection
// Displays all 8 categories upon clicking "Publish & Get Link",
// allows selecting single or multiple categories, and confirms publish.
// =====================================================
function openCategoryModal() {
  updateStateFromInputs();
  const validationError = validateFormData();
  if (validationError) {
    setStatus(validationError);
    return;
  }

  const modal = document.getElementById('categoryModal');
  if (modal) {
    modal.classList.remove('hidden');
    modal.setAttribute('aria-hidden', 'false');
  }
}

function closeCategoryModal() {
  const modal = document.getElementById('categoryModal');
  if (modal) {
    modal.classList.add('hidden');
    modal.setAttribute('aria-hidden', 'true');
  }
}

function getSelectedCategories() {
  // Selected categories
  const checkboxes = document.querySelectorAll('#categorySelectionGrid input[name="categories"]:checked');
  const selected = Array.from(checkboxes).map((cb) => cb.value);
  return selected.length ? selected : ['News'];
}

function setupCategoryModal() {
  const closeBtn = document.getElementById('closeCategoryModal');
  const cancelBtn = document.getElementById('cancelCategoryBtn');
  const confirmBtn = document.getElementById('confirmPublishBtn');
  const modal = document.getElementById('categoryModal');

  if (closeBtn) closeBtn.addEventListener('click', closeCategoryModal);
  if (cancelBtn) cancelBtn.addEventListener('click', closeCategoryModal);

  if (modal) {
    modal.addEventListener('click', (event) => {
      if (event.target === modal) closeCategoryModal();
    });
  }

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && modal && !modal.classList.contains('hidden')) {
      closeCategoryModal();
    }
  });

  if (confirmBtn) {
    confirmBtn.addEventListener('click', async () => {
      const categories = getSelectedCategories();
      closeCategoryModal();
      await triggerPublish(categories);
    });
  }
}

function setupFontSelectionHandlers() {
  document.querySelectorAll('.font-btn[data-field]').forEach((button) => {
    button.addEventListener('click', () => {
      const field = button.dataset.field;
      const font = button.dataset.font;
      if (field === 'title') {
        state.titleFont = font;
      } else if (field === 'description') {
        state.descriptionFont = font;
      }
      syncDisplayValues();
      updateSizeButtonStates();
      updatePreview();
    });
  });
}

function setupReporterHandlers() {
  const addBtn = document.getElementById('addReporterBtn');
  const removeBtn = document.getElementById('removeReporterBtn');
  if (addBtn) {
    addBtn.addEventListener('click', () => {
      state.reporterName = elements.reporterNameInput ? elements.reporterNameInput.value.trim() : '';
      state.designation = elements.reporterDesignationInput ? elements.reporterDesignationInput.value.trim() : '';
      state.reporterDesignation = state.designation;
      updatePreview();
    });
  }
  if (removeBtn) {
    removeBtn.addEventListener('click', () => {
      if (elements.reporterNameInput) elements.reporterNameInput.value = '';
      if (elements.reporterDesignationInput) elements.reporterDesignationInput.value = '';
      state.reporterName = '';
      state.designation = '';
      state.reporterDesignation = '';
      updatePreview();
    });
  }
}

function loadSavedReporterData() {
  const user = getCurrentUser();
  if (user && user.firstName) {
    const fullName = `${user.firstName} ${user.lastName || ''}`.trim();
    if (!state.reporterName) state.reporterName = fullName;
    if (!state.designation && user.designation) {
      state.designation = user.designation;
      state.reporterDesignation = user.designation;
    }
  }
}

function bindActions() {
  document.querySelectorAll('[data-action="new-card"]').forEach((button) => {
    button.addEventListener('click', () => {
      window.location.href = 'dashboard.html';
    });
  });

  document.querySelectorAll('.step-btn').forEach((button) => {
    button.addEventListener('click', () => handleStepChange(button.dataset.target, button.dataset.step));
  });

  const handleTitleChange = () => {
    if (!elements.titleInput) return;
    const clamped = clampTitleInput(elements.titleInput.value);
    if (elements.titleInput.value !== clamped) {
      elements.titleInput.value = clamped;
    }
    updateStateFromInputs();
    syncCharacterCounters();
    updateSizeButtonStates();
    updatePreview();
  };

  const handleDescriptionChange = () => {
    if (!elements.descriptionInput) return;
    const clamped = clampDescriptionInput(elements.descriptionInput.value);
    if (elements.descriptionInput.value !== clamped) {
      elements.descriptionInput.value = clamped;
    }
    updateStateFromInputs();
    syncCharacterCounters();
    updateSizeButtonStates();
    updatePreview();
  };

  ['input', 'keyup', 'change', 'cut'].forEach((evt) => {
    elements.titleInput?.addEventListener(evt, handleTitleChange);
    elements.descriptionInput?.addEventListener(evt, handleDescriptionChange);
  });

  ['paste-title', 'paste-description', 'clear-title', 'clear-description'].forEach((actionName) => {
    document.querySelector(`[data-action="${actionName}"]`)?.addEventListener('click', () => {
      const isTitle = actionName.includes('title');
      const target = isTitle ? elements.titleInput : elements.descriptionInput;
      if (!target) return;

      if (actionName.includes('clear')) {
        target.value = '';
        if (isTitle) handleTitleChange();
        else handleDescriptionChange();
      } else {
        if (navigator.clipboard && navigator.clipboard.readText) {
          navigator.clipboard.readText().then((text) => {
            if (text) {
              target.value = isTitle ? clampTitleInput(text) : clampDescriptionInput(text);
              if (isTitle) handleTitleChange();
              else handleDescriptionChange();
            }
          }).catch(() => {});
        }
      }
    });
  });

  elements.titleInput?.addEventListener('paste', (event) => {
    event.preventDefault();
    const pasted = (event.clipboardData || window.clipboardData)?.getData('text') || '';
    const start = elements.titleInput.selectionStart || 0;
    const end = elements.titleInput.selectionEnd || 0;
    const curVal = elements.titleInput.value || '';
    const nextValue = clampTitleInput(curVal.slice(0, start) + pasted + curVal.slice(end));
    elements.titleInput.value = nextValue;
    const newPos = Math.min(nextValue.length, start + pasted.length);
    try { elements.titleInput.setSelectionRange(newPos, newPos); } catch (e) {}
    handleTitleChange();
  });

  elements.descriptionInput?.addEventListener('paste', (event) => {
    event.preventDefault();
    const pasted = (event.clipboardData || window.clipboardData)?.getData('text') || '';
    const start = elements.descriptionInput.selectionStart || 0;
    const end = elements.descriptionInput.selectionEnd || 0;
    const curVal = elements.descriptionInput.value || '';
    const nextValue = clampDescriptionInput(curVal.slice(0, start) + pasted + curVal.slice(end));
    elements.descriptionInput.value = nextValue;
    const newPos = Math.min(nextValue.length, start + pasted.length);
    try { elements.descriptionInput.setSelectionRange(newPos, newPos); } catch (e) {}
    handleDescriptionChange();
  });

  elements.reporterNameInput.addEventListener('input', updatePreview);
  elements.reporterDesignationInput.addEventListener('input', updatePreview);
  elements.autoFitToggle.addEventListener('change', updatePreview);

  elements.titleColorPicker.addEventListener('input', (event) => handleColorInput('titleColor', event.target.value));
  elements.highlightColorPicker.addEventListener('input', (event) => handleColorInput('highlightColor', event.target.value));
  elements.textColorPicker.addEventListener('input', (event) => handleColorInput('textColor', event.target.value));
  elements.accentColorPicker.addEventListener('input', (event) => handleColorInput('accentColor', event.target.value));

  elements.titleColorHex.addEventListener('change', (event) => handleColorInput('titleColor', event.target.value));
  elements.highlightColorHex.addEventListener('change', (event) => handleColorInput('highlightColor', event.target.value));
  elements.textColorHex.addEventListener('change', (event) => handleColorInput('textColor', event.target.value));
  elements.accentColorHex.addEventListener('change', (event) => handleColorInput('accentColor', event.target.value));

  elements.imageUpload.addEventListener('change', handleImageUpload);
  if (elements.videoUpload) {
    elements.videoUpload.addEventListener('change', handleVideoUpload);
  }
  if (elements.openVideoCropBtn) {
    elements.openVideoCropBtn.addEventListener('click', () => {
      if (elements.cardPreviewVideo && elements.cardPreviewVideo.src) {
        openVideoCropModal();
      } else {
        elements.videoUpload?.click();
      }
    });
  }
  if (elements.videoTogglePlayBtn) {
    elements.videoTogglePlayBtn.addEventListener('click', toggleVideoPlayPause);
  }
  if (elements.videoMuteToggleBtn) {
    elements.videoMuteToggleBtn.addEventListener('click', toggleVideoMute);
  }
  if (elements.removeVideoBtn) {
    elements.removeVideoBtn.addEventListener('click', removeVideo);
  }
  if (elements.canvasVideoWrapper) {
    elements.canvasVideoWrapper.addEventListener('click', toggleVideoPlayPause);
  }
  if (elements.downloadVideoBtn) {
    elements.downloadVideoBtn.addEventListener('click', exportCardAsVideo);
  }
  if (elements.cardPreviewVideo) {
    elements.cardPreviewVideo.addEventListener('timeupdate', () => {
      if (state.mediaType === 'video' && state.videoTrim && state.videoTrim.end > state.videoTrim.start) {
        if (elements.cardPreviewVideo.currentTime < state.videoTrim.start || elements.cardPreviewVideo.currentTime >= state.videoTrim.end) {
          elements.cardPreviewVideo.currentTime = state.videoTrim.start;
        }
      }
    });
  }

  elements.cropZoom.addEventListener('input', () => {
    state.crop.zoom = Number(elements.cropZoom.value);
    updatePreview();
  });
  elements.cropX.addEventListener('input', () => {
    state.crop.x = Number(elements.cropX.value);
    updatePreview();
  });
  elements.cropY.addEventListener('input', () => {
    state.crop.y = Number(elements.cropY.value);
    updatePreview();
  });

  document.getElementById('applyCropBtn').addEventListener('click', updatePreview);
  document.getElementById('resetCropBtn').addEventListener('click', () => {
    state.crop = { zoom: 1, x: 50, y: 50 };
    syncDisplayValues();
    updatePreview();
  });
  document.getElementById('replaceImageBtn').addEventListener('click', () => elements.imageUpload.click());

  document.getElementById('previewRenderBtn').addEventListener('click', () => {
    updateStateFromInputs();
    const error = validateFormData();
    if (error) {
      setStatus(error);
      return;
    }
    updatePreview();
    setStatus('Preview rendered successfully.');
  });

  document.getElementById('publishBtn')?.addEventListener('click', () => {
    // Category selection
    openCategoryModal();
  });

  document.getElementById('copyLinkBtn')?.addEventListener('click', copyPublishedLink);

  // =====================================================
  // DOWNLOAD BUTTON SECTION
  // // Download button section: exports current card as PNG, JPG, or Story 9:16.
  // =====================================================
  document.querySelectorAll('[data-format]').forEach((button) => {
    button.addEventListener('click', () => {
      const format = button.dataset.format || 'png';
      downloadImage(format);
    });
  });

  if (!elements.myCardsList) return;

  elements.myCardsList.addEventListener('click', (event) => {
    const target = event.target.closest('button');
    if (!target) return;
    const { action, id } = target.dataset;
    const posts = getPosts();
    const post = posts.find((item) => item.id === id);

    if (!post) return;

    if (action === 'view') {
      window.location.href = `post.html?id=${id}`;
      return;
    }

    if (action === 'edit') {
      applyCardFromStorage(post);
      document.getElementById('titleInput').focus();
      return;
    }

    if (action === 'copy') {
      const url = new URL('post.html', window.location.href);
      url.searchParams.set('id', id);
      navigator.clipboard.writeText(url.toString()).then(() => setStatus('Link copied successfully!'));
      return;
    }

    if (action === 'download') {
      state.title = post.title || '';
      state.description = post.description || '';
      state.language = post.language || post.cardLanguage || (isTeluguFont(post.titleFont) ? 'telugu' : 'english');
      state.cardLanguage = state.language;
      state.titleFont = post.titleFont || (state.language === 'english' ? 'Roboto' : 'Noto Sans Telugu');
      state.descriptionFont = post.descriptionFont || (state.language === 'english' ? 'Roboto' : 'Noto Sans Telugu');
      state.theme = post.theme || 'royal-red';
      state.titleSize = Math.max(28, Math.min(96, Number(post.titleSize) || 48));
      state.descriptionSize = post.descriptionSize || 30;
      state.gap = post.gap || 18;
      state.titleColor = post.titleColor || '#F3C74A';
      state.highlightColor = post.highlightColor || '#A10D1F';
      state.textColor = post.textColor || '#F5F1F3';
      state.accentColor = post.accentColor || '#3F0A19';
      state.imageData = post.imageData || '';
      state.reporterName = post.reporterName || '';
      state.designation = post.designation || post.reporterDesignation || '';
      state.reporterDesignation = state.designation;
      state.autoFit = post.autoFit !== false;
      state.crop = post.crop || { zoom: 1, x: 50, y: 50 };
      document.querySelectorAll('.preset-btn').forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.theme === state.theme);
      });
      syncDisplayValues();
      updatePreview();
      downloadImage('png');
      return;
    }

    if (action === 'delete') {
      const filtered = posts.filter((item) => item.id !== id);
      savePosts(filtered);
      renderMyCards();
      setStatus('Card deleted.');
    }
  });
}

function cacheElements() {
  elements.titleInput = document.getElementById('titleInput');
  elements.descriptionInput = document.getElementById('descriptionInput');
  elements.titleSizeValue = document.getElementById('titleSizeValue');
  elements.descriptionSizeValue = document.getElementById('descriptionSizeValue');
  elements.gapValue = document.getElementById('gapValue');
  elements.titleColorPicker = document.getElementById('titleColorPicker');
  elements.highlightColorPicker = document.getElementById('highlightColorPicker');
  elements.textColorPicker = document.getElementById('textColorPicker');
  elements.accentColorPicker = document.getElementById('accentColorPicker');
  elements.titleColorHex = document.getElementById('titleColorHex');
  elements.highlightColorHex = document.getElementById('highlightColorHex');
  elements.textColorHex = document.getElementById('textColorHex');
  elements.accentColorHex = document.getElementById('accentColorHex');
  elements.previewTitle = document.getElementById('previewTitle');
  elements.previewDescription = document.getElementById('previewDescription');
  elements.previewDate = document.getElementById('previewDate');
  elements.previewReporterName = document.getElementById('previewReporterName');
  elements.previewReporterDesignation = document.getElementById('previewReporterDesignation');
  elements.newsCardPreview = document.getElementById('newsCardPreview');
  elements.previewMedia = document.getElementById('previewMedia');
  elements.autoFitToggle = document.getElementById('autoFitToggle');
  elements.reporterNameInput = document.getElementById('reporterNameInput');
  elements.reporterDesignationInput = document.getElementById('reporterDesignationInput');
  elements.imageUpload = document.getElementById('imageUpload');
  elements.videoUpload = document.getElementById('videoUpload');
  elements.openVideoCropBtn = document.getElementById('openVideoCropBtn');
  elements.cropTargetVideo = document.getElementById('cropTargetVideo');
  elements.activeMediaBadge = document.getElementById('activeMediaBadge');
  elements.cardPreviewVideo = document.getElementById('cardPreviewVideo');
  elements.canvasVideoWrapper = document.getElementById('canvasVideoWrapper');
  elements.cardVideoPlayToggle = document.getElementById('cardVideoPlayToggle');
  elements.videoControlsRow = document.getElementById('videoControlsRow');
  elements.videoFileName = document.getElementById('videoFileName');
  elements.videoDurationLabel = document.getElementById('videoDurationLabel');
  elements.videoTogglePlayBtn = document.getElementById('videoTogglePlayBtn');
  elements.videoMuteToggleBtn = document.getElementById('videoMuteToggleBtn');
  elements.removeVideoBtn = document.getElementById('removeVideoBtn');
  elements.imageCropControls = document.getElementById('imageCropControls');
  elements.imageActionButtons = document.getElementById('imageActionButtons');
  elements.imageDownloadGrid = document.getElementById('imageDownloadGrid');
  elements.videoDownloadGrid = document.getElementById('videoDownloadGrid');
  elements.downloadVideoBtn = document.getElementById('downloadVideoBtn');
  elements.videoExportProgressWrap = document.getElementById('videoExportProgressWrap');
  elements.videoExportBarFill = document.getElementById('videoExportBarFill');
  elements.videoExportStatus = document.getElementById('videoExportStatus');
  elements.cropZoom = document.getElementById('cropZoom');
  elements.cropX = document.getElementById('cropX');
  elements.cropY = document.getElementById('cropY');
  elements.copyStatus = document.getElementById('copyStatus');
  elements.myCardsList = document.getElementById('myCardsList');
  elements.shareLinkInput = document.getElementById('shareLinkInput');
  elements.titleCounter = document.getElementById('titleCounter');
  elements.descriptionCounter = document.getElementById('descriptionCounter');
  elements.videoCropModal = document.getElementById('videoCropModal');
  elements.closeVideoCropModal = document.getElementById('closeVideoCropModal');
  elements.vcmResolutionBadge = document.getElementById('vcmResolutionBadge');
  elements.vcmDurationBadge = document.getElementById('vcmDurationBadge');
  elements.vcmPreviewVideo = document.getElementById('vcmPreviewVideo');
  elements.vcmCropBox = document.getElementById('vcmCropBox');
  elements.vcmGridLines = document.getElementById('vcmGridLines');
  elements.vcmGridToggleBtn = document.getElementById('vcmGridToggleBtn');
  elements.vcmTrackContainer = document.getElementById('vcmTrackContainer');
  elements.vcmFilmstripCanvas = document.getElementById('vcmFilmstripCanvas');
  elements.vcmPlayhead = document.getElementById('vcmPlayhead');
  elements.vcmHandleStart = document.getElementById('vcmHandleStart');
  elements.vcmHandleEnd = document.getElementById('vcmHandleEnd');
}

async function loadPostFromQuery() {
  const params = new URLSearchParams(window.location.search);
  const editId = params.get('edit') || params.get('id');
  if (!editId) return;

  const posts = getPosts();
  let post = posts.find((p) => p.id === editId);
  if (post) {
    post = await loadPostWithImages(post);
    applyCardFromStorage(post);
  }
}

async function initializeDashboard() {
  if (!ensureAuthenticated()) return;

  cacheElements();
  loadSavedReporterData();
  setupReporterHandlers();
  setupLanguageModeHandlers();
  setupFontSelectionHandlers();
  bindActions();
  setupCategoryModal();
  setupCropModalHandlers();
  setupVideoCropModalHandlers();
  setupCanvasTouchZone();
  initializeProfileMenu();
  addPresetHandlers();
  renderMyCards();
  syncDisplayValues();
  setDownloadButtonsState(true);

  // Pre-load fonts and BTV logo asset before initial canvas render
  try {
    state.btvLogoImage = await loadBtvLogo();
  } catch (err) {
    console.warn('Initial BTV logo pre-load warning:', err);
  }

  await ensureCardFontsLoaded();
  await loadPostFromQuery();
  await updatePreview();
}

document.addEventListener('DOMContentLoaded', initializeDashboard);
