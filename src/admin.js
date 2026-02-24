import { db } from './firebase';
import { collection, query, where, getDocs, orderBy, addDoc, setDoc, doc } from 'firebase/firestore';

// --- Admin Data Management ---
const AdminData = {
    getProjects() {
        return JSON.parse(localStorage.getItem('moorph_projects') || '[]');
    },
    saveProjects(projects) {
        localStorage.setItem('moorph_projects', JSON.stringify(projects));
    },
    async getResults(projectId) {
        try {
            const q = query(
                collection(db, 'results'),
                where('projectId', '==', projectId),
                orderBy('timestamp', 'desc')
            );
            const querySnapshot = await getDocs(q);
            return querySnapshot.docs.map(doc => doc.data());
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
function init() {
    renderProjectList();
    setupEventListeners();
}

function renderProjectList() {
    const projects = AdminData.getProjects();
    el.projectList.innerHTML = projects.map(p => `
    <li class="project-item ${activeProject?.id === p.id ? 'active' : ''}" onclick="selectProject('${p.id}')">
      <h3>${p.name}</h3>
      <p>${p.images.length} immagini</p>
    </li>
  `).join('');
}

window.selectProject = async (id) => {
    const projects = AdminData.getProjects();
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
window.removeImage = (idx) => {
    activeProject.images.splice(idx, 1);
    updateActiveProject();
};

function updateActiveProject() {
    const projects = AdminData.getProjects();
    const idx = projects.findIndex(p => p.id === activeProject.id);
    projects[idx] = activeProject;
    AdminData.saveProjects(projects);
    renderImages();
    renderProjectList();
}

function setupEventListeners() {
    document.getElementById('btn-create-project').addEventListener('click', () => {
        el.modalProject.classList.remove('hidden');
    });

    document.getElementById('btn-cancel').addEventListener('click', () => {
        el.modalProject.classList.add('hidden');
    });

    document.getElementById('btn-save-project').addEventListener('click', () => {
        const name = document.getElementById('new-project-name').value;
        const pass = document.getElementById('new-project-pass').value;

        if (!name || !pass) return alert('Inserisci nome e password');

        const newProject = {
            id: Math.random().toString(36).substr(2, 6), // Solo 6 caratteri per l'ID
            name,
            password: pass,
            images: []
        };

        const projects = AdminData.getProjects();
        projects.push(newProject);
        AdminData.saveProjects(projects);

        el.modalProject.classList.add('hidden');
        renderProjectList();
        selectProject(newProject.id);
    });

    document.getElementById('btn-delete-project').addEventListener('click', () => {
        if (!confirm('Sei sicuro di voler eliminare questo progetto?')) return;
        const projects = AdminData.getProjects();
        const filtered = projects.filter(p => p.id !== activeProject.id);
        AdminData.saveProjects(filtered);
        activeProject = null;
        el.projectDetail.classList.add('hidden');
        el.emptyState.classList.remove('hidden');
        renderProjectList();
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
