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
    ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
}

// --- Admin Data Management (Lightweight) ---
const AdminData = {
    async getProjects() {
        try {
            const querySnapshot = await getDocs(collection(db, 'projects'));
            const proj = querySnapshot.docs.map(doc => doc.data());
            localStorage.setItem('moorph_projects', JSON.stringify(proj.map(({ images, ...m }) => m)));
            return proj;
        } catch (e) {
            return JSON.parse(localStorage.getItem('moorph_projects') || '[]');
        }
    },
    async deleteProject(id) {
        await deleteDoc(doc(db, 'projects', id));
    },
    async syncProject(project) {
        await setDoc(doc(db, 'projects', project.id), {
            ...project,
            updatedAt: new Date().toISOString()
        });
    },
    async getResults(projectId) {
        const q = query(collection(db, 'results'), where('projectId', '==', projectId));
        const snap = await getDocs(q);
        return snap.docs.map(d => ({ id: d.id, ...d.data() }))
            .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    },
    async deleteResult(id) {
        await deleteDoc(doc(db, 'results', id));
    }
};

let activeProject = null;
let selectedImages = new Set();

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

async function init() {
    await renderProjectList();
    setupEventListeners();
}

async function renderProjectList() {
    const projects = await AdminData.getProjects();
    el.projectList.innerHTML = projects.map(p => `
        <li class="project-item ${activeProject?.id === p.id ? 'active' : ''}" onclick="selectProject('${p.id}')">
            <h3>${p.name || 'Senza nome'}</h3>
            <p style="font-size:0.7rem; opacity:0.6;">ID: ${p.id}</p>
        </li>
    `).join('');
}

window.selectProject = async (id) => {
    const projects = await AdminData.getProjects();
    activeProject = projects.find(p => p.id === id);
    if (!activeProject) return;

    selectedImages.clear();
    updateBulkBar();
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
    document.getElementById('share-link-input').value = `${window.location.origin}/?s=${activeProject.id}`;

    renderImages();
    await renderResults();
    renderProjectList();
};

function renderImages() {
    if (!activeProject.images?.length) {
        el.imageGrid.innerHTML = '<p style="grid-column:1/-1;text-align:center;padding:40px;opacity:0.5;">Nessuna immagine.</p>';
        return;
    }
    el.imageGrid.innerHTML = activeProject.images.map((img, idx) => {
        const sel = selectedImages.has(img);
        return `
            <div class="image-card ${sel ? 'selected' : ''}" onclick="toggleImageSelection('${img.replace(/'/g, "\\'")}')">
                <img src="${img}" style="width:100%;height:100%;object-fit:cover;" onerror="this.style.opacity=0.2" />
                <button class="remove-btn" onclick="event.stopPropagation(); removeImage(${idx})">×</button>
            </div>
        `;
    }).join('');
}

window.toggleImageSelection = (url) => {
    selectedImages.has(url) ? selectedImages.delete(url) : selectedImages.add(url);
    updateBulkBar();
    renderImages();
};

function updateBulkBar() {
    const show = selectedImages.size > 0;
    el.bulkActionsBar.classList.toggle('hidden', !show);
    el.selectedCount.innerText = `${selectedImages.size} selezionati`;
}

// Results Utility
async function renderResults() {
    const results = await AdminData.getResults(activeProject.id);
    if (!results.length) {
        el.resultsSummary.innerHTML = '<p style="opacity:0.5;">Nessun risultato.</p>';
        return;
    }
    el.resultsSummary.innerHTML = results.map((res, i) => `
        <div class="result-card">
            <div style="display:flex;justify-content:space-between;margin-bottom:15px;font-size:0.9rem;">
                <strong>👤 Utente ${results.length - i}</strong>
                <button onclick="deleteSubmission('${res.id}')" style="background:none;border:none;color:var(--accent);cursor:pointer;">Elimina</button>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:15px;">
                <div>
                   <label style="color:#00ffa3;font-size:0.7rem;display:block;margin-bottom:5px;">LIKE</label>
                   <div style="display:flex;flex-wrap:wrap;gap:4px;">
                     ${res.data.filter(x => x.liked).map(x => `<img src="${x.image}" onclick="window.open('${x.image}')"  style="width:35px;height:35px;object-fit:cover;border-radius:6px;cursor:pointer;" />`).join('')}
                   </div>
                </div>
                <div>
                   <label style="color:var(--accent);font-size:0.7rem;display:block;margin-bottom:5px;">NOPE</label>
                   <div style="display:flex;flex-wrap:wrap;gap:4px;">
                     ${res.data.filter(x => !x.liked).map(x => `<img src="${x.image}"  style="width:35px;height:35px;object-fit:cover;border-radius:6px;opacity:0.4;" />`).join('')}
                   </div>
                </div>
            </div>
        </div>
    `).join('');
}

window.deleteSubmission = async (id) => {
    if (confirm('Eliminare questo report?')) {
        await AdminData.deleteResult(id);
        await renderResults();
    }
};

window.removeImage = async (idx) => {
    if (confirm('Rimuovere immagine?')) {
        activeProject.images.splice(idx, 1);
        await updateActiveProject();
    }
};

async function updateActiveProject() {
    await AdminData.syncProject(activeProject);
    renderImages();
    document.getElementById('image-count').innerText = `${activeProject.images.length} immagini`;
}

function setupEventListeners() {
    document.getElementById('btn-back').onclick = () => {
        el.projectDetail.classList.add('hidden');
        el.sidebar.classList.remove('hidden-mobile');
        activeProject = null;
    };

    document.getElementById('btn-create-project').onclick = () => el.modalProject.classList.remove('hidden');
    document.getElementById('btn-cancel').onclick = () => el.modalProject.classList.add('hidden');

    document.getElementById('btn-save-project').onclick = async () => {
        const name = document.getElementById('new-project-name').value.trim();
        const pass = document.getElementById('new-project-pass').value.trim();
        if (!name || !pass) return;

        const p = { id: Math.random().toString(36).substr(2, 6), name, password: pass, images: [] };
        await AdminData.syncProject(p);
        el.modalProject.classList.add('hidden');
        await renderProjectList();
        await selectProject(p.id);
    };

    document.getElementById('btn-delete-project').onclick = async () => {
        if (!confirm('Eliminare progetto?')) return;
        await AdminData.deleteProject(activeProject.id);
        activeProject = null;
        el.projectDetail.classList.add('hidden');
        el.emptyState.classList.remove('hidden');
        await renderProjectList();
    };

    document.getElementById('btn-copy-url').onclick = async () => {
        await copyToClipboard(document.getElementById('share-link-input').value);
        alert('Link copiato!');
    };

    el.btnAddUrl.onclick = async () => {
        const url = el.imageUrlInput.value.trim();
        if (!url || !activeProject) return;
        activeProject.images.push(url);
        el.imageUrlInput.value = '';
        await updateActiveProject();
    };

    document.getElementById('btn-select-all').onclick = () => {
        activeProject.images.forEach(i => selectedImages.add(i));
        updateBulkBar(); renderImages();
    };

    document.getElementById('btn-deselect-all').onclick = () => {
        selectedImages.clear(); updateBulkBar(); renderImages();
    };

    document.getElementById('btn-delete-selected').onclick = async () => {
        if (!confirm(`Rimuovere ${selectedImages.size} immagini?`)) return;
        activeProject.images = activeProject.images.filter(i => !selectedImages.has(i));
        selectedImages.clear(); updateBulkBar(); await updateActiveProject();
    };
}

init();
