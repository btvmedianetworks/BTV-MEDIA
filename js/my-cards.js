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
    ? '"Noto Sans Telugu", sans-serif'
    : '"Roboto", sans-serif';
}

function getDescriptionFontFamily(fontName) {
  return isTeluguFont(fontName)
    ? '"Noto Sans Telugu", sans-serif'
    : '"Roboto", sans-serif';
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

    const titleFont = hydratedCard.titleFont || 'Roboto';
    const descriptionFont = hydratedCard.descriptionFont || 'Roboto';

    const titleFontFamily = getTitleFontFamily(titleFont);
    const descFontFamily = getDescriptionFontFamily(descriptionFont);

    const titleFontSize = Math.max(20, Math.min(96, Number(hydratedCard.titleSize) || 54));
    const descriptionFontSize = Math.max(16, Math.min(64, Number(hydratedCard.descriptionSize) || 30));

    await ensureCardFontsLoaded([
      `800 ${titleFontSize}px "Noto Sans Telugu"`,
      `700 ${titleFontSize}px "Noto Sans Telugu"`,
      `400 ${descriptionFontSize}px "Noto Sans Telugu"`,
      `800 ${titleFontSize}px "Roboto"`,
      `400 ${descriptionFontSize}px "Roboto"`
    ]);

    const data = {
      title: hydratedCard.title || 'Breaking update from the newsroom',
      description: hydratedCard.description || 'Your headline and description will appear here as the final published story.',
      titleFont,
      descriptionFont,
      titleSize: titleFontSize,
      descriptionSize: descriptionFontSize,
      gap: Number(hydratedCard.gap) !== undefined ? Number(hydratedCard.gap) : 24,
      titleColor: hydratedCard.titleColor || '#F3C74A',
      textColor: hydratedCard.textColor || '#F5F1F3',
      accentColor: hydratedCard.accentColor || '#A10D1F',
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

    const titleLineHeight = Math.round(titleFontSize * 1.25);

    const measureCanvas = document.createElement('canvas');
    const measureCtx = measureCanvas.getContext('2d');
    measureCtx.font = `800 ${titleFontSize}px ${titleFontFamily}`;
    const titleLines = wrapCardTextLines(measureCtx, data.title, titleAreaWidth);
    const titleTotalHeight = titleLines.length * titleLineHeight;

    const contentGap = Math.max(4, Math.min(36, Number(data.gap) !== undefined ? Number(data.gap) : 24));
    const descriptionStartY = titleAreaTop + titleTotalHeight + contentGap;

    const descLineHeight = Math.round(descriptionFontSize * 1.35);
    measureCtx.font = `400 ${descriptionFontSize}px ${descFontFamily}`;
    const descLines = wrapCardTextLines(measureCtx, data.description, titleAreaWidth);

    // Pre-load BTV logo asset before canvas rendering
    const logo = await loadBtvLogo();

    ctx.fillStyle = '#200811';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = 'rgba(255,255,255,0.06)';
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
    // BTV CARD TOP HEADER (Mandali Font)
    // // 5. Rendering reporter details in downloaded images
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
    headerGradient.addColorStop(0, '#7C0A20');
    headerGradient.addColorStop(0.5, '#A10D1F');
    headerGradient.addColorStop(1, '#B4152A');
    ctx.fillStyle = headerGradient;
    ctx.fill();
    ctx.restore();

    // Thin bright-red horizontal separator
    ctx.fillStyle = '#E5122E';
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

    // Right: Telugu date in Noto Sans Telugu / Mandali
    const dateText = formatTeluguDate(card.publishedAt || card.date);
    ctx.fillStyle = '#FFFFFF';
    ctx.font = '700 32px "Noto Sans Telugu", "Mandali", sans-serif';
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

        ctx.strokeStyle = 'rgba(240, 128, 80, 0.9)';
        ctx.lineWidth = 2;
        roundedRect(ctx, imageX, imageY, imageW, imageH, 26);
        ctx.stroke();
      } else {
        const fallbackGradient = ctx.createLinearGradient(0, imageY, 0, imageY + imageH);
        fallbackGradient.addColorStop(0, '#3E1129');
        fallbackGradient.addColorStop(1, '#1C0A14');
        ctx.fillStyle = fallbackGradient;
        ctx.fillRect(imageX, imageY, imageW, imageH);
      }
    } else {
      const fallbackGradient = ctx.createLinearGradient(0, imageY, 0, imageY + imageH);
      fallbackGradient.addColorStop(0, '#3E1129');
      fallbackGradient.addColorStop(1, '#1C0A14');
      ctx.fillStyle = fallbackGradient;
      ctx.fillRect(imageX, imageY, imageW, imageH);
    }

    // =====================================================
    // TITLE & DESCRIPTION RENDERING (Strict 9:16 Bounds)
    // =====================================================
    ctx.save();
    ctx.beginPath();
    ctx.rect(titleAreaLeft - 10, titleAreaTop, titleAreaWidth + 20, availableContentHeight + 10);
    ctx.clip();

    // Title rendering
    ctx.fillStyle = data.titleColor;
    ctx.font = `800 ${titleFontSize}px ${titleFontFamily}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';

    titleLines.forEach((line, index) => {
      ctx.fillText(line, titleAreaLeft, titleAreaTop + (index * titleLineHeight));
    });

    // Description rendering
    ctx.fillStyle = data.textColor;
    ctx.font = `400 ${descriptionFontSize}px ${descFontFamily}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';

    descLines.forEach((line, index) => {
      const y = descriptionStartY + (index * descLineHeight);
      if (y + descLineHeight <= contentAreaBottom + 10) {
        ctx.fillText(line, titleAreaLeft, y);
      }
    });

    ctx.restore();

    // =====================================================
    // BTV CARD FOOTER (Noto Sans Telugu / Mandali Font)
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
    footerGradient.addColorStop(0, '#860D20');
    footerGradient.addColorStop(0.4, '#700918');
    footerGradient.addColorStop(1, '#4A050F');
    ctx.fillStyle = footerGradient;
    ctx.fill();
    ctx.restore();

    ctx.fillStyle = '#E5122E';
    ctx.fillRect(0, footerStartY, canvas.width, 3);

    const footerTextX = 54;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';

    ctx.fillStyle = '#FFFFFF';
    ctx.font = '700 38px "Noto Sans Telugu", "Mandali", sans-serif';
    ctx.fillText('నిజమైన వార్తలు కోసం', footerTextX, footerStartY + 76);

    ctx.fillStyle = 'rgba(255, 255, 255, 0.72)';
    ctx.font = '500 24px "Noto Sans Telugu", "Mandali", sans-serif';
    ctx.fillText('BTV News · btvmedia.info', footerTextX, footerStartY + 128);

    const activeLogo = (logo && logo.complete && logo.naturalWidth > 0) ? logo : cachedBtvLogo;
    const maxLogoW = 216;
    const maxLogoH = 140;
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

    const logoMargin = 24;
    const footerLogoX = canvas.width - footerLogoWidth - logoMargin;
    const footerLogoY = canvas.height - footerLogoHeight - logoMargin;

    if (activeLogo && activeLogo.complete && activeLogo.naturalWidth > 0 && activeLogo.naturalHeight > 0) {
      ctx.drawImage(
        activeLogo,
        footerLogoX,
        footerLogoY,
        footerLogoWidth,
        footerLogoHeight
      );
    }

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
