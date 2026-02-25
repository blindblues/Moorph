import { db } from './firebase';
import { collection, query, where, getDocs, setDoc, doc, deleteDoc } from 'firebase/firestore';
import { makeZoomable } from './zoom.js';

// --- Clipboard Helper ---
async function copyToClipboard(text) {
    if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        return;
    }
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;font-size:16px;';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    try {
        document.execCommand('copy');
    } finally {
        document.body.removeChild(ta);
    }
}

// --- Admin Data Management (URL Only) ---
const AdminData = {
    async getProjects() {
        const local = JSON.parse(localStorage.getItem('moorph_projects') || '[]');
        try {
            const querySnapshot = await getDocs(collection(db, 'projects'));
            const remote = querySnapshot.docs.map(doc => doc.data());
            const merged = remote;
            this.saveProjects(merged);
            return merged;
        } catch (e) {
            console.error('Errore sync progetti:', e);
            return local;
        }
    },
    saveProjects(projects) {
        const cleanProjects = projects.map(p => {
            const { images, ...meta } = p;
            return meta;
        });
        localStorage.setItem('moorph_projects', JSON.stringify(cleanProjects));
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
            // IMAGES ARE NOW SAVED DIRECTLY IN THE PROJECT OBJECT AS URLs
            await setDoc(doc(db, 'projects', project.id), {
                ...project,
                updatedAt: new Date().toISOString()
            });
        } catch (e) {
            console.error('Errore durante il sync con Firebase:', e);
        }
    },
    async getResults(projectId) {
        try {
            const q = query(
                collection(db, 'results'),
                where('projectId', '==', projectId)
            );
            const querySnapshot = await getDocs(q);
            return querySnapshot.docs
                .map(doc => doc.data())
                .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
        } catch (e) {
            console.error('Errore nel recupero dei risultati:', e);
            return [];
        }
    }
};

let activeProject = null;
let selectedImages = new Set();

// --- DOM Elements ---
const el = {
    sidebar: document.getElementById('admin-sidebar'),
    projectList: document.getElementById('project-list'),
    projectDetail: document.getElementById('project-detail'),
    emptyState: document.getElementById('empty-state'),
    modalProject: document.getElementById('modal-project'),
    imageGrid: document.getElementById('image-grid'),
    resultsSummary: document.getElementById('results-summary'),
    bulkActionsBar: document.getElementById('bulk-actions-bar'),
    selectedCount: document.getElementById('selected-count'),
    imageUrlInput: document.getElementById('image-url-input'),
    btnAddUrl: document.getElementById('btn-add-url')
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

    selectedImages.clear();
    updateBulkBar();

    // Images are now part of project metadata in this version
    activeProject.images = activeProject.images || [];

    el.emptyState.classList.add('hidden');
    el.projectDetail.classList.remove('hidden');

    if (window.innerWidth <= 768) {
        el.sidebar.classList.add('hidden-mobile');
        el.projectDetail.classList.remove('hidden-mobile');
    }

    document.getElementById('detail-name').innerText = activeProject.name;
    document.getElementById('detail-id').innerText = activeProject.id;
    document.getElementById('edit-password').value = activeProject.password || '';
    document.getElementById('image-count').innerText = `${activeProject.images.length} immagini`;

    const shortUrl = `${window.location.origin}/?s=${activeProject.id}`;
    document.getElementById('share-link-input').value = shortUrl;

    renderImages();
    await renderResults();
    renderProjectList();
};

function renderImages() {
    if (!activeProject.images || activeProject.images.length === 0) {
        el.imageGrid.innerHTML = '<p style="color:var(--text-dim); grid-column: 1/-1; text-align: center; padding: 40px;">Nessuna immagine in questo progetto.</p>';
        return;
    }
    el.imageGrid.innerHTML = activeProject.images.map((img, idx) => {
        const isSelected = selectedImages.has(img);
        return `
            <div class="image-card ${isSelected ? 'selected' : ''}" onclick="toggleImageSelection('${img.replace(/'/g, "\\'")}')">
                <img src="${img}" style="pointer-events:none;" onerror="this.src='/vite.svg'; this.style.opacity=0.3;" />
                <div class="selection-overlay">
                    <div class="checkbox ${isSelected ? 'checked' : ''}"></div>
                </div>
                <button class="remove-btn" onclick="event.stopPropagation(); removeImage(${idx})">×</button>
            </div>
        `;
    }).join('');
}

window.toggleImageSelection = (url) => {
    if (selectedImages.has(url)) {
        selectedImages.delete(url);
    } else {
        selectedImages.add(url);
    }
    updateBulkBar();
    renderImages();
};

function updateBulkBar() {
    if (selectedImages.size > 0) {
        el.bulkActionsBar.classList.remove('hidden');
        el.bulkActionsBar.style.display = 'flex';
        el.selectedCount.innerText = `${selectedImages.size} selezionati`;
    } else {
        el.bulkActionsBar.classList.add('hidden');
        el.bulkActionsBar.style.display = 'none';
    }
}

let lightboxCleanup = null;
window.openLightbox = (src) => {
    const overlay = document.getElementById('lightbox-overlay');
    const img = document.getElementById('lightbox-img');
    img.src = src;
    overlay.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
    if (lightboxCleanup) lightboxCleanup();
    lightboxCleanup = makeZoomable(img, overlay);
};

window.closeLightbox = () => {
    const overlay = document.getElementById('lightbox-overlay');
    overlay.classList.add('hidden');
    document.body.style.overflow = '';
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
        return `
            <div class="result-card">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
                    <strong>👤 Utente ${allSubmissions.length - sIdx}</strong>
                    <span style="font-size:0.8rem; color:var(--text-dim);">${date}</span>
                </div>
                <div style="display:flex; flex-wrap:wrap; gap:6px;">
                    ${liked.map(r => `<img src="${r.image}" onclick="openLightbox('${r.image.replace(/'/g, "\\'")}')" style="width:50px; height:50px; object-fit:cover; border-radius:10px; border:1px solid var(--secondary); cursor:pointer;" />`).join('')}
                </div>
            </div>
        `;
    }).join('');
}

// --- Actions ---
window.removeImage = async (idx) => {
    if (confirm('Rimuovere questa immagine dal progetto?')) {
        activeProject.images.splice(idx, 1);
        await updateActiveProject();
    }
};

async function updateActiveProject() {
    const projects = await AdminData.getProjects();
    const idx = projects.findIndex(p => p.id === activeProject.id);
    projects[idx] = activeProject;
    AdminData.saveProjects(projects);
    await AdminData.syncProjectToFirebase(activeProject);
    document.getElementById('image-count').innerText = `${activeProject.images.length} immagini`;
    renderImages();
    await renderProjectList();
}

function setupEventListeners() {
    document.getElementById('btn-back').addEventListener('click', () => {
        el.projectDetail.classList.add('hidden');
        el.sidebar.classList.remove('hidden-mobile');
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
        await renderProjectList();
    });

    document.getElementById('btn-copy-url').addEventListener('click', async () => {
        const btn = document.getElementById('btn-copy-url');
        const originalText = btn.innerText;
        const input = document.getElementById('share-link-input');
        input.select();
        try {
            await copyToClipboard(input.value);
            btn.innerText = '✅ Copiato!';
            setTimeout(() => btn.innerText = originalText, 2000);
        } catch (e) {
            btn.innerText = '⚠️ Errore';
            setTimeout(() => btn.innerText = originalText, 2000);
        }
    });

    // --- URL IMAGE ADDITION ---
    el.btnAddUrl.addEventListener('click', async () => {
        const url = el.imageUrlInput.value.trim();
        if (!url) return;
        if (!activeProject) return alert('Seleziona un progetto prima.');

        activeProject.images.push(url);
        el.imageUrlInput.value = '';
        await updateActiveProject();
    });

    el.imageUrlInput.addEventListener('keypress', async (e) => {
        if (e.key === 'Enter') {
            el.btnAddUrl.click();
        }
    });

    // --- BULK ACTIONS ---
    document.getElementById('btn-select-all').addEventListener('click', () => {
        activeProject.images.forEach(img => selectedImages.add(img));
        updateBulkBar();
        renderImages();
    });

    document.getElementById('btn-deselect-all').addEventListener('click', () => {
        selectedImages.clear();
        updateBulkBar();
        renderImages();
    });

    document.getElementById('btn-delete-selected').addEventListener('click', async () => {
        const count = selectedImages.size;
        if (!confirm(`Rimuovere ${count} immagini dal progetto?`)) return;

        activeProject.images = activeProject.images.filter(img => !selectedImages.has(img));
        selectedImages.clear();
        updateBulkBar();
        await updateActiveProject();
    });
}

init();
