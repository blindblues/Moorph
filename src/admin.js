import { db } from './firebase';
import { collection, query, where, getDocs, addDoc, setDoc, doc, deleteDoc } from 'firebase/firestore';
import { makeZoomable } from './zoom.js';

// --- Clipboard Helper (mobile-compatible) ---
async function copyToClipboard(text) {
    // 1. Modern API (requires HTTPS - works on deployed site)
    if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        return;
    }
    // 2. Legacy fallback (works on all mobile browsers, even HTTP)
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;font-size:16px;'; // font-size:16px prevents iOS zoom
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    try {
        document.execCommand('copy');
    } finally {
        document.body.removeChild(ta);
    }
}

// --- Admin Data Management ---
const AdminData = {
    async getProjects() {
        // 1. Get from Local Storage for instant UI
        const local = JSON.parse(localStorage.getItem('moorph_projects') || '[]');

        try {
            // 2. Fetch from Firebase to sync between devices
            const querySnapshot = await getDocs(collection(db, 'projects'));
            const remote = querySnapshot.docs.map(doc => doc.data());

            // Merge: filter out duplicates based on ID
            const merged = [...remote];
            local.forEach(lp => {
                if (!merged.find(rp => rp.id === lp.id)) merged.push(lp);
            });

            this.saveProjects(merged);
            return merged;
        } catch (e) {
            console.error('Errore sync progetti:', e);
            return local;
        }
    },
    saveProjects(projects) {
        localStorage.setItem('moorph_projects', JSON.stringify(projects));
    },
    async deleteProject(projectId) {
        try {
            await deleteDoc(doc(db, 'projects', projectId));
        } catch (e) {
            console.error('Errore durante l\'eliminazione da Firebase:', e);
        }
    },
    async syncProjectToFirebase(project) {
        try {
            // Store only metadata in the main doc (avoid 1MB limit)
            const { images, ...meta } = project;
            await setDoc(doc(db, 'projects', project.id), {
                ...meta,
                updatedAt: new Date().toISOString()
            });

            // Store each image as its own document in a sub-collection
            // First delete existing images sub-collection docs and re-add
            const imagesRef = collection(db, 'projects', project.id, 'images');
            // Add new images that don't exist yet (by checking data URL prefix)
            for (let i = 0; i < images.length; i++) {
                await setDoc(doc(db, 'projects', project.id, 'images', String(i)), {
                    url: images[i],
                    order: i
                });
            }
        } catch (e) {
            console.error('Errore durante il sync con Firebase:', e);
        }
    },
    async getProjectImages(projectId) {
        try {
            const snap = await getDocs(collection(db, 'projects', projectId, 'images'));
            return snap.docs
                .map(d => ({ ...d.data(), id: d.id }))
                .sort((a, b) => a.order - b.order)
                .map(d => d.url);
        } catch (e) {
            return [];
        }
    },
    async getResults(projectId) {
        try {
            const q = query(
                collection(db, 'results'),
                where('projectId', '==', projectId)
            );
            const querySnapshot = await getDocs(q);
            // Sort manually in JS to avoid Firestore Index requirement
            console.log('Risultati recuperati con successo.');
            return querySnapshot.docs
                .map(doc => doc.data())
                .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
        } catch (e) {
            console.error('Errore nel recupero dei risultati:', e);
            return [];
        }
    },
    // Generate a short URL by saving project data to Firestore
    async generateShareLink(project) {
        try {
            // Save/Update project definition in Firestore
            await setDoc(doc(db, 'projects', project.id), {
                id: project.id,
                name: project.name,
                password: project.password,
                images: project.images,
                updatedAt: new Date().toISOString()
            });
            return `${window.location.origin}/?s=${project.id}`;
        } catch (e) {
            console.error('Errore Firebase:', e);
            throw e; // Rilanciamo l'errore per gestirlo nel bottone
        }
    }
};

let activeProject = null;

// --- DOM Elements ---
const el = {
    sidebar: document.getElementById('admin-sidebar'),
    projectList: document.getElementById('project-list'),
    projectDetail: document.getElementById('project-detail'),
    emptyState: document.getElementById('empty-state'),
    modalProject: document.getElementById('modal-project'),
    imageGrid: document.getElementById('image-grid'),
    resultsSummary: document.getElementById('results-summary')
};

// --- Initialization ---
async function init() {
    await renderProjectList();
    setupEventListeners();
}

async function renderProjectList() {
    const projects = await AdminData.getProjects();
    el.projectList.innerHTML = projects.map(p => `
    <li class="project-item ${activeProject?.id === p.id ? 'active' : ''}" onclick="selectProject('${p.id}')">
      <h3>${p.name || 'Senza nome'}</h3>
      <p>ID: ${p.id}</p>
    </li>
  `).join('');
}

window.selectProject = async (id) => {
    const projects = await AdminData.getProjects();
    activeProject = projects.find(p => p.id === id);
    if (!activeProject) return;

    // Fetch images from sub-collection
    activeProject.images = await AdminData.getProjectImages(id);

    el.emptyState.classList.add('hidden');
    el.projectDetail.classList.remove('hidden');

    // Mobile: hide sidebar, show detail
    if (window.innerWidth <= 768) {
        el.sidebar.classList.add('hidden-mobile');
        el.projectDetail.classList.remove('hidden-mobile');
    }

    document.getElementById('detail-name').innerText = activeProject.name;
    document.getElementById('detail-id').innerText = activeProject.id;
    document.getElementById('edit-password').value = activeProject.password || '';
    document.getElementById('image-count').innerText = `${activeProject.images.length} immagini`;

    // Generate and show link immediately in the input field
    const shortUrl = `${window.location.origin}/?s=${activeProject.id}`;
    document.getElementById('share-link-input').value = shortUrl;

    renderImages();
    await renderResults();
    renderProjectList();
};

function renderImages() {
    el.imageGrid.innerHTML = activeProject.images.map((img, idx) => `
    <div class="image-card" onclick="openLightbox('${img.replace(/'/g, "\\'")}')">
      <img src="${img}" style="pointer-events:none;" />
      <button class="remove-btn" onclick="event.stopPropagation(); removeImage(${idx})">×</button>
    </div>
  `).join('');
}

let lightboxCleanup = null;

window.openLightbox = (src) => {
    const overlay = document.getElementById('lightbox-overlay');
    const img = document.getElementById('lightbox-img');
    img.src = src;
    img.style.transform = '';
    img.style.cursor = 'zoom-in';
    overlay.classList.remove('hidden');
    // Block all background interaction
    document.body.style.overflow = 'hidden';
    document.body.style.pointerEvents = 'none';
    overlay.style.pointerEvents = 'all';
    // Attach zoom
    if (lightboxCleanup) lightboxCleanup();
    lightboxCleanup = makeZoomable(img, overlay);
};

window.closeLightbox = () => {
    const overlay = document.getElementById('lightbox-overlay');
    const img = document.getElementById('lightbox-img');
    overlay.classList.add('hidden');
    img.src = '';
    document.body.style.overflow = '';
    document.body.style.pointerEvents = '';
    if (lightboxCleanup) { lightboxCleanup(); lightboxCleanup = null; }
};

async function renderResults() {
    const allSubmissions = await AdminData.getResults(activeProject.id);

    if (allSubmissions.length === 0) {
        el.resultsSummary.innerHTML = '<p style="color:var(--text-dim)">Ancora nessun risultato ricevuto.</p>';
        return;
    }

    el.resultsSummary.innerHTML = allSubmissions.map((submission, sIdx) => {
        const liked = submission.data.filter(r => r.liked);
        const date = new Date(submission.timestamp).toLocaleString('it-IT');
        const notLiked = submission.data.length - liked.length;

        return `
            <div class="result-card">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px; flex-wrap:wrap; gap:8px;">
                    <strong>👤 Utente ${allSubmissions.length - sIdx}</strong>
                    <span style="font-size:0.8rem; color:var(--text-dim);">${date}</span>
                </div>
                <div style="display:flex; gap:20px; margin-bottom:12px; flex-wrap:wrap;">
                    <span style="color:#00ffa3;">✓ ${liked.length} Mi piace</span>
                    <span style="color:#ff006e;">✗ ${notLiked} Non piace</span>
                </div>
                <div style="display:flex; flex-wrap:wrap; gap:6px;">
                    ${liked.map(r => `<img src="${r.image}" style="width:50px; height:50px; object-fit:cover; border-radius:10px; border:1px solid rgba(0,255,163,0.4);" />`).join('')}
                </div>
            </div>
        `;
    }).join('');
}

// --- Actions ---
window.removeImage = async (idx) => {
    activeProject.images.splice(idx, 1);
    await updateActiveProject();
};

async function updateActiveProject() {
    const projects = await AdminData.getProjects();
    const idx = projects.findIndex(p => p.id === activeProject.id);
    projects[idx] = activeProject;
    AdminData.saveProjects(projects);
    await AdminData.syncProjectToFirebase(activeProject);
    renderImages();
    await renderProjectList();
}

function setupEventListeners() {
    // Mobile back button
    document.getElementById('btn-back').addEventListener('click', () => {
        el.projectDetail.classList.add('hidden');
        el.projectDetail.classList.add('hidden-mobile');
        el.sidebar.classList.remove('hidden-mobile');
        el.emptyState.classList.remove('hidden');
        activeProject = null;
        renderProjectList();
    });

    document.getElementById('btn-create-project').addEventListener('click', () => {
        el.modalProject.classList.remove('hidden');
    });

    document.getElementById('btn-cancel').addEventListener('click', () => {
        el.modalProject.classList.add('hidden');
    });

    document.getElementById('btn-save-project').addEventListener('click', async () => {
        const name = document.getElementById('new-project-name').value.trim();
        const pass = document.getElementById('new-project-pass').value.trim();

        if (!name || !pass) return alert('Inserisci nome e password');

        const newProject = {
            id: Math.random().toString(36).substr(2, 6),
            name,
            password: pass,
            images: []
        };

        const projects = await AdminData.getProjects();
        projects.push(newProject);
        AdminData.saveProjects(projects);
        await AdminData.syncProjectToFirebase(newProject);

        document.getElementById('new-project-name').value = '';
        document.getElementById('new-project-pass').value = '';
        el.modalProject.classList.add('hidden');
        await renderProjectList();
        await selectProject(newProject.id);
    });

    document.getElementById('btn-delete-project').addEventListener('click', async () => {
        if (!confirm('Sei sicuro di voler eliminare questo progetto?')) return;

        await AdminData.deleteProject(activeProject.id);

        const projects = await AdminData.getProjects();
        const filtered = projects.filter(p => p.id !== activeProject.id);
        AdminData.saveProjects(filtered);

        activeProject = null;
        el.projectDetail.classList.add('hidden');
        el.emptyState.classList.remove('hidden');
        // Mobile: show sidebar again
        el.sidebar.classList.remove('hidden-mobile');
        await renderProjectList();
    });

    document.getElementById('btn-copy-url').addEventListener('click', async () => {
        const btn = document.getElementById('btn-copy-url');
        const originalText = btn.innerText;
        const input = document.getElementById('share-link-input');
        const url = input.value;

        // Select text in input so user sees what's copied
        input.select();
        input.setSelectionRange(0, 99999);

        try {
            // Try to sync project to Firebase first (for short URL to work)
            await AdminData.syncProjectToFirebase(activeProject);
        } catch (e) {
            console.warn('Firebase sync fallito, il link breve potrebbe non funzionare:', e);
        }

        try {
            await copyToClipboard(url);
            btn.innerText = '✅ Copiato!';
            setTimeout(() => btn.innerText = originalText, 2000);
        } catch {
            // Input is still selected, user can copy manually
            btn.innerText = '⚠️ Seleziona e copia manualmente';
            setTimeout(() => btn.innerText = originalText, 3000);
        }
    });

    // Real file upload
    document.getElementById('drop-zone').addEventListener('click', () => {
        document.getElementById('file-input').click();
    });

    // Compress image to keep Firestore docs small (free, no Storage needed)
    function compressImage(file, maxSize = 800, quality = 0.5) {
        return new Promise((resolve) => {
            const img = new Image();
            const url = URL.createObjectURL(file);
            img.onload = () => {
                URL.revokeObjectURL(url);
                const canvas = document.createElement('canvas');
                let w = img.width, h = img.height;
                if (w > maxSize || h > maxSize) {
                    if (w > h) { h = Math.round(h * maxSize / w); w = maxSize; }
                    else { w = Math.round(w * maxSize / h); h = maxSize; }
                }
                canvas.width = w;
                canvas.height = h;
                canvas.getContext('2d').drawImage(img, 0, 0, w, h);
                resolve(canvas.toDataURL('image/jpeg', quality));
            };
            img.src = url;
        });
    }

    document.getElementById('file-input').addEventListener('change', async (e) => {
        const files = Array.from(e.target.files);
        if (!files.length) return;

        const zone = document.getElementById('drop-zone');
        zone.querySelector('p').innerText = `Compressione ${files.length} immagini...`;
        zone.style.opacity = '0.5';
        zone.style.pointerEvents = 'none';

        try {
            const compressed = await Promise.all(files.map(f => compressImage(f)));
            activeProject.images.push(...compressed);
            await updateActiveProject();
        } catch (err) {
            console.error('Errore upload:', err);
            alert('Errore durante la compressione delle immagini.');
        } finally {
            zone.querySelector('p').innerText = 'Trascina o clicca per caricare';
            zone.style.opacity = '';
            zone.style.pointerEvents = '';
            e.target.value = '';
        }
    });

    // Pinterest Import
    document.getElementById('btn-pinterest-import').addEventListener('click', async () => {
        const url = document.getElementById('pinterest-url').value.trim();
        const status = document.getElementById('pinterest-status');
        if (!url || !url.includes('pinterest.com')) {
            status.style.color = '#ff6b6b';
            status.innerText = 'Inserisci un URL valido di una bacheca Pinterest.';
            return;
        }
        status.style.color = 'var(--text-dim)';
        status.innerText = '⏳ Recupero immagini in corso...';
        try {
            const imgs = await fetchPinterestImages(url);
            if (!imgs.length) {
                status.style.color = '#ff6b6b';
                status.innerText = 'Nessuna immagine trovata. La bacheca potrebbe essere privata o il formato non supportato.';
                return;
            }
            status.style.color = '#00ffa3';
            status.innerText = `✓ Trovate ${imgs.length} immagini. Seleziona quelle da aggiungere.`;
            openPinterestModal(imgs);
        } catch (e) {
            status.style.color = '#ff6b6b';
            status.innerText = `Errore: ${e.message}`;
        }
    });

    // Pinterest modal: select-all / deselect-all / add
    document.getElementById('btn-select-all').addEventListener('click', () => {
        document.querySelectorAll('.pinterest-thumb').forEach(el => el.classList.add('selected'));
        updatePinterestCount();
    });
    document.getElementById('btn-deselect-all').addEventListener('click', () => {
        document.querySelectorAll('.pinterest-thumb').forEach(el => el.classList.remove('selected'));
        updatePinterestCount();
    });
    document.getElementById('btn-add-pinterest').addEventListener('click', async () => {
        const selected = [...document.querySelectorAll('.pinterest-thumb.selected')].map(el => el.dataset.url);
        if (!selected.length) return alert('Seleziona almeno una immagine.');
        document.getElementById('modal-pinterest').classList.add('hidden');
        // Pinterest URLs (i.pinimg.com) can be stored directly — no base64 needed
        activeProject.images.push(...selected);
        await updateActiveProject();
        document.getElementById('pinterest-status').innerText = `✓ Aggiunte ${selected.length} immagini da Pinterest.`;
    });
}

// --- Pinterest Fetcher ---
async function fetchPinterestImages(boardUrl) {
    const normalized = boardUrl.replace(/\/?$/, '/');

    const proxies = [
        async (url) => {
            const r = await fetch(`https://api.allorigins.win/get?url=${encodeURIComponent(url)}`, { signal: AbortSignal.timeout(10000) });
            const d = await r.json();
            return d.contents;
        },
        async (url) => {
            const r = await fetch(`https://corsproxy.io/?${encodeURIComponent(url)}`, { signal: AbortSignal.timeout(10000) });
            return r.text();
        },
        async (url) => {
            const r = await fetch(`https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`, { signal: AbortSignal.timeout(10000) });
            return r.text();
        }
    ];

    let html = null;
    for (const tryProxy of proxies) {
        try {
            const result = await tryProxy(normalized);
            if (result && result.includes('pinimg')) { html = result; break; }
        } catch { continue; }
    }

    if (!html) {
        const isLocal = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
        throw new Error(isLocal
            ? 'I proxy CORS non funzionano su localhost. Funzionerà sulla versione online (Cloudflare).'
            : 'Tutti i proxy non disponibili. Riprova tra qualche secondo.');
    }

    // Unescape JSON-encoded backslashes: https:\/\/i.pinimg.com\/...
    const clean = html.replace(/\\\//g, '/');

    // --- Strategy 1: parse Pinterest's embedded JSON data ---
    // Pinterest embeds pin data in <script type="application/json"> tags.
    // Pin images always have { url, width, height } structure.
    // Profile pics, icons, and sidebar suggestions don't have this triplet.
    const jsonUrls = extractPinImagesFromJson(clean);

    // --- Strategy 2: Regex fallback (less accurate) ---
    let allUrls = jsonUrls.length >= 4 ? jsonUrls : [
        ...clean.matchAll(
            /https:\/\/i\.pinimg\.com\/(?:736x|originals|564x|474x)\/[\w\/\-]{10,}\.jpg/g
        )
    ].map(m => m[0]);

    // --- Deduplicate by image filename — keep highest resolution ---
    const PRIORITY = { originals: 5, '736x': 4, '564x': 3, '474x': 2, '236x': 1 };
    const bestByHash = new Map();
    for (const url of allUrls) {
        const filename = url.split('/').pop();
        const size = url.match(/pinimg\.com\/([\w]+)\//)?.[1] || '';
        const prio = PRIORITY[size] || 0;
        if (!bestByHash.has(filename) || prio > bestByHash.get(filename).prio) {
            bestByHash.set(filename, { url, prio });
        }
    }

    return [...bestByHash.values()].map(v => v.url);
}

// Recursively walk Pinterest's JSON to find pin image objects: {url, width, height}
function extractPinImagesFromJson(html) {
    const results = new Set();

    // Pinterest uses several script tag IDs across versions
    const scriptRegex = /<script[^>]+type="application\/json"[^>]*>([\s\S]*?)<\/script>/g;
    let match;
    while ((match = scriptRegex.exec(html)) !== null) {
        try {
            const data = JSON.parse(match[1]);
            walkForPinImages(data, results);
            if (results.size > 3) break; // Found actual pin data, stop
        } catch { /* not valid JSON, skip */ }
    }

    return [...results];
}

function walkForPinImages(node, results) {
    if (!node || typeof node !== 'object') return;

    // Pin image objects have url (pinimg.com) + width + height
    if (
        typeof node.url === 'string' &&
        node.url.includes('i.pinimg.com') &&
        node.url.endsWith('.jpg') &&
        typeof node.width === 'number' &&
        typeof node.height === 'number' &&
        node.width >= 236 // filter out tiny icons
    ) {
        results.add(node.url);
        return;
    }

    if (Array.isArray(node)) {
        for (const child of node) walkForPinImages(child, results);
    } else {
        for (const val of Object.values(node)) walkForPinImages(val, results);
    }
}

function openPinterestModal(images) {
    const grid = document.getElementById('pinterest-grid');
    grid.innerHTML = images.map(url => `
        <div class="pinterest-thumb" data-url="${url}"
            style="aspect-ratio:1; border-radius:12px; overflow:hidden; cursor:pointer; position:relative; border:3px solid transparent; transition:0.2s;"
            onclick="this.classList.toggle('selected'); updatePinterestCount();">
            <img src="${url}" style="width:100%; height:100%; object-fit:cover; pointer-events:none;" loading="lazy" />
            <div style="position:absolute; inset:0; background:rgba(0,255,163,0.35); display:flex; align-items:center; justify-content:center; font-size:1.8rem; opacity:0; transition:0.2s;" class="check-overlay">✓</div>
        </div>
    `).join('');

    // CSS for selected state via JS (simpler than stylesheet)
    document.querySelectorAll('.pinterest-thumb').forEach(el => {
        el.addEventListener('click', () => {
            const overlay = el.querySelector('.check-overlay');
            overlay.style.opacity = el.classList.contains('selected') ? '1' : '0';
            el.style.borderColor = el.classList.contains('selected') ? '#00ffa3' : 'transparent';
        });
    });

    updatePinterestCount();
    document.getElementById('modal-pinterest').classList.remove('hidden');
}

window.updatePinterestCount = () => {
    const n = document.querySelectorAll('.pinterest-thumb.selected').length;
    document.getElementById('pinterest-selection-count').innerText = n > 0 ? `${n} selezionate` : '';
};

init();
