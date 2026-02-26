let currentMode = 'structured';

document.addEventListener('DOMContentLoaded', () => {
    // Eseménykezelők hozzáadása a gombokhoz
    const structuredBtn = document.getElementById('structuredModeBtn');
    const bulkBtn = document.getElementById('bulkModeBtn');

    if (structuredBtn) {
        structuredBtn.addEventListener('click', () => switchMode('structured'));
    }
    if (bulkBtn) {
        bulkBtn.addEventListener('click', () => switchMode('bulk'));
    }

    // Kezdeti üres mezők hozzáadása
    addExperience();
    addEducation();

    // PayPal Előkészítés (Jövőbeli használatra)
    /*
    const initPayPal = () => {
        console.log("PayPal SDK Kész");
    };
    initPayPal();
    */
});

function switchMode(mode) {
    try {
        currentMode = mode;
        const structuredBtn = document.getElementById('structuredModeBtn');
        const bulkBtn = document.getElementById('bulkModeBtn');
        const structuredSections = document.getElementById('structuredSections');
        const bulkSection = document.getElementById('bulkSection');

        if (!structuredBtn || !bulkBtn || !structuredSections || !bulkSection) {
            console.error('Hiányzó DOM elemek a módváltáshoz.');
            return;
        }

        if (mode === 'structured') {
            structuredBtn.classList.add('mode-active');
            structuredBtn.classList.remove('text-gray-500');
            bulkBtn.classList.remove('mode-active');
            bulkBtn.classList.add('text-gray-500');
            structuredSections.classList.remove('hidden');
            bulkSection.classList.add('hidden');
        } else {
            bulkBtn.classList.add('mode-active');
            bulkBtn.classList.remove('text-gray-500');
            structuredBtn.classList.remove('mode-active');
            structuredBtn.classList.add('text-gray-500');
            bulkSection.classList.remove('hidden');
            structuredSections.classList.add('hidden');

            // Görgetés a szabad szöveg mezőhöz, hogy a felhasználó biztosan lássa
            setTimeout(() => {
                bulkSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }, 100);
        }
    } catch (error) {
        console.error('Hiba a módváltás során:', error);
    }
}

function addExperience() {
    const container = document.getElementById('experienceList');
    const div = document.createElement('div');
    div.className = 'experience-entry group';
    div.innerHTML = `
        <button type="button" class="remove-btn opacity-0 group-hover:opacity-100 transition-opacity" onclick="this.parentElement.remove()">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M6 18L18 6M6 6l12 12"></path></svg>
        </button>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <input type="text" placeholder="Cégnév" class="p-3 bg-white border-2 border-gray-200 rounded-lg company focus:border-brand-black focus:shadow-neobrutalist outline-none transition-all font-bold" required>
            <input type="text" placeholder="Pozíció" class="p-3 bg-white border-2 border-gray-200 rounded-lg title focus:border-brand-black focus:shadow-neobrutalist outline-none transition-all font-bold" required>
            <input type="text" placeholder="Időtartam (pl. 2020 - Jelenleg)" class="p-3 bg-white border-2 border-gray-200 rounded-lg duration focus:border-brand-black focus:shadow-neobrutalist outline-none transition-all font-medium">
            <input type="text" placeholder="Helyszín" class="p-3 bg-white border-2 border-gray-200 rounded-lg location focus:border-brand-black focus:shadow-neobrutalist outline-none transition-all font-medium">
        </div>
        <textarea placeholder="Főbb feladatok és eredmények" class="w-full mt-3 p-3 bg-white border-2 border-gray-200 rounded-lg description focus:border-brand-black focus:shadow-neobrutalist outline-none transition-all font-medium" rows="3"></textarea>
    `;
    container.appendChild(div);
}

function addEducation() {
    const container = document.getElementById('educationList');
    const div = document.createElement('div');
    div.className = 'education-entry group';
    div.innerHTML = `
        <button type="button" class="remove-btn opacity-0 group-hover:opacity-100 transition-opacity" onclick="this.parentElement.remove()">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M6 18L18 6M6 6l12 12"></path></svg>
        </button>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <input type="text" placeholder="Intézmény" class="p-3 bg-white border-2 border-gray-200 rounded-lg institution focus:border-brand-black focus:shadow-neobrutalist outline-none transition-all font-bold" required>
            <input type="text" placeholder="Végzettség / Megnevezés" class="p-3 bg-white border-2 border-gray-200 rounded-lg degree focus:border-brand-black focus:shadow-neobrutalist outline-none transition-all font-bold" required>
            <input type="text" placeholder="Végzés éve" class="p-3 bg-white border-2 border-gray-200 rounded-lg year focus:border-brand-black focus:shadow-neobrutalist outline-none transition-all font-medium">
            <input type="text" placeholder="Szak" class="p-3 bg-white border-2 border-gray-200 rounded-lg field focus:border-brand-black focus:shadow-neobrutalist outline-none transition-all font-medium">
        </div>
    `;
    container.appendChild(div);
}

document.getElementById('cvForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const loadingOverlay = document.getElementById('loadingOverlay');
    loadingOverlay.classList.remove('hidden');

    try {
        const formData = new FormData(e.target);
        const userData = {
            fullName: formData.get('fullName'),
            email: formData.get('email'),
            phone: formData.get('phone'),
            location: formData.get('location'),
            mode: currentMode
        };

        if (currentMode === 'structured') {
            userData.summary = formData.get('summary');
            userData.skills = formData.get('skills');
            userData.experience = [];
            userData.education = [];

            // Tapasztalatok összegyűjtése
            document.querySelectorAll('.experience-entry').forEach(entry => {
                const company = entry.querySelector('.company').value;
                const title = entry.querySelector('.title').value;
                if (company || title) {
                    userData.experience.push({
                        company: company,
                        title: title,
                        duration: entry.querySelector('.duration').value,
                        location: entry.querySelector('.location').value,
                        description: entry.querySelector('.description').value
                    });
                }
            });

            // Tanulmányok összegyűjtése
            document.querySelectorAll('.education-entry').forEach(entry => {
                const institution = entry.querySelector('.institution').value;
                const degree = entry.querySelector('.degree').value;
                if (institution || degree) {
                    userData.education.push({
                        institution: institution,
                        degree: degree,
                        year: entry.querySelector('.year').value,
                        field: entry.querySelector('.field').value
                    });
                }
            });
        } else {
            userData.bulkData = formData.get('bulkData');
        }

        const theme = document.getElementById('theme').value;
        const profilePicture = document.getElementById('profilePicture').files[0];

        if (profilePicture && profilePicture.size > 4 * 1024 * 1024) {
            alert('A profilkép túl nagy. Kérlek válassz 4MB-nál kisebb képet.');
            loadingOverlay.classList.add('hidden');
            return;
        }

        const payload = new FormData();
        payload.append('userData', JSON.stringify(userData));
        payload.append('theme', theme);
        if (profilePicture) {
            payload.append('profilePicture', profilePicture);
        }

        const response = await fetch('/api/generate-cv', {
            method: 'POST',
            body: payload
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(errorText || 'Hiba történt a generálás során');
        }

        const htmlContent = await response.text();
        displayCV(htmlContent);
    } catch (error) {
        console.error('Hiba:', error);
        alert('Hiba történt: ' + error.message);
    } finally {
        loadingOverlay.classList.add('hidden');
    }
});

function displayCV(html) {
    const container = document.getElementById('previewContainer');
    container.innerHTML = ''; // Helyőrző törlése

    const iframe = document.createElement('iframe');
    container.appendChild(iframe);

    const doc = iframe.contentWindow.document;
    doc.open();
    doc.write(html);
    doc.close();

    document.getElementById('downloadPdf').classList.remove('hidden');

    // Mobilnézeten görgetés az előnézethez
    if (window.innerWidth < 1024) {
        container.scrollIntoView({ behavior: 'smooth' });
    }
}

document.getElementById('downloadPdf').addEventListener('click', () => {
    const iframe = document.querySelector('#previewContainer iframe');
    if (iframe) {
        iframe.contentWindow.print();
    }
});
