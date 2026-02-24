import gsap from 'gsap';
import { Draggable } from 'gsap/Draggable';
import { db } from './firebase';
import { collection, addDoc, getDoc, getDocs, doc } from 'firebase/firestore';
import { makeZoomable } from './zoom.js';

gsap.registerPlugin(Draggable);

// --- Data Management ---
const DataManager = {
  getProject(id) {
    const projects = JSON.parse(localStorage.getItem('moorph_projects') || '[]');
    return projects.find(p => p.id === id);
  },
  // Fetch project + images from Firestore sub-collection
  async getProjectFromFirebase(id) {
    try {
      const projectDoc = await getDoc(doc(db, 'projects', id));
      if (!projectDoc.exists()) return null;
      const project = projectDoc.data();

      // Fetch images from sub-collection
      const imagesSnap = await getDocs(collection(db, 'projects', id, 'images'));
      const images = imagesSnap.docs
        .map(d => ({ ...d.data() }))
        .sort((a, b) => a.order - b.order)
        .map(d => d.url);

      return { ...project, images };
    } catch (e) {
      console.error('Errore nel recupero del progetto da Firebase:', e);
      return null;
    }
  },
  // New: Decode project from URL
  decodeFromUrl(encodedData) {
    try {
      const decoded = atob(encodedData);
      return JSON.parse(decoded);
    } catch (e) {
      console.error('Errore nel decodificare il progetto dal link', e);
      return null;
    }
  },
  async saveResult(projectId, results) {
    try {
      // Save to Firebase
      await addDoc(collection(db, 'results'), {
        projectId: projectId,
        timestamp: new Date().toISOString(),
        data: results
      });

      // Maintain local copy
      const allResults = JSON.parse(localStorage.getItem('moorph_results') || '{}');
      allResults[projectId] = results;
      localStorage.setItem('moorph_results', JSON.stringify(allResults));
    } catch (e) {
      console.error('Errore nel salvataggio su Firebase:', e);
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
  particles: null
};

class SwipeParticles {
  constructor() {
    this.canvas = document.getElementById('swipe-particles');
    this.ctx = this.canvas.getContext('2d');
    this.particles = [];
    this.resize();
    window.addEventListener('resize', () => this.resize());
    this.animate();
  }

  resize() {
    this.canvas.width = window.innerWidth;
    this.canvas.height = window.innerHeight;
  }

  spawn(x, direction, amount = 1) {
    const color = direction === 'right' ? '#00ffa3' : '#ff006e';
    for (let i = 0; i < amount; i++) {
      const edgeX = direction === 'right' ? this.canvas.width : 0;
      this.particles.push({
        x: edgeX,
        y: Math.random() * this.canvas.height,
        vx: (direction === 'right' ? -1 : 1) * (Math.random() * 6 + 4),
        vy: (Math.random() - 0.5) * 2,
        size: Math.random() * 2 + 1,
        alpha: 1,
        color: color,
        life: 0.6 + Math.random() * 0.4
      });
    }
  }

  animate() {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.x += p.vx;
      p.y += p.vy;
      p.life -= 0.025;
      p.alpha = Math.max(0, p.life);

      if (p.life <= 0) {
        this.particles.splice(i, 1);
        continue;
      }

      this.ctx.save();
      this.ctx.globalAlpha = p.alpha;

      // Glow effect background
      this.ctx.shadowBlur = 15;
      this.ctx.shadowColor = p.color;

      // Horizontal streak
      this.ctx.beginPath();
      this.ctx.moveTo(p.x, p.y);
      this.ctx.lineTo(p.x - p.vx * 2, p.y);
      this.ctx.strokeStyle = p.color;
      this.ctx.lineWidth = p.size;
      this.ctx.lineCap = 'round';
      this.ctx.stroke();

      // Bright core dot
      this.ctx.shadowBlur = 10;
      this.ctx.fillStyle = '#fff';
      this.ctx.beginPath();
      this.ctx.arc(p.x, p.y, p.size / 2.5, 0, Math.PI * 2);
      this.ctx.fill();

      this.ctx.restore();
    }

    requestAnimationFrame(() => this.animate());
  }
}

// --- DOM Elements ---
const views = {
  loading: document.getElementById('view-loading'),
  password: document.getElementById('view-password'),
  tutorial: document.getElementById('view-tutorial'),
  swipe: document.getElementById('view-swipe'),
  success: document.getElementById('view-success')
};

// --- Initialization ---
async function init() {
  const params = new URLSearchParams(window.location.search);
  const projectId = params.get('p');
  const encodedProject = params.get('d');
  const shortId = params.get('s');

  state.particles = new SwipeParticles();

  // 1. Priority: Short Link from Firebase
  if (shortId) {
    const project = await DataManager.getProjectFromFirebase(shortId);
    if (project) {
      state.currentProject = project;
      showView('password');
      return;
    }
  }

  // 2. Secondary: Load from URL (Encrypted/Encoded data)
  if (encodedProject) {
    const project = DataManager.decodeFromUrl(encodedProject);
    if (project) {
      state.currentProject = project;
      showView('password');
      return;
    }
  }

  // 3. Last Resort: Demo or Local Storage
  if (!projectId) {
    setupDemo();
  } else {
    const project = DataManager.getProject(projectId);
    if (!project) {
      alert('Progetto non trovato');
      return;
    }
    state.currentProject = project;
    showView('password');
  }
}

function setupDemo() {
  state.currentProject = {
    id: 'demo',
    name: 'Demo Project',
    password: '123',
    images: [
      'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=800&q=80',
      'https://images.unsplash.com/photo-1620641788421-7a1c342ea42e?auto=format&fit=crop&w=800&q=80',
      'https://images.unsplash.com/photo-1614850523296-d8c1af93d400?auto=format&fit=crop&w=800&q=80',
      'https://images.unsplash.com/photo-1633356122544-f134324a6cee?auto=format&fit=crop&w=800&q=80'
    ]
  };
  showView('password');
}

function showView(viewId) {
  Object.values(views).forEach(v => v.classList.add('hidden'));
  views[viewId].classList.remove('hidden');
}

// --- Auth ---
document.getElementById('btn-login').addEventListener('click', () => {
  const pass = document.getElementById('project-password').value;
  if (pass === state.currentProject.password) {
    showView('tutorial');
  } else {
    document.getElementById('password-error').classList.remove('hidden');
  }
});

// --- Tutorial ---
document.getElementById('btn-start').addEventListener('click', () => {
  showView('swipe');
  renderCards();
});

// --- Swipe Logic ---
function renderCards() {
  const deck = document.getElementById('card-deck');
  deck.innerHTML = '';

  const images = state.currentProject.images;
  images.forEach((img, idx) => {
    const card = document.createElement('div');
    card.className = 'tinder-card glass-card' + (idx > 0 ? ' bg-stack' : '');
    card.style.zIndex = images.length - idx;
    card.innerHTML = `<img src="${img}" class="card-image" />`;
    // Tap to fullscreen (only the top card, and only if not dragging)
    card.addEventListener('click', (e) => {
      if (Math.abs(state.dragDistX || 0) < 10) openFullscreen(img);
    });
    deck.appendChild(card);
    state.cards.push(card);
  });

  setupDraggable();
  updateProgress();
}

let fullscreenCleanup = null;

function openFullscreen(src) {
  let lb = document.getElementById('fullscreen-overlay');
  if (!lb) {
    lb = document.createElement('div');
    lb.id = 'fullscreen-overlay';
    lb.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.96);z-index:99999;display:none;justify-content:center;align-items:center;padding:16px;';
    lb.innerHTML = `
      <img id="fullscreen-img" style="max-width:100%;max-height:100%;object-fit:contain;border-radius:12px;user-select:none;" />
      <button id="btn-close-fullscreen" style="position:fixed;top:16px;right:16px;background:rgba(255,255,255,0.12);border:none;color:white;font-size:1.4rem;width:44px;height:44px;border-radius:50%;cursor:pointer;z-index:1;">✕</button>
      <p style="position:fixed;bottom:20px;left:50%;transform:translateX(-50%);font-size:0.8rem;color:rgba(255,255,255,0.4);pointer-events:none;">Pizzica o scrolla per zoomare • Doppio tap per resettare</p>
    `;
    document.body.appendChild(lb);
    document.getElementById('btn-close-fullscreen').addEventListener('click', closeFullscreen);
    lb.addEventListener('click', (e) => { if (e.target === lb) closeFullscreen(); });
  }

  const img = lb.querySelector('#fullscreen-img');
  img.src = src;
  img.style.transform = '';
  img.style.cursor = 'zoom-in';
  lb.style.display = 'flex';

  // Block background (card deck) from receiving touch events
  const deck = document.getElementById('card-deck');
  if (deck) deck.style.pointerEvents = 'none';
  document.body.style.overflow = 'hidden';
  document.body.style.pointerEvents = 'none';
  lb.style.pointerEvents = 'all';

  if (fullscreenCleanup) fullscreenCleanup();
  fullscreenCleanup = makeZoomable(img, lb);
}

function closeFullscreen() {
  const lb = document.getElementById('fullscreen-overlay');
  if (lb) lb.style.display = 'none';
  const deck = document.getElementById('card-deck');
  if (deck) deck.style.pointerEvents = '';
  document.body.style.overflow = '';
  document.body.style.pointerEvents = '';
  if (fullscreenCleanup) { fullscreenCleanup(); fullscreenCleanup = null; }
}

function setupDraggable() {
  const cards = document.querySelectorAll('.tinder-card');
  const topCard = cards[0]; // Always target the first card in the DOM since we remove others

  if (!topCard) return;

  // Cleanup existing Draggable on this card if any
  const existing = Draggable.get(topCard);
  if (existing) existing.kill();

  Draggable.create(topCard, {
    type: 'x,y',
    onDrag: function () {
      const x = this.x;
      state.dragDistX = x; // Track drag so click handler can ignore drags
      const opacity = Math.min(Math.abs(x) / 100, 1);

      // Indicator Logic
      const likeNode = document.getElementById('indicator-like');
      const dislikeNode = document.getElementById('indicator-dislike');
      const auraLeft = document.getElementById('aura-left');
      const auraRight = document.getElementById('aura-right');

      if (x > 0) {
        gsap.set(likeNode, { opacity: opacity, scale: 0.5 + opacity * 0.5 });
        gsap.set(dislikeNode, { opacity: 0 });
        gsap.set(auraRight, { opacity: opacity });
        gsap.set(auraLeft, { opacity: 0 });
      } else {
        gsap.set(dislikeNode, { opacity: opacity, scale: 0.5 + opacity * 0.5 });
        gsap.set(likeNode, { opacity: 0 });
        gsap.set(auraLeft, { opacity: opacity });
        gsap.set(auraRight, { opacity: 0 });
      }

      // Particles emission
      if (opacity > 0.4) {
        state.particles.spawn(x, x > 0 ? 'right' : 'left', Math.random() > 0.7 ? 1 : 0);
      }

      // Underneath card scaling
      const nextCard = topCard.nextElementSibling;
      if (nextCard && nextCard.classList.contains('tinder-card')) {
        const scale = 0.92 + (opacity * 0.08);
        const blur = 4 - (opacity * 4);
        const y = 30 - (opacity * 30);
        gsap.set(nextCard, { scale: scale, filter: `blur(${blur}px)`, y: y, opacity: 0.4 + (opacity * 0.6) });
      }

      gsap.to(topCard, { rotation: x * 0.05, duration: 0 });
    },
    onDragEnd: function () {
      const x = this.x;
      state.dragDistX = 0; // Reset so tap detection works on next card
      if (Math.abs(x) > 100) {
        swipe(x > 0 ? 'right' : 'left');
      } else {
        gsap.to(topCard, { x: 0, y: 0, rotation: 0, duration: 0.2, ease: 'power3.out' });
        gsap.to('.swipe-indicator', { opacity: 0, duration: 0.1 });
        gsap.to('.swipe-aura', { opacity: 0, duration: 0.1 });

        const nextCard = topCard.nextElementSibling;
        if (nextCard && nextCard.classList.contains('tinder-card')) {
          gsap.to(nextCard, { scale: 0.92, filter: 'blur(4px)', y: 30, opacity: 0.4, duration: 0.2 });
        }
      }
    }
  });
}

function swipe(direction) {
  if (state.isAnimating) return;
  state.isAnimating = true;

  const card = state.cards[state.currentIndex];
  const xTarget = direction === 'right' ? 1000 : -1000;

  state.results.push({
    image: state.currentProject.images[state.currentIndex],
    liked: direction === 'right'
  });

  gsap.to(card, {
    x: xTarget,
    y: direction === 'right' ? -200 : 200,
    rotation: direction === 'right' ? 45 : -45,
    duration: 0.25,
    ease: 'power3.in',
    onStart: () => {
      state.particles.spawn(0, direction, 12); // Fewer particles on burst
    },
    onComplete: () => {
      card.remove();
      state.currentIndex++;
      state.isAnimating = false;

      gsap.set('.swipe-indicator', { opacity: 0 });
      gsap.set('.swipe-aura', { opacity: 0 });
      updateProgress();

      const nextCard = document.querySelector('.tinder-card');
      if (nextCard) {
        nextCard.classList.remove('bg-stack');
        gsap.to(nextCard, { scale: 1, filter: 'blur(0px)', y: 0, opacity: 1, duration: 0.2, ease: 'power3.out' });
        setupDraggable();
      } else {
        finishProject();
      }
    }
  });
}

function updateProgress() {
  const prog = (state.currentIndex / state.currentProject.images.length) * 100;
  document.getElementById('progress-bar').style.width = `${prog}%`;
}

async function finishProject() {
  // Add a small delay or loading state if needed, but for now just await
  await DataManager.saveResult(state.currentProject.id, state.results);
  showView('success');
}

// Controls
document.getElementById('ctrl-like').addEventListener('click', () => swipe('right'));
document.getElementById('ctrl-dislike').addEventListener('click', () => swipe('left'));

init();
