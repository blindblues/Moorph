import gsap from 'gsap';
import { Draggable } from 'gsap/Draggable';
import { db } from './firebase';
import { collection, addDoc, getDoc, doc } from 'firebase/firestore';
import { makeZoomable } from './zoom.js';

gsap.registerPlugin(Draggable);

const DataManager = {
  async getProject(id) {
    try {
      const snap = await getDoc(doc(db, 'projects', id));
      return snap.exists() ? snap.data() : null;
    } catch (e) { return null; }
  },
  async saveResult(projectId, results) {
    await addDoc(collection(db, 'results'), {
      projectId,
      timestamp: new Date().toISOString(),
      data: results
    });
  }
};

const state = {
  currentProject: null,
  currentIndex: 0,
  results: [],
  cards: [],
  isAnimating: false,
  particles: null
};

// Ultralight Particles
class SwipeParticles {
  constructor() {
    this.canvas = document.getElementById('swipe-particles');
    this.ctx = this.canvas.getContext('2d');
    this.particles = [];
    this.resize();
    window.onresize = () => this.resize();
    this.animate();
  }
  resize() {
    this.canvas.width = window.innerWidth;
    this.canvas.height = window.innerHeight;
  }
  spawn(x, dir, amt = 1) {
    const col = dir === 'right' ? '#00ffa3' : '#ff006e';
    for (let i = 0; i < amt; i++) {
      this.particles.push({
        x: dir === 'right' ? this.canvas.width : 0,
        y: Math.random() * this.canvas.height,
        vx: (dir === 'right' ? -5 : 5),
        life: 1, color: col
      });
    }
  }
  animate() {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.x += p.vx; p.life -= 0.02;
      if (p.life <= 0) { this.particles.splice(i, 1); continue; }
      this.ctx.fillStyle = p.color;
      this.ctx.globalAlpha = p.life;
      this.ctx.fillRect(p.x, p.y, 4, 4);
    }
    requestAnimationFrame(() => this.animate());
  }
}

const views = ['loading', 'password', 'tutorial', 'swipe', 'success'].reduce((acc, v) => {
  acc[v] = document.getElementById(`view-${v}`);
  return acc;
}, {});

async function init() {
  const shortId = new URLSearchParams(window.location.search).get('s');
  state.particles = new SwipeParticles();
  if (shortId) {
    const p = await DataManager.getProject(shortId);
    if (p) { state.currentProject = p; showView('password'); return; }
  }
  setupDemo();
}

function setupDemo() {
  state.currentProject = {
    id: 'demo', name: 'Demo', password: '123',
    images: [
      'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=800&q=80',
      'https://images.unsplash.com/photo-1620641788421-7a1c342ea42e?auto=format&fit=crop&w=800&q=80'
    ]
  };
  showView('password');
}

function showView(id) {
  Object.values(views).forEach(v => v?.classList.add('hidden'));
  views[id]?.classList.remove('hidden');
}

document.getElementById('btn-login').onclick = () => {
  const pass = document.getElementById('project-password').value;
  if (pass === state.currentProject.password) showView('tutorial');
  else document.getElementById('password-error').classList.remove('hidden');
};

document.getElementById('btn-start').onclick = () => {
  showView('swipe');
  renderCards();
};

function renderCards() {
  const deck = document.getElementById('card-deck');
  deck.innerHTML = '';
  state.cards = state.currentProject.images.map((img, idx) => {
    const card = document.createElement('div');
    card.className = 'tinder-card' + (idx > 0 ? ' hidden' : '');
    card.style.zIndex = state.currentProject.images.length - idx;
    card.innerHTML = `<img src="${img}" class="card-image" loading="lazy" />`;
    card.onclick = () => { if (Math.abs(state.dx || 0) < 5) openFullscreen(img); };
    deck.appendChild(card);
    return card;
  });
  setupDraggable();
  updateProgress();
}

function openFullscreen(src) {
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.9);z-index:9999;display:flex;justify-content:center;align-items:center;';
  overlay.innerHTML = `<img src="${src}" style="max-width:98%;max-height:98%;border-radius:12px;" />`;
  overlay.onclick = () => overlay.remove();
  document.body.appendChild(overlay);
}

function setupDraggable() {
  const card = state.cards[state.currentIndex];
  if (!card) return;
  card.classList.remove('hidden');
  Draggable.create(card, {
    type: 'x,y',
    onDrag: function () {
      state.dx = this.x;
      const x = this.x;
      const op = Math.min(Math.abs(x) / 100, 1);
      gsap.set('#indicator-like', { opacity: x > 0 ? op : 0 });
      gsap.set('#indicator-dislike', { opacity: x < 0 ? op : 0 });
      gsap.set('#aura-right', { opacity: x > 0 ? op : 0 });
      gsap.set('#aura-left', { opacity: x < 0 ? op : 0 });
      gsap.set(card, { rotation: x * 0.05 });
    },
    onDragEnd: function () {
      if (Math.abs(this.x) > 100) swipe(this.x > 0 ? 'right' : 'left');
      else {
        gsap.to(card, { x: 0, y: 0, rotation: 0, duration: 0.2 });
        gsap.to('.swipe-indicator, .swipe-aura', { opacity: 0, duration: 0.1 });
      }
      state.dx = 0;
    }
  });
}

function swipe(dir) {
  if (state.isAnimating) return;
  state.isAnimating = true;
  const card = state.cards[state.currentIndex];
  state.results.push({ image: state.currentProject.images[state.currentIndex], liked: dir === 'right' });

  gsap.to(card, {
    x: dir === 'right' ? 800 : -800,
    y: 100, rotation: dir === 'right' ? 30 : -30,
    duration: 0.3, ease: 'power2.in',
    onComplete: () => {
      card.remove();
      state.currentIndex++;
      state.isAnimating = false;
      gsap.set('.swipe-indicator, .swipe-aura', { opacity: 0 });
      updateProgress();
      if (state.currentIndex < state.cards.length) setupDraggable();
      else finish();
    }
  });
}

function updateProgress() {
  const total = state.currentProject.images.length;
  const prog = (state.currentIndex / total) * 100;
  document.getElementById('progress-bar').style.width = `${prog}%`;
  document.getElementById('image-counter').innerText = `${Math.min(state.currentIndex + 1, total)} / ${total}`;
}

async function finish() {
  await DataManager.saveResult(state.currentProject.id, state.results);
  showView('success');
}

document.getElementById('ctrl-like').onclick = () => swipe('right');
document.getElementById('ctrl-dislike').onclick = () => swipe('left');
init();
