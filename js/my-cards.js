const POSTS_KEY = 'btvNewsPosts';
const CURRENT_USER_KEY = 'btvNewsCurrentUser';
const BTV_DB_NAME = 'BTVNewsDB';
const BTV_DB_VERSION = 1;
const BTV_IMAGES_STORE = 'images';

function openBTVImageDatabase() {
  return new Promise((resolve) => {
    if (!('indexedDB' in window)) {
      resolve(null);
      return;
    }

    const request = indexedDB.open(BTV_DB_NAME, BTV_DB_VERSION);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(BTV_IMAGES_STORE)) {
        db.createObjectStore(BTV_IMAGES_STORE);
      }
    };
  });
}

async function getStoredImageData(imageId) {
  if (!imageId) return '';

  const db = await openBTVImageDatabase();
  if (!db) return '';

  return new Promise((resolve) => {
    const transaction = db.transaction([BTV_IMAGES_STORE], 'readonly');
    const store = transaction.objectStore(BTV_IMAGES_STORE);
    const request = store.get(imageId);
    request.onsuccess = async () => {
      const result = request.result;
      if (!result) {
        resolve('');
        return;
      }

      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => resolve('');
      reader.readAsDataURL(result instanceof Blob ? result : new Blob([result]));
    };
    request.onerror = () => resolve('');
  });
}

async function hydratePostImages(post) {
  if (!post || !post.id) return post;

  if (!post.publishedImage) {
    const publishedImage = await getStoredImageData(post.publishedImageId || `${post.id}_published`);
    if (publishedImage) {
      post.publishedImage = publishedImage;
    }
  }

  if (!post.imageData) {
    const imageData = await getStoredImageData(post.imageId || `${post.id}_source`);
    if (imageData) {
      post.imageData = imageData;
    }
  }

  return post;
}

function getCurrentUser() {
  try {
    const value = localStorage.getItem(CURRENT_USER_KEY);
    return value ? JSON.parse(value) : null;
  } catch (error) {
    return null;
  }
}

function ensureAuthenticated() {
  const currentUser = getCurrentUser();
  if (!currentUser) {
    window.location.href = 'index.html';
    return false;
  }
  return true;
}

function getPosts() {
  try {
    return JSON.parse(localStorage.getItem(POSTS_KEY) || '[]');
  } catch (error) {
    return [];
  }
}

async function loadPostsWithImages() {
  const posts = getPosts();
  return Promise.all(posts.map(hydratePostImages));
}

function savePosts(posts) {
  const sanitized = Array.isArray(posts) ? posts.map((post) => {
    const metadata = { ...post };
    delete metadata.imageData;
    delete metadata.sourceImage;
    delete metadata.publishedImage;
    if (!metadata.imageId && post.id) {
      metadata.imageId = `${post.id}_source`;
    }
    if (!metadata.publishedImageId && post.id) {
      metadata.publishedImageId = `${post.id}_published`;
    }
    return metadata;
  }) : [];

  localStorage.setItem(POSTS_KEY, JSON.stringify(sanitized));
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
  if (!dateValue) return 'Date unavailable';

  return new Date(dateValue).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric'
  });
}

let cachedBtvLogo = null;

async function loadBtvLogo() {
  if (cachedBtvLogo && cachedBtvLogo.complete && cachedBtvLogo.naturalWidth > 0) {
    return cachedBtvLogo;
  }

  // Priority 1: In-memory Base64 Data URL (Guaranteed zero canvas taint in any browser)
  if (typeof window !== 'undefined' && window.BTV_LOGO_DATA_URL) {
    try {
      const logo = await new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = window.BTV_LOGO_DATA_URL;
      });
      if (logo && logo.naturalWidth > 0) {
        cachedBtvLogo = logo;
        return logo;
      }
    } catch (e) {
      console.warn('Failed to load window.BTV_LOGO_DATA_URL in my-cards:', e);
    }
  }

  // Priority 2: Candidate local asset paths
  const candidateSources = [
    'assets/btv-logo.png',
    './assets/btv-logo.png',
    '../assets/btv-logo.png',
    '/assets/btv-logo.png',
    '/project/assets/btv-logo.png'
  ];

  for (const src of candidateSources) {
    try {
      const logo = await new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = src;
      });
      if (logo && logo.naturalWidth > 0) {
        cachedBtvLogo = logo;
        return logo;
      }
    } catch (e) {
      // try next candidate
    }
  }

  console.error('All BTV logo sources failed to load in my-cards');
  return null;
}

// Active category tab filter
let selectedCategoryFilter = 'All';

// =====================================================
// MY CARDS CATEGORY FILTERING & VISIBILITY
// // My Cards category filtering
// // Multiple category handling
// Filters cards by reporter ownership and selected category tab.
// If a card belongs to ["Sports", "Breaking News"], it appears under both tabs.
// =====================================================
function getVisibleCards(posts = getPosts()) {
  const currentUser = getCurrentUser();
  const currentReporterId = currentUser ? (currentUser.reporterId || currentUser.username || '') : '';

  return posts.filter((post) => {
    const isPublished = post.published === true || post.status === 'published';
    const matchesUser = !currentUser || !post.user || post.user === currentReporterId;
    if (!isPublished || !matchesUser) return false;

    // All categories shows every published card
    if (selectedCategoryFilter === 'All') return true;

    // Multiple category handling: A card assigned to multiple categories
    // must appear under each selected category tab.
    const postCategories = Array.isArray(post.categories) && post.categories.length
      ? post.categories
      : (post.category ? [post.category] : ['News']);

    return postCategories.includes(selectedCategoryFilter);
  });
}

// =====================================================
// FONT LOADER: ROBOTO & NOTO SANS TELUGU (MY CARDS)
// =====================================================
function isTeluguFont(fontName) {
  if (!fontName) return false;
  const lower = String(fontName).trim().toLowerCase();
  return lower === 'mandali' || lower === 'telugu' || lower.includes('noto sans telugu');
}

function getTitleFontFamily(fontName) {
  return isTeluguFont(fontName)
    ? '"Mandali", "Noto Sans Telugu", sans-serif'
    : '"Roboto", sans-serif';
}

function getDescriptionFontFamily(fontName) {
  return isTeluguFont(fontName)
    ? '"Mandali", "Noto Sans Telugu", sans-serif'
    : '"Roboto", sans-serif';
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

function resolveThemeConfig(cardData = {}) {
  const themeKey = cardData.theme || 'royal-red';
  const baseTheme = THEMES[themeKey] || THEMES['royal-red'];

  const titleColor = cardData.titleColor || baseTheme.titleColor;
  const textColor = cardData.textColor || baseTheme.textColor;
  const highlightColor = cardData.highlightColor || baseTheme.highlightColor;
  const accentColor = cardData.accentColor || baseTheme.accentColor;

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

async function ensureCardFontsLoaded(extraFonts = []) {
  try {
    if (typeof document !== 'undefined' && document.fonts && document.fonts.load) {
      const fontLoads = [
        document.fonts.load('800 54px "Noto Sans Telugu"'),
        document.fonts.load('700 54px "Noto Sans Telugu"'),
        document.fonts.load('600 54px "Noto Sans Telugu"'),
        document.fonts.load('400 54px "Noto Sans Telugu"'),
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
    console.warn('Font load status in my-cards:', err);
  }
}

function buildCardCanvasDataUrl(card) {
  return new Promise(async (resolve) => {
    const hydratedCard = { ...card };
    if (!hydratedCard.imageData) {
      hydratedCard.imageData = await getStoredImageData(hydratedCard.imageId || `${hydratedCard.id}_source`);
    }

    const resolvedTheme = resolveThemeConfig(hydratedCard);

    const isEnglishMode = (hydratedCard.language === 'english' || hydratedCard.cardLanguage === 'english' || (!isTeluguFont(hydratedCard.titleFont) && hydratedCard.titleFont === 'Roboto'));

    const titleFont = hydratedCard.titleFont || (isEnglishMode ? 'Roboto' : 'Mandali');
    const descriptionFont = hydratedCard.descriptionFont || (isEnglishMode ? 'Roboto' : 'Mandali');

    const titleFontFamily = getTitleFontFamily(titleFont);
    const descFontFamily = getDescriptionFontFamily(descriptionFont);

    const titleFontSize = Math.max(28, Math.min(96, Number(hydratedCard.titleSize) || 48));
    const descriptionFontSize = Math.max(16, Math.min(64, Number(hydratedCard.descriptionSize) || 30));

    await ensureCardFontsLoaded([
      `800 ${titleFontSize}px "Noto Sans Telugu"`,
      `700 ${titleFontSize}px "Noto Sans Telugu"`,
      `400 ${descriptionFontSize}px "Noto Sans Telugu"`,
      `800 ${titleFontSize}px "Roboto"`,
      `400 ${descriptionFontSize}px "Roboto"`,
      `800 ${titleFontSize}px "Mandali"`,
      `700 ${titleFontSize}px "Mandali"`,
      `400 ${titleFontSize}px "Mandali"`,
      `400 ${descriptionFontSize}px "Mandali"`
    ]);

    const data = {
      title: hydratedCard.title || 'Breaking update from the newsroom',
      description: hydratedCard.description || 'Your headline and description will appear here as the final published story.',
      titleFont,
      descriptionFont,
      titleSize: titleFontSize,
      descriptionSize: descriptionFontSize,
      gap: Number(hydratedCard.gap) !== undefined ? Number(hydratedCard.gap) : 24,
      titleColor: resolvedTheme.titleColor,
      textColor: resolvedTheme.textColor,
      accentColor: resolvedTheme.accentColor,
      highlightColor: resolvedTheme.highlightColor,
      reporterName: hydratedCard.reporterName || '',
      designation: hydratedCard.designation || hydratedCard.reporterDesignation || '',
      reporterDesignation: hydratedCard.designation || hydratedCard.reporterDesignation || '',
      imageData: hydratedCard.imageData || '',
      crop: hydratedCard.crop || { zoom: 1, x: 50, y: 50 }
    };

    const width = 1080;
    // Strict 9:16 aspect ratio: ALWAYS exactly 1080 x 1920 (width * 16 / 9)
    const computedHeight = Math.round(width * 16 / 9);

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = computedHeight;
    const ctx = canvas.getContext('2d');

    const titleAreaLeft = 78;
    const titleAreaWidth = width - 156;
    const headerHeight = 180;
    const imageY = 220;
    const imageH = 480;
    const titleAreaTop = imageY + imageH + 36;
    const footerHeight = 190;
    const footerStartY = canvas.height - footerHeight;
    const contentAreaBottom = footerStartY - 24;
    const availableContentHeight = contentAreaBottom - titleAreaTop;

    const titlePaddingTop = Math.max(12, Math.round(titleFontSize * 0.12));
    const titleLineHeight = isTeluguFont(titleFont)
      ? Math.round(titleFontSize * 1.35)
      : Math.round(titleFontSize * 1.28);

    const measureCanvas = document.createElement('canvas');
    const measureCtx = measureCanvas.getContext('2d');
    const titleWeight = isTeluguFont(titleFont) ? '700' : '800';
    measureCtx.font = `${titleWeight} ${titleFontSize}px ${titleFontFamily}`;
    const titleLines = wrapCardTextLines(measureCtx, data.title, titleAreaWidth);
    const titleTotalHeight = titlePaddingTop + (titleLines.length * titleLineHeight);

    let effectiveDescSize = descriptionFontSize;
    let effectiveGap = Math.max(4, Math.min(36, Number(data.gap) !== undefined ? Number(data.gap) : 24));
    let descLineHeight = Math.round(effectiveDescSize * 1.38);
    measureCtx.font = `400 ${effectiveDescSize}px ${descFontFamily}`;
    let descLines = wrapDescriptionLines(measureCtx, data.description, titleAreaWidth);

    // Auto-fit loop: dynamically scales description font size and gap so stories up to 800
    // characters fit comfortably within availableContentHeight (970px) without overflow!
    const minDescSize = 16;
    while (effectiveDescSize >= minDescSize) {
      descLineHeight = Math.round(effectiveDescSize * 1.38);
      measureCtx.font = `400 ${effectiveDescSize}px ${descFontFamily}`;
      descLines = wrapDescriptionLines(measureCtx, data.description, titleAreaWidth);
      const descTotalHeight = descLines.length * descLineHeight;
      const totalHeight = titleTotalHeight + effectiveGap + descTotalHeight;

      if (totalHeight <= availableContentHeight || effectiveDescSize <= minDescSize) {
        break;
      }

      if (effectiveGap > 12) {
        effectiveGap = Math.max(8, effectiveGap - 4);
      } else {
        effectiveDescSize -= 1;
      }
    }

    const descriptionStartY = titleAreaTop + titleTotalHeight + effectiveGap;

    // Pre-load BTV logo asset before canvas rendering
    const logo = await loadBtvLogo();

    ctx.fillStyle = resolvedTheme.cardBg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

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

    // Right: Date (English format in English mode, Telugu format in Telugu mode)
    const dateText = isEnglishMode
      ? formatDate(card.publishedAt || card.date)
      : formatTeluguDate(card.publishedAt || card.date);
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
      // Reporter name: BOLD/HIGHLIGHTED (800 weight, 38px)
      // Designation: clearly readable (500 weight, 30px)
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
          // Draw icon + bold highlighted reporter name (800 weight, 38px)
          ctx.fillStyle = '#FFFFFF';
          ctx.font = '800 38px "Noto Sans Telugu", "Roboto", sans-serif';
          ctx.fillText(micStr + repName, curX, 126);
          curX += micW + nameW;

          // Draw separator
          ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
          ctx.font = '400 30px "Noto Sans Telugu", "Roboto", sans-serif';
          ctx.fillText(sepStr, curX, 126);
          curX += sepW;

          // Draw readable designation (500 weight, 30px)
          ctx.fillStyle = 'rgba(255, 255, 255, 0.90)';
          ctx.font = '500 30px "Noto Sans Telugu", "Roboto", sans-serif';
          ctx.fillText(repDesig, curX, 126);
        } else {
          // Truncate reporter line gracefully if exceeds maxHeaderWidth
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
      // When reporter name is empty: Tagline is STILL completely displayed at full prominence
      ctx.fillText(btvTagline, headerPaddingX, headerCenterY);
    }

    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';

    // News image with aspect ratio preservation
    const imageX = 70;
    const imageW = canvas.width - 140;

    if (data.imageData) {
      const image = await new Promise((imageResolve) => {
        const img = new Image();
        img.onload = () => imageResolve(img);
        img.onerror = () => imageResolve(null);
        img.src = data.imageData;
      });

      if (image) {
        const cropZoom = Math.max(1, Number(data.crop.zoom) || 1);
        const cropX = Number(data.crop.x) || 50;
        const cropY = Number(data.crop.y) || 50;
        const imgW = image.naturalWidth || image.width;
        const imgH = image.naturalHeight || image.height;
        const coverScale = Math.max(imageW / imgW, imageH / imgH);
        const drawWidth = imgW * coverScale * cropZoom;
        const drawHeight = imgH * coverScale * cropZoom;
        const maxPanX = Math.max(0, drawWidth - imageW);
        const maxPanY = Math.max(0, drawHeight - imageH);
        const offsetX = -maxPanX * (cropX / 100);
        const offsetY = -maxPanY * (cropY / 100);

        ctx.save();
        roundedRect(ctx, imageX, imageY, imageW, imageH, 26);
        ctx.clip();
        ctx.drawImage(image, imageX + offsetX, imageY + offsetY, drawWidth, drawHeight);
        ctx.restore();

        ctx.strokeStyle = resolvedTheme.imageBorder;
        ctx.lineWidth = 2;
        roundedRect(ctx, imageX, imageY, imageW, imageH, 26);
        ctx.stroke();
      } else {
        const fallbackGradient = ctx.createLinearGradient(0, imageY, 0, imageY + imageH);
        fallbackGradient.addColorStop(0, resolvedTheme.fallbackGradient[0]);
        fallbackGradient.addColorStop(1, resolvedTheme.fallbackGradient[1]);
        ctx.fillStyle = fallbackGradient;
        ctx.fillRect(imageX, imageY, imageW, imageH);
      }
    } else {
      const fallbackGradient = ctx.createLinearGradient(0, imageY, 0, imageY + imageH);
      fallbackGradient.addColorStop(0, resolvedTheme.fallbackGradient[0]);
      fallbackGradient.addColorStop(1, resolvedTheme.fallbackGradient[1]);
      ctx.fillStyle = fallbackGradient;
      ctx.fillRect(imageX, imageY, imageW, imageH);
    }

    // =====================================================
    // TITLE & DESCRIPTION RENDERING (Strict 9:16 Bounds, No Title Clipping)
    // =====================================================
    // Title rendering
    ctx.save();
    ctx.fillStyle = data.titleColor;
    ctx.font = `${titleWeight} ${titleFontSize}px ${titleFontFamily}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';

    const titleStartY = titleAreaTop + titlePaddingTop;
    titleLines.forEach((line, index) => {
      ctx.fillText(line, titleAreaLeft, titleStartY + (index * titleLineHeight));
    });
    ctx.restore();

    // Description rendering
    ctx.save();
    ctx.fillStyle = data.textColor;
    ctx.font = `400 ${effectiveDescSize}px ${descFontFamily}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
    if ('wordSpacing' in ctx) ctx.wordSpacing = '0px';

    descLines.forEach((line, index) => {
      const y = descriptionStartY + (index * descLineHeight);
      if (y + descLineHeight <= contentAreaBottom + 12) {
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
    const activeLogo = (logo && logo.complete && logo.naturalWidth > 0) ? logo : cachedBtvLogo;
    const maxLogoW = Math.round(180 * footerScale);
    const maxLogoH = Math.round(114 * footerScale);
    let footerLogoWidth = maxLogoW;
    let footerLogoHeight = maxLogoH;

    if (activeLogo && activeLogo.naturalWidth > 0 && activeLogo.naturalHeight > 0) {
      const naturalRatio = activeLogo.naturalWidth / activeLogo.naturalHeight;
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

    if (activeLogo && activeLogo.complete && activeLogo.naturalWidth > 0 && activeLogo.naturalHeight > 0) {
      ctx.drawImage(
        activeLogo,
        footerLogoX,
        footerLogoY,
        footerLogoWidth,
        footerLogoHeight
      );
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
    function drawSocialRoundedRect(c, rx, ry, rw, rh, rr) {
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
    drawSocialRoundedRect(ctx, igX - Math.round(12 * footerScale), iconCenterY - Math.round(12 * footerScale), Math.round(24 * footerScale), Math.round(24 * footerScale), Math.round(6.5 * footerScale));
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
    let teluguFontSize = Math.round((isEnglishMode ? 36 : 34) * footerScale);
    ctx.font = `700 ${teluguFontSize}px ${footerMainFont}`;
    while (ctx.measureText(footerMainText).width > maxMiddleWidth && teluguFontSize > 18 * footerScale) {
      teluguFontSize -= 1;
      ctx.font = `700 ${teluguFontSize}px ${footerMainFont}`;
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

    resolve(canvas.toDataURL('image/png'));
  });
}

function roundedRect(ctx, x, y, width, height, radius) {
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

function wrapCardText(ctx, text, x, y, maxWidth, lineHeight, maxLines) {
  const words = text.split(' ');
  let line = '';
  let lineCount = 0;

  for (let i = 0; i < words.length; i += 1) {
    const word = words[i];
    const testLine = line ? `${line} ${word}` : word;
    if (ctx.measureText(testLine).width > maxWidth && line) {
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

function wrapCardTextLines(ctx, text, maxWidth, maxLines = 24) {
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

  if (lines.length <= maxLines) return lines;
  const safeMaxLines = Math.max(1, maxLines);
  const result = lines.slice(0, safeMaxLines);
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
// JUSTIFIED DESCRIPTION TEXT ENGINE (MY CARDS)
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

async function migrateMissingPublishedImages() {
  const posts = getPosts();
  let changed = false;

  for (const post of posts) {
    const isPublished = post.published === true || post.status === 'published';
    if (!isPublished || post.publishedImage) continue;

    const generated = await buildCardCanvasDataUrl(post);
    if (generated) {
      post.publishedImage = generated;
      changed = true;
    }
  }

  if (changed) {
    savePosts(posts);
  }

  return posts;
}

function updateCount(cards) {
  const countEl = document.getElementById('cardsCount');
  if (!countEl) return;

  const count = cards.length;
  const label = count === 1 ? 'card' : 'cards';
  countEl.textContent = `${count} ${label}`;
}

async function renderCards() {
  const grid = document.getElementById('cardsGrid');
  if (!grid) return;

  const posts = await loadPostsWithImages();
  const cards = getVisibleCards(posts);
  updateCount(cards);

  if (!cards.length) {
    grid.innerHTML = `
      <div class="empty-state">
        <h2>No published cards yet.</h2>
        <p>Create your first news card</p>
        <a href="dashboard.html" class="primary-btn">+ New Card</a>
      </div>
    `;
    return;
  }

  grid.innerHTML = cards.map((post) => {
    const title = (post.title || 'Untitled card').replace(/</g, '&lt;');
    const thumbnail = post.publishedImage || '';
    const date = formatDate(post.publishedAt || post.date);
    const url = `post.html?id=${encodeURIComponent(post.id)}`;
    const thumbnailMarkup = thumbnail
      ? `<img class="card-thumb" src="${thumbnail}" alt="${title}" />`
      : `<div class="card-thumb missing-preview" aria-label="Published card preview"></div>`;

    const categories = Array.isArray(post.categories) && post.categories.length
      ? post.categories
      : (post.category ? [post.category] : []);
    const categoriesMarkup = categories.length
      ? `<div class="card-categories">${categories.map(c => `<span class="category-badge">${c}</span>`).join('')}</div>`
      : '';

    return `
      <article class="card-item" data-id="${post.id}">
        <div class="card-thumb-wrap">
          ${thumbnailMarkup}
        </div>
        <div class="card-body">
          <h3 class="card-title">${title}</h3>
          ${categoriesMarkup}
          <div class="card-date">${date}</div>
          <div class="card-actions">
            <a class="card-action-btn view" href="${url}">👁 View</a>
            <button type="button" class="card-action-btn link" data-action="copy" data-id="${post.id}">🔗 Link</button>
            <button type="button" class="card-action-btn delete" data-action="delete" data-id="${post.id}">🗑 Delete</button>
          </div>
        </div>
      </article>
    `;
  }).join('');
}

function copyCardLink(postId) {
  const url = new URL('post.html', window.location.href);
  url.searchParams.set('id', postId);

  navigator.clipboard.writeText(url.toString())
    .then(() => {
      const status = document.createElement('div');
      status.textContent = 'Link copied!';
      status.style.position = 'fixed';
      status.style.bottom = '18px';
      status.style.right = '18px';
      status.style.background = '#22C55E';
      status.style.color = '#fff';
      status.style.padding = '10px 14px';
      status.style.borderRadius = '10px';
      status.style.boxShadow = '0 10px 20px rgba(0,0,0,0.18)';
      status.style.fontWeight = '700';
      status.style.zIndex = '1000';
      document.body.appendChild(status);
      setTimeout(() => status.remove(), 1800);
    })
    .catch(() => {
      alert('Clipboard access failed. Please copy the link manually.');
    });
}

function handleDelete(postId) {
  const confirmed = window.confirm('Are you sure you want to delete this card?');
  if (!confirmed) return;

  const posts = getPosts();
  const nextPosts = posts.filter((post) => post.id !== postId);
  savePosts(nextPosts);
  renderCards();
}

// =====================================================
// REPORTER PROFILE & DROPDOWN MANAGEMENT (MY CARDS)
// Reads the logged-in reporter's actual information from localStorage:
// - Profile Photo (uploaded during registration, max 2MB)
// - Full Name (firstName + lastName)
// - Date of Birth (dob)
// - Reporter ID (reporterId)
// Controls the Profile dropdown, My Cards navigation, and Logout functionality.
// =====================================================
function getLoggedInReporter() {
  const currentUser = getCurrentUser();
  if (!currentUser) {
    return {
      name: 'Reporter',
      firstName: '',
      lastName: '',
      dob: '',
      id: 'BTV-REP-01',
      reporterId: 'BTV-REP-01',
      photo: null,
      initial: 'R'
    };
  }

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
    displayName = fullUser.name || fullUser.reporterId || fullUser.username || 'Reporter';
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

function bindActions() {
  const grid = document.getElementById('cardsGrid');
  if (!grid) return;

  grid.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-action]');
    if (!button) return;

    const { action, id } = button.dataset;
    if (!id) return;

    if (action === 'copy') {
      copyCardLink(id);
      return;
    }

    if (action === 'delete') {
      handleDelete(id);
    }
  });
}

// =====================================================
// MY CARDS CATEGORY TABS SETUP
// // My Cards category filtering
// Handles clicking category tabs (All, Breaking News, For You, News, Politics, Business, Sports, Entertainment, Crime)
// and updates the grid filter in real time.
// =====================================================
function setupCategoryTabs() {
  const filterBar = document.getElementById('categoryFilterBar');
  if (!filterBar) return;

  filterBar.addEventListener('click', (event) => {
    const tab = event.target.closest('.category-tab');
    if (!tab) return;

    filterBar.querySelectorAll('.category-tab').forEach((t) => t.classList.remove('active'));
    tab.classList.add('active');

    selectedCategoryFilter = tab.dataset.category || 'All';
    renderCards();
  });
}

// =====================================================
// BACK NAVIGATION
// // Back navigation code: returns user to previous page/dashboard.
// =====================================================
function setupBackNavigation() {
  const backBtn = document.getElementById('backNavBtn');
  if (!backBtn) return;
  backBtn.addEventListener('click', () => {
    if (window.history.length > 1 && document.referrer) {
      window.history.back();
    } else {
      window.location.href = 'dashboard.html';
    }
  });
}

async function initializeMyCards() {
  if (!ensureAuthenticated()) return;

  setupBackNavigation();
  initializeProfileMenu();
  setupCategoryTabs();
  await renderCards();
  bindActions();
}

document.addEventListener('DOMContentLoaded', initializeMyCards);
