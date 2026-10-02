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

function getPosts() {
  try {
    return JSON.parse(localStorage.getItem(POSTS_KEY) || '[]');
  } catch (error) {
    return [];
  }
}

function formatDate(dateValue) {
  if (!dateValue) return 'Today';
  return new Date(dateValue).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric'
  });
}

async function renderPosts() {
  const grid = document.getElementById('postsGrid');
  const posts = await Promise.all(getPosts().map(hydratePostImages));

  if (!grid) return;

  if (!posts.length) {
    grid.innerHTML = '<div class="post-card"><div class="post-content"><h3>No posts published yet.</h3><p class="post-summary">Create a card in the dashboard to publish your first story.</p></div></div>';
    return;
  }

  grid.innerHTML = posts.map((post) => {
    const image = post.publishedImage || post.imageData || '';
    const imageStyle = image
      ? `background-image: url('${image}'); background-size: cover; background-position: center;`
      : 'background: linear-gradient(135deg, rgba(11,31,216,0.12), rgba(227,27,35,0.11));';
    const summary = (post.description || '').slice(0, 120) || 'A new report from BTV Media.';
    const href = `post.html?id=${encodeURIComponent(post.id)}`;

    return `
      <article class="post-card">
        <div class="post-image" style="${imageStyle}"></div>
        <div class="post-content">
          <h3>${(post.title || 'Untitled story').replace(/</g, '&lt;')}</h3>
          <span class="post-date">${formatDate(post.publishedAt)}</span>
          <p class="post-summary">${summary.replace(/</g, '&lt;')}</p>
          <a class="view-btn" href="${href}">Read story</a>
        </div>
      </article>
    `;
  }).join('');
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
  renderPosts();
});
