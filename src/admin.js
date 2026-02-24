import { db } from './firebase';
import { collection, query, where, getDocs, addDoc, setDoc, doc, deleteDoc } from 'firebase/firestore';

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
    document.getElementById('detail-url').innerText = `/?s=${activeProject.id}`;
    document.getElementById('image-count').innerText = `${activeProject.images.length} immagini`;

    renderImages();
    await renderResults();
    renderProjectList();
};

function renderImages() {
    el.imageGrid.innerHTML = activeProject.images.map((img, idx) => `
    <div class="image-card">
      <img src="${img}" />
      <button class="remove-btn" onclick="removeImage(${idx})">×</button>
    </div>
  `).join('');
}

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
        btn.innerText = '⏳ Generando...';

        try {
            const url = await AdminData.generateShareLink(activeProject);
            navigator.clipboard.writeText(url);
            btn.innerText = '✅ Copiato!';
            setTimeout(() => btn.innerText = originalText, 2000);
        } catch (err) {
            btn.innerText = originalText;
            alert('Errore Firebase: Controlla le "Rules" su Firebase Console o la tua connessione.');
            const data = btoa(JSON.stringify(activeProject));
            navigator.clipboard.writeText(`${window.location.origin}/?d=${data}`);
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
}

init();
