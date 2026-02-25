import gsap from 'gsap';
import { Draggable } from 'gsap/Draggable';
import { db } from './firebase';
import { collection, addDoc, getDoc, doc } from 'firebase/firestore';
import { makeZoomable } from './zoom.js';

gsap.registerPlugin(Draggable);

// GSAP Performance Defaults
gsap.config({ force3D: true, autoSleep: 60 });

// --- Data Management ---
const DataManager = {
  async getProjectFromFirebase(id) {
    try {
      const projectDoc = await getDoc(doc(db, 'projects', id));
      return projectDoc.exists() ? projectDoc.data() : null;
    } catch (e) {
      console.error('Errore Firebase:', e);
      return null;
    }
  },
  async saveResult(projectId, userName, results) {
    try {
      await addDoc(collection(db, 'results'), {
        projectId,
        userName,
        timestamp: new Date().toISOString(),
        data: results
      });
    } catch (e) {
      console.error('Errore salvataggio:', e);
    }
  }
};

// --- App State ---
const state = {
  currentProject: null,
  currentIndex: 0,
  results: [],
  cards: [],
  isAnimating: false,
  particles: null,
  dragDistX: 0,
  tutorialStep: 1,
  userName: ''
};

// Optimized Particle System using GSAP Ticker
class SwipeParticles {
  constructor() {
    this.canvas = document.getElementById('swipe-particles');
    this.ctx = this.canvas.getContext('2d', { alpha: true });
    this.particles = [];
    this.resize();
    window.addEventListener('resize', () => this.resize(), { passive: true });

    // Use GSAP Ticker for centralized animation management
    gsap.ticker.add(() => this.update());
  }

  resize() {
    this.canvas.width = window.innerWidth;
    this.canvas.height = window.innerHeight;
  }

  spawn(x, direction, amount = 1) {
    const color = direction === 'right' ? '#00ffa3' : '#ff006e';
    const edgeX = direction === 'right' ? this.canvas.width : 0;
    const vxBase = (direction === 'right' ? -1 : 1);

    for (let i = 0; i < amount; i++) {
      this.particles.push({
        x: edgeX,
        y: Math.random() * this.canvas.height,
        vx: vxBase * (Math.random() * 6 + 4),
        vy: (Math.random() - 0.5) * 2,
        size: Math.random() * 2 + 1,
        life: 1,
        color: color
      });
    }
  }

  update() {
    if (this.particles.length === 0) return;

    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.x += p.vx;
      p.y += p.vy;
      p.life -= 0.025;

      if (p.life <= 0) {
        this.particles.splice(i, 1);
        continue;
      }

      ctx.save();
      ctx.globalAlpha = p.life;
      ctx.shadowBlur = 10;
      ctx.shadowColor = p.color;

      // Draw a "streak" line for speed effect
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x - p.vx * 1.5, p.y);
      ctx.strokeStyle = p.color;
      ctx.lineWidth = p.size;
      ctx.lineCap = 'round';
      ctx.stroke();

      // Core bright spot
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size / 2, 0, Math.PI * 2);
      ctx.fillStyle = '#fff';
      ctx.fill();
      ctx.restore();
    }
  }
}

const views = {
  loading: document.getElementById('view-loading'),
  password: document.getElementById('view-password'),
  tutorial: document.getElementById('view-tutorial'),
  swipe: document.getElementById('view-swipe'),
  success: document.getElementById('view-success')
};

// --- Initialization ---
async function init() {
  const shortId = new URLSearchParams(window.location.search).get('s');
  state.particles = new SwipeParticles();

  // Background blobs animation
  gsap.to('.blob-1', { x: '10vw', y: '10vh', scale: 1.2, duration: 20, repeat: -1, yoyo: true, ease: 'sine.inOut' });
  gsap.to('.blob-2', { x: '-10vw', y: '-10vh', scale: 1.3, duration: 25, repeat: -1, yoyo: true, ease: 'sine.inOut', delay: -5 });

  if (shortId) {
    const project = await DataManager.getProjectFromFirebase(shortId);
    if (project) {
      state.currentProject = project;
      showView('password');
      return;
    }
  }
  setupDemo();
}

function setupDemo() {
  state.currentProject = {
    id: 'demo', name: 'Demo Project', password: '123',
    images: [
      'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=800&q=80',
      'https://images.unsplash.com/photo-1620641788421-7a1c342ea42e?auto=format&fit=crop&w=800&q=80',
      'https://images.unsplash.com/photo-1614850523296-d8c1af93d400?auto=format&fit=crop&w=800&q=80',
      'https://images.unsplash.com/photo-1633356122544-f134324a6cee?auto=format&fit=crop&w=800&q=80'
    ]
  };
  showView('password');
}

function showView(id) {
  Object.values(views).forEach(v => v?.classList.add('hidden'));
  if (views[id]) {
    views[id].classList.remove('hidden');
    gsap.fromTo(views[id], { opacity: 0, scale: 0.98 }, { opacity: 1, scale: 1, duration: 0.4, ease: 'power2.out' });
  }
}

// Auth
document.getElementById('btn-login').onclick = () => {
  const name = document.getElementById('user-name').value.trim();
  const pass = document.getElementById('project-password').value;
  const errorEl = document.getElementById('login-error');

  if (!name) {
    errorEl.innerText = 'Inserisci il tuo nome per continuare.';
    errorEl.classList.remove('hidden');
    return;
  }

  if (pass === state.currentProject.password) {
    state.userName = name;
    state.tutorialStep = 1;
    document.getElementById('tutorial-p1').classList.remove('hidden');
    gsap.set('#tutorial-p1', { opacity: 1 });
    document.getElementById('tutorial-p2').classList.add('hidden');
    document.getElementById('btn-next-step').innerText = 'Continua';
    showView('tutorial');
  } else {
    errorEl.innerText = 'Password non valida. Riprova.';
    errorEl.classList.remove('hidden');
  }
};

document.getElementById('btn-next-step').onclick = async () => {
  if (state.tutorialStep === 1) {
    // Phase 1 -> Phase 2
    state.tutorialStep = 2;
    gsap.to('#tutorial-p1', {
      opacity: 0, duration: 0.3, onComplete: () => {
        document.getElementById('tutorial-p1').classList.add('hidden');
        document.getElementById('tutorial-p2').classList.remove('hidden');
        gsap.fromTo('#tutorial-p2', { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.4 });
        document.getElementById('btn-next-step').innerText = 'Iniziamo!';
      }
    });
    return;
  }

  // Phase 2 -> Start App
  const btn = document.getElementById('btn-next-step');
  const originalText = btn.innerText;
  btn.innerText = 'Caricamento immagini...';
  btn.style.opacity = '0.7';
  btn.disabled = true;

  try {
    await renderCards(true);
    showView('swipe');
  } catch (e) {
    console.error('Errore caricamento:', e);
    btn.innerText = originalText;
    btn.disabled = false;
    btn.style.opacity = '1';
  }
};

// --- Progressive Loading Logic ---
async function preloadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(url);
    img.onerror = () => reject(url);
    img.src = url;
  });
}

async function renderCards(initial = false) {
  const deck = document.getElementById('card-deck');
  const images = state.currentProject.images;
  if (!images || images.length === 0) return;

  const maxToRender = Math.min(state.currentIndex + 2, images.length);

  // Preload only if we are actually adding something new
  for (let i = state.currentIndex; i < maxToRender; i++) {
    if (!state.cards[i]) {
      // Create card but keep it hidden/invisible while loading to avoid flash
      const card = document.createElement('div');
      card.className = 'tinder-card' + (i > state.currentIndex ? ' bg-stack' : '');
      card.style.zIndex = images.length - i;
      card.style.opacity = '0';
      card.innerHTML = `<img src="${images[i]}" class="card-image" />`;
      deck.appendChild(card);
      state.cards[i] = card;

      // Load image then fade in
      await preloadImage(images[i]);
      gsap.to(card, { opacity: i > state.currentIndex ? 0.4 : 1, duration: 0.3 });
    }
  }

  if (initial) {
    setupDraggable();
  }
  updateProgress();
}

let fullscreenCleanup = null;
function openFullscreen(src) {
  const topCard = document.querySelector('.tinder-card:not(.bg-stack)');
  const draggable = Draggable.get(topCard);
  if (draggable) draggable.disable();

  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.95);z-index:99999;display:flex;justify-content:center;align-items:center;opacity:0;cursor:zoom-out;user-select:none;touch-action:none;';
  overlay.innerHTML = `
    <img id="fullscreen-img" src="${src}" style="max-width:96%;max-height:96%;border-radius:16px;box-shadow:0 30px 60px rgba(0,0,0,0.5);transform:scale(0.9);" />
    <button id="close-fs" style="position:fixed;top:20px;right:20px;background:rgba(255,255,255,0.1);border:none;color:white;font-size:1.5rem;width:44px;height:44px;border-radius:50%;cursor:pointer;backdrop-filter:blur(10px);z-index:2;">✕</button>
    <div style="position:fixed;bottom:30px;left:0;right:0;text-align:center;color:rgba(255,255,255,0.4);font-size:0.8rem;pointer-events:none;">Pizzica per zoomare • Doppio tap per resettare</div>
  `;

  const img = overlay.querySelector('#fullscreen-img');

  const close = () => {
    if (fullscreenCleanup) { fullscreenCleanup(); fullscreenCleanup = null; }
    gsap.to(overlay, {
      opacity: 0, duration: 0.3, onComplete: () => {
        overlay.remove();
        if (draggable) draggable.enable();
      }
    });
    document.body.style.overflow = '';
  };

  overlay.onclick = (e) => { if (e.target === overlay || e.target.id === 'close-fs') close(); };
  document.body.appendChild(overlay);
  document.body.style.overflow = 'hidden';

  gsap.to(overlay, { opacity: 1, duration: 0.3 });
  fullscreenCleanup = makeZoomable(img, overlay);
}

function setupDraggable() {
  const topCard = document.querySelector('.tinder-card:not(.bg-stack)');
  if (!topCard) return;

  const setIndicatorLike = gsap.quickSetter('#indicator-like', 'opacity');
  const setIndicatorNope = gsap.quickSetter('#indicator-dislike', 'opacity');
  const setAuraLeft = gsap.quickSetter('#aura-left', 'opacity');
  const setAuraRight = gsap.quickSetter('#aura-right', 'opacity');
  const setScaleLike = gsap.quickSetter('#indicator-like', 'scale');
  const setScaleNope = gsap.quickSetter('#indicator-dislike', 'scale');

  Draggable.create(topCard, {
    type: 'x,y',
    // Android Fix: Use Draggable's built-in onClick to handle full-screen toggle
    // This avoids conflicts between touch-drag and simple tap
    onClick: function () {
      const idx = Array.from(topCard.parentNode.children).indexOf(topCard);
      // We need the ACTUAL current index because the DOM might have offset
      const currentImageUrl = state.currentProject.images[state.currentIndex];
      openFullscreen(currentImageUrl);
    },
    onDrag: function () {
      const x = this.x;
      state.dragDistX = x;
      const progress = Math.min(Math.abs(x) / 150, 1);

      if (x > 0) {
        setIndicatorLike(progress); setScaleLike(0.8 + progress * 0.4);
        setIndicatorNope(0);
        setAuraRight(progress * 0.6); setAuraLeft(0);
      } else {
        setIndicatorNope(progress); setScaleNope(0.8 + progress * 0.4);
        setIndicatorLike(0);
        setAuraLeft(progress * 0.6); setAuraRight(0);
      }

      if (progress > 0.5 && Math.random() > 0.6) {
        state.particles.spawn(x, x > 0 ? 'right' : 'left', 1);
      }

      const nextCard = topCard.nextElementSibling;
      if (nextCard && nextCard.classList.contains('tinder-card')) {
        gsap.set(nextCard, {
          scale: 0.92 + (progress * 0.08),
          filter: `blur(${4 - (progress * 4)}px)`,
          y: 30 - (progress * 30),
          opacity: 0.4 + (progress * 0.6)
        });
      }
      gsap.set(topCard, { rotation: x * 0.05 });
    },
    onDragEnd: function () {
      const x = this.x;
      state.dragDistX = 0;
      if (Math.abs(x) > 120) {
        swipe(x > 0 ? 'right' : 'left');
      } else {
        gsap.to(topCard, { x: 0, y: 0, rotation: 0, duration: 0.3, ease: 'back.out(1.7)' });
        gsap.to(['.swipe-indicator', '.swipe-aura'], { opacity: 0, duration: 0.2 });
        const nextCard = topCard.nextElementSibling;
        if (nextCard && nextCard.classList.contains('tinder-card')) {
          gsap.to(nextCard, { scale: 0.92, filter: 'blur(4px)', y: 30, opacity: 0.4, duration: 0.3 });
        }
      }
    }
  });
}

function swipe(direction) {
  if (state.isAnimating) return;
  state.isAnimating = true;

  const card = state.cards[state.currentIndex];
  state.results.push({
    image: state.currentProject.images[state.currentIndex],
    liked: direction === 'right'
  });

  state.particles.spawn(0, direction, 15);

  gsap.to(card, {
    x: direction === 'right' ? 1000 : -1000,
    y: direction === 'right' ? -100 : 100,
    rotation: direction === 'right' ? 40 : -40,
    duration: 0.4,
    ease: 'power2.in',
    onComplete: () => {
      card.remove();
      state.currentIndex++;
      state.isAnimating = false;
      gsap.set(['.swipe-indicator', '.swipe-aura'], { opacity: 0 });
      updateProgress();

      if (state.currentIndex < state.currentProject.images.length) {
        const nextFront = document.querySelector('.tinder-card');
        if (nextFront) {
          nextFront.classList.remove('bg-stack');
          gsap.to(nextFront, { scale: 1, filter: 'blur(0px)', y: 0, opacity: 1, duration: 0.4, ease: 'power3.out' });
        }
        setupDraggable();
        renderCards(); // Add next-next card without clearing
      } else {
        finishProject();
      }
    }
  });
}

function updateProgress() {
  const total = state.currentProject.images.length;
  const prog = (state.currentIndex / total) * 100;
  gsap.to('#progress-bar', { width: `${prog}%`, duration: 0.5, ease: 'power2.out' });
  document.getElementById('image-counter').innerText = `${Math.min(state.currentIndex + 1, total)} / ${total}`;
}

async function finishProject() {
  await DataManager.saveResult(state.currentProject.id, state.userName, state.results);
  showView('success');
}

document.getElementById('ctrl-like').onclick = () => swipe('right');
document.getElementById('ctrl-dislike').onclick = () => swipe('left');

init();
