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

            // Source of truth: remote projects from Firebase
            const merged = remote;
            this.saveProjects(merged);
            return merged;
        } catch (e) {
            console.error('Errore sync progetti:', e);
            return local;
        }
    },
    saveProjects(projects) {
        // Strip images before saving to localStorage projects list to avoid quota limits
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
            // ONLY sync metadata (name, password, etc.). 
            // NO IMAGES stored in Firebase anymore.
            const { images, ...meta } = project;
            await setDoc(doc(db, 'projects', project.id), {
                ...meta,
                updatedAt: new Date().toISOString()
            });

            // Cleanup: ensure the images sub-collection is empty if it exists
            const imagesRef = collection(db, 'projects', project.id, 'images');
            const existingSnap = await getDocs(imagesRef);
            for (const d of existingSnap.docs) {
                await deleteDoc(doc(db, 'projects', project.id, 'images', d.id));
            }
        } catch (e) {
            console.error('Errore durante il sync con Firebase:', e);
        }
    },
    async getProjectImages(projectId) {
        // We now fetch images only from local/github or they are carried in the object
        // Firestore is NO LONGER the source for images.
        return [];
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
            // Use specialized sync function to ensure sub-collections are correct
            await this.syncProjectToFirebase(project);
            return `${window.location.origin}/?s=${project.id}`;
        } catch (e) {
            console.error('Errore Firebase:', e);
            throw e;
        }
    },
    // --- Local Folder API (Local Dev Only) ---
    async createLocalFolder(id, name) {
        try {
            const resp = await fetch(`/api/folders/create?id=${id}&name=${encodeURIComponent(name)}`);
            return await resp.json();
        } catch (e) {
            console.warn('Local API non disponibile (normale in produzione)');
            return null;
        }
    },
    async getLocalImages(id) {
        try {
            const resp = await fetch(`/api/folders/list?id=${id}`);
            if (!resp.ok) return null;
            return await resp.json();
        } catch (e) {
            return null;
        }
    },
    async uploadLocalImage(projectId, file) {
        try {
            const resp = await fetch(`/api/uploads/save?id=${projectId}&name=${encodeURIComponent(file.name)}`, {
                method: 'POST',
                body: file
            });
            return await resp.json();
        } catch (e) {
            return null;
        }
    },
    async deleteLocalImage(projectId, url) {
        try {
            const fileName = url.split('/').pop();
            await fetch(`/api/uploads/delete?id=${projectId}&name=${encodeURIComponent(fileName)}`, { method: 'DELETE' });
        } catch (e) { }
    },
    async uploadToGitHub(projectId, file) {
        const config = JSON.parse(localStorage.getItem('moorph_gh_config') || '{}');
        if (!config.token || !config.owner || !config.repo) {
            console.warn('GitHub Config non completa.');
            return null;
        }

        try {
            const path = `public/projects/${projectId}/${file.name}`;
            const reader = new FileReader();
            const content = await new Promise((resolve) => {
                reader.onload = () => resolve(reader.result.split(',')[1]);
                reader.readAsDataURL(file);
            });

            // 1. Try to get existing file to get SHA (needed for updates, though we usually add new)
            let sha = null;
            try {
                const getResp = await fetch(`https://api.github.com/repos/${config.owner}/${config.repo}/contents/${path}`, {
                    headers: { 'Authorization': `token ${config.token}` }
                });
                if (getResp.ok) {
                    const existing = await getResp.json();
                    sha = existing.sha;
                }
            } catch (e) { }

            // 2. Put file to GitHub
            const resp = await fetch(`https://api.github.com/repos/${config.owner}/${config.repo}/contents/${path}`, {
                method: 'PUT',
                headers: {
                    'Authorization': `token ${config.token}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    message: `Upload image for project ${projectId} via Moorph Admin`,
                    content: content,
                    sha: sha // Only if updating
                })
            });

            if (!resp.ok) throw new Error('GitHub API Error');
            const data = await resp.json();
            return { success: true, url: `/projects/${projectId}/${file.name}` };
        } catch (e) {
            console.error('Errore GitHub upload:', e);
            return null;
        }
    },
    async getGitHubImages(projectId) {
        const config = JSON.parse(localStorage.getItem('moorph_gh_config') || '{}');
        if (!config.token || !config.owner || !config.repo) return null;

        try {
            const path = `public/projects/${projectId}`;
            const resp = await fetch(`https://api.github.com/repos/${config.owner}/${config.repo}/contents/${path}`, {
                headers: { 'Authorization': `token ${config.token}` }
            });

            if (!resp.ok) return null;

            const data = await resp.json();
            if (Array.isArray(data)) {
                return data
                    .filter(file => /\.(jpg|jpeg|png|webp|gif|svg)$/i.test(file.name))
                    .map(file => `/projects/${projectId}/${file.name}`);
            }
            return null;
        } catch (e) {
            console.error('Errore recupero immagini da GitHub:', e);
            return null;
        }
    },
    async deleteFromGitHub(projectId, url) {
        const config = JSON.parse(localStorage.getItem('moorph_gh_config') || '{}');
        if (!config.token || !config.owner || !config.repo) return;

        try {
            const fileName = url.split('/').pop();
            const path = `public/projects/${projectId}/${fileName}`;

            // 1. Get SHA
            const getResp = await fetch(`https://api.github.com/repos/${config.owner}/${config.repo}/contents/${path}`, {
                headers: { 'Authorization': `token ${config.token}` }
            });
            if (!getResp.ok) return;
            const fileData = await getResp.json();

            // 2. Delete
            await fetch(`https://api.github.com/repos/${config.owner}/${config.repo}/contents/${path}`, {
                method: 'DELETE',
                headers: {
                    'Authorization': `token ${config.token}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    message: `Delete image from project ${projectId} via Moorph Admin`,
                    sha: fileData.sha
                })
            });
        } catch (e) {
            console.error('Errore eliminazione GitHub:', e);
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
    resultsSummary: document.getElementById('results-summary'),
    localFolderInfo: document.getElementById('local-folder-info'),
    modalSettings: document.getElementById('modal-settings'),
    bulkActionsBar: document.getElementById('bulk-actions-bar'),
    selectedCount: document.getElementById('selected-count'),
    uploadPrompt: document.getElementById('upload-prompt'),
    uploadProgressContainer: document.getElementById('upload-progress-container'),
    uploadProgressBar: document.getElementById('upload-progress-bar'),
    uploadStatusText: document.getElementById('upload-status-text')
};

let selectedImages = new Set();

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

    // Fetch images: Source of Truth
    // 1. Try local folder (Local Dev)
    const localData = await AdminData.getLocalImages(id);

    if (localData && localData.images) {
        activeProject.images = localData.images;
    } else {
        // 2. Try GitHub (Online Admin)
        const ghImages = await AdminData.getGitHubImages(id);
        if (ghImages) {
            activeProject.images = ghImages;
        } else {
            activeProject.images = activeProject.images || [];
        }
    }

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

    // Check for local folder
    const localFolder = await AdminData.getLocalImages(id);
    if (localFolder) {
        el.localFolderInfo.style.display = 'block';
        el.localFolderInfo.innerText = `📂 Cartella: public/projects/${id}`;
    } else {
        el.localFolderInfo.style.display = 'none';
    }
};

function renderImages() {
    el.imageGrid.innerHTML = activeProject.images.map((img, idx) => {
        const isSelected = selectedImages.has(img);
        return `
            <div class="image-card ${isSelected ? 'selected' : ''}" onclick="toggleImageSelection('${img.replace(/'/g, "\\'")}')">
                <img src="${img}" style="pointer-events:none;" />
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
                    ${liked.map(r => `<img src="${r.image}" onclick="openLightbox('${r.image.replace(/'/g, "\\'")}')" style="width:50px; height:50px; object-fit:cover; border-radius:10px; border:1px solid rgba(0,255,163,0.4); cursor:pointer; transition: transform 0.2s;" onmouseover="this.style.transform='scale(1.1)'" onmouseout="this.style.transform='scale(1)'" />`).join('')}
                </div>
            </div>
        `;
    }).join('');
}

// --- Actions ---
window.removeImage = async (idx) => {
    const url = activeProject.images[idx];
    if (confirm('Eliminare definitivamente questa immagine anche dal disco/GitHub?')) {
        // 1. Physical deletion
        await AdminData.deleteLocalImage(activeProject.id, url);
        await AdminData.deleteFromGitHub(activeProject.id, url);

        // 2. State update
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

        // Local folder creation (System requested by user)
        await AdminData.createLocalFolder(newProject.id, newProject.name);

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

    // Process image: Try to upload locally (if dev), then GitHub (if configured), then base64
    async function processImage(file) {
        // 1. Try Local Upload (Zero compression, works only on localhost)
        const local = await AdminData.uploadLocalImage(activeProject.id, file);
        if (local && local.success) {
            return local.url;
        }

        // 2. Try GitHub Upload (If configured)
        const gh = await AdminData.uploadToGitHub(activeProject.id, file);
        if (gh && gh.success) {
            return gh.url;
        }

        // 3. Last fallback: Full-quality Base64
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });
    }

    document.getElementById('file-input').addEventListener('change', async (e) => {
        const files = Array.from(e.target.files);
        if (!files.length) return;

        const zone = document.getElementById('drop-zone');
        el.uploadPrompt.classList.add('hidden');
        el.uploadProgressContainer.classList.remove('hidden');
        zone.style.pointerEvents = 'none';

        try {
            const results = [];
            for (let i = 0; i < files.length; i++) {
                const percent = Math.round(((i) / files.length) * 100);
                el.uploadProgressBar.style.width = `${percent}%`;
                el.uploadStatusText.innerText = `Caricamento immagine ${i + 1} di ${files.length}... (${percent}%)`;

                const res = await processImage(files[i]);
                results.push(res);
            }

            el.uploadProgressBar.style.width = '100%';
            el.uploadStatusText.innerText = 'Completato!';

            activeProject.images.push(...results);
            await updateActiveProject();
        } catch (err) {
            console.error('Errore upload:', err);
            alert('Errore durante il caricamento delle immagini.');
        } finally {
            setTimeout(() => {
                el.uploadPrompt.classList.remove('hidden');
                el.uploadProgressContainer.classList.add('hidden');
                el.uploadProgressBar.style.width = '0%';
                zone.style.pointerEvents = '';
                e.target.value = '';
            }, 1000);
        }
    });

    // Local Folder Sync (Full Sync)
    document.getElementById('btn-sync-folder').addEventListener('click', async () => {
        const btn = document.getElementById('btn-sync-folder');
        btn.innerText = '⌛ Sincronizzazione...';
        btn.disabled = true;

        try {
            // 1. Try Local Sync
            const local = await AdminData.getLocalImages(activeProject.id);
            if (local && local.images) {
                activeProject.images = local.images;
                await updateActiveProject();
                alert(`Sincronizzazione locale completata! Trovate ${local.images.length} immagini.`);
            } else {
                // 2. Try GitHub Sync (if local fails, we might be online)
                const ghImages = await AdminData.getGitHubImages(activeProject.id);
                if (ghImages) {
                    activeProject.images = ghImages;
                    await updateActiveProject();
                    alert(`Sincronizzazione GitHub completata! Trovate ${ghImages.length} immagini.`);
                } else {
                    alert('Impossibile accedere alla cartella locale o a GitHub.\nVerifica la configurazione nelle impostazioni.');
                }
            }
        } catch (e) {
            alert('Errore durante la sincronizzazione.');
        } finally {
            btn.innerText = '🛸 Sincronizza Cartella';
            btn.disabled = false;
        }
    });

    // --- GitHub Settings ---
    const loadGHConfig = () => {
        const config = JSON.parse(localStorage.getItem('moorph_gh_config') || '{"owner":"blindblues","repo":"Moorph"}');
        document.getElementById('gh-token').value = config.token || '';
        document.getElementById('gh-owner').value = config.owner || '';
        document.getElementById('gh-repo').value = config.repo || '';
    };

    document.getElementById('btn-settings').addEventListener('click', () => {
        loadGHConfig();
        el.modalSettings.classList.remove('hidden');
    });

    document.getElementById('btn-close-settings').addEventListener('click', () => {
        el.modalSettings.classList.add('hidden');
    });

    document.getElementById('btn-save-settings').addEventListener('click', () => {
        const config = {
            token: document.getElementById('gh-token').value.trim(),
            owner: document.getElementById('gh-owner').value.trim(),
            repo: document.getElementById('gh-repo').value.trim()
        };
        localStorage.setItem('moorph_gh_config', JSON.stringify(config));
        alert('Configurazione GitHub salvata localmente nel browser!');
        el.modalSettings.classList.add('hidden');
    });

    // --- Bulk Actions ---
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
        if (!confirm(`Sei sicuro di voler eliminare definitivamente ${count} immagini?`)) return;

        const btn = document.getElementById('btn-delete-selected');
        btn.disabled = true;
        btn.innerText = '⌛ Eliminazione...';

        try {
            const toDelete = Array.from(selectedImages);
            for (const url of toDelete) {
                await AdminData.deleteLocalImage(activeProject.id, url);
                await AdminData.deleteFromGitHub(activeProject.id, url);
                activeProject.images = activeProject.images.filter(img => img !== url);
            }
            selectedImages.clear();
            updateBulkBar();
            await updateActiveProject();
            alert(`Eliminate ${count} immagini con successo!`);
        } catch (e) {
            alert('Errore durante l\'eliminazione multipla.');
        } finally {
            btn.disabled = false;
            btn.innerText = '🗑 Elimina Selezionati';
        }
    });

}


init();
