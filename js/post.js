const POSTS_KEY = 'btvNewsPosts';
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

async function hydratePublishedPost(post) {
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

function getPostIdFromQuery() {
  const params = new URLSearchParams(window.location.search);
  return params.get('id');
}

function getPosts() {
  try {
    return JSON.parse(localStorage.getItem(POSTS_KEY) || '[]');
  } catch (error) {
    return [];
  }
}

async function loadPostById(postId) {
  const posts = getPosts();
  const post = posts.find((item) => item.id === postId);
  if (!post) return null;
  return hydratePublishedPost(post);
}

function formatDate(dateValue) {
  if (!dateValue) return 'Today';
  return new Date(dateValue).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric'
  });
}

async function renderPost() {
  const container = document.getElementById('publicCard');
  const id = getPostIdFromQuery();
  const post = id ? await loadPostById(id) : null;

  if (!post) {
    container.innerHTML = `
      <div class="public-card-inner" style="display:flex;align-items:center;justify-content:center;padding:24px;text-align:center;">
        <h2 style="margin:0 0 12px;">Story not found</h2>
        <p style="margin:0; color:#64748B;">This card may have been deleted or the link is invalid.</p>
      </div>
    `;
    return;
  }

  const publishedImage = post.publishedImage || post.imageData || '';

  if (!publishedImage) {
    container.innerHTML = `
      <div class="public-card-inner public-card-fallback" aria-label="Published BTV card preview">
        <div class="public-card-fallback-copy">
          <h2>Story not available</h2>
          <p>Please publish the card again to generate a final image.</p>
        </div>
      </div>
    `;
    return;
  }

  container.innerHTML = `<img class="public-card-image" src="${publishedImage}" alt="${(post.title || 'BTV news card').replace(/"/g, '&quot;')}" />`;
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

document.addEventListener('DOMContentLoaded', () => {
  setupBackNavigation();
  renderPost();
});
