import { db } from './firebase';
import { collection, query, where, getDocs, orderBy, addDoc, setDoc, doc, deleteDoc } from 'firebase/firestore';

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
      <p>${(p.images || []).length} immagini • ID: ${p.id}</p>
    </li>
  `).join('');
}

window.selectProject = async (id) => {
    const projects = await AdminData.getProjects();
    activeProject = projects.find(p => p.id === id);

    el.emptyState.classList.add('hidden');
    el.projectDetail.classList.remove('hidden');

    document.getElementById('detail-name').innerText = activeProject.name;
    document.getElementById('edit-password').value = activeProject.password;

    const shareUrl = AdminData.generateShareLink(activeProject);
    document.getElementById('detail-url').innerText = `Link Pubblico: Pronto per la condivisione`;

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
        el.resultsSummary.innerHTML = '<p>Ancora nessun risultato per questo progetto.</p>';
        return;
    }

    el.resultsSummary.innerHTML = allSubmissions.map((submission, sIdx) => {
        const liked = submission.data.filter(r => r.liked);
        const date = new Date(submission.timestamp).toLocaleString();

        return `
            <div class="result-card glass-card" style="margin-bottom: 20px; padding: 15px;">
                <div class="stats" style="margin-bottom: 10px;">
                    <p><b>Utente ${allSubmissions.length - sIdx}</b> - ${date}</p>
                    <p><b>${liked.length}</b> Mi piace su ${submission.data.length} immagini</p>
                </div>
                <div class="liked-gallery" style="display: flex; flex-wrap: wrap; gap: 5px;">
                    ${liked.map(r => `<img src="${r.image}" style="width: 50px; height: 50px; object-fit: cover; border-radius: 4px;" />`).join('')}
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
    document.getElementById('btn-create-project').addEventListener('click', () => {
        el.modalProject.classList.remove('hidden');
    });

    document.getElementById('btn-cancel').addEventListener('click', () => {
        el.modalProject.classList.add('hidden');
    });

    document.getElementById('btn-save-project').addEventListener('click', async () => {
        const name = document.getElementById('new-project-name').value;
        const pass = document.getElementById('new-project-pass').value;

        if (!name || !pass) return alert('Inserisci nome e password');

        const newProject = {
            id: Math.random().toString(36).substr(2, 6), // Solo 6 caratteri per l'ID
            name,
            password: pass,
            images: []
        };

        const projects = await AdminData.getProjects();
        projects.push(newProject);
        AdminData.saveProjects(projects);
        await AdminData.syncProjectToFirebase(newProject);

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
        btn.innerText = 'Generando...';

        try {
            const url = await AdminData.generateShareLink(activeProject);
            navigator.clipboard.writeText(url);
            btn.innerText = originalText;
            alert('URL Ultra-Breve copiato!');
        } catch (err) {
            btn.innerText = originalText;
            alert('Errore Firebase: Controlla le "Rules" su Firebase Console o la tua connessione.');
            // Fallback estremo se proprio Firestore è giù
            const data = btoa(JSON.stringify(activeProject));
            navigator.clipboard.writeText(`${window.location.origin}/?d=${data}`);
        }
    });

    // Image Upload Mock
    document.getElementById('drop-zone').addEventListener('click', () => {
        // In a real app we'd trigger file input, here we'll just add some random images from Unsplash for the demo
        const demoImages = [
            'https://images.unsplash.com/photo-1549490349-8643362247b5?auto=format&fit=crop&w=800&q=80',
            'https://images.unsplash.com/photo-1574169208507-84376144848b?auto=format&fit=crop&w=800&q=80',
            'https://images.unsplash.com/photo-1618005198919-d3d4b5a92ead?auto=format&fit=crop&w=800&q=80',
            'https://images.unsplash.com/photo-1620641788421-7a1c342ea42e?auto=format&fit=crop&w=800&q=80'
        ];
        activeProject.images.push(...demoImages);
        updateActiveProject();
    });
}

init();
