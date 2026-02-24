import gsap from 'gsap';
import { Draggable } from 'gsap/Draggable';

gsap.registerPlugin(Draggable);

// --- Data Management (Mocked) ---
const DataManager = {
  getProject(id) {
    const projects = JSON.parse(localStorage.getItem('moorph_projects') || '[]');
    return projects.find(p => p.id === id);
  },
  saveResult(projectId, results) {
    const allResults = JSON.parse(localStorage.getItem('moorph_results') || '{}');
    allResults[projectId] = results;
    localStorage.setItem('moorph_results', JSON.stringify(allResults));
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

  state.particles = new SwipeParticles();

  if (!projectId) {
    // Demo Mode if no project ID
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

  // Render internal cards first (bottom up)
  const images = state.currentProject.images;
  images.forEach((img, idx) => {
    const card = document.createElement('div');
    card.className = 'tinder-card glass-card' + (idx > 0 ? ' bg-stack' : '');
    card.style.zIndex = images.length - idx;
    card.innerHTML = `
      <img src="${img}" class="card-image" />
    `;
    deck.appendChild(card);
    state.cards.push(card);
  });

  setupDraggable();
  updateProgress();
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

function finishProject() {
  DataManager.saveResult(state.currentProject.id, state.results);
  showView('success');
}

// Controls
document.getElementById('ctrl-like').addEventListener('click', () => swipe('right'));
document.getElementById('ctrl-dislike').addEventListener('click', () => swipe('left'));

init();
