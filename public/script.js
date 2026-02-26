
// Globális változók explicit deklarálása
// window.currentMode a HTML-ben lévő inline scriptben van definiálva

function init() {
    console.log("Initialization started. readyState:", document.readyState);

    // Eseménykezelők hozzáadása a gombokhoz
    const structuredBtn = document.getElementById('structuredModeBtn');
    const bulkBtn = document.getElementById('bulkModeBtn');

    if (structuredBtn) {
        structuredBtn.addEventListener('click', () => window.switchMode('structured'));
    }
    if (bulkBtn) {
        bulkBtn.addEventListener('click', () => window.switchMode('bulk'));
    }

    // Kezdeti üres mezők hozzáadása - Most már a window.addExperience-t hívjuk
    if (typeof window.addExperience === 'function') window.addExperience();
    if (typeof window.addEducation === 'function') window.addEducation();

    // PayPal Előkészítés (Jövőbeli használatra)
    /*
    const initPayPal = () => {
        console.log("PayPal SDK Kész");
    };
    initPayPal();
    */

    // Event listener hozzáadása a form elküldéséhez (Most már HTML onsubmit attribútum kezeli)
    // Csak a log miatt hagyjuk itt a check-et
    const cvForm = document.getElementById('cvForm');
    if (cvForm) {
        console.log("CV Form found.");
    } else {
        console.error("Critical Error: CV Form not found!");
    }
}

// Robust initialization pattern
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}

async function handleFormSubmit(e) {
    e.preventDefault();
    console.log("Form submit intercepted. Mode:", window.currentMode);

    const loadingOverlay = document.getElementById('loadingOverlay');
    if (loadingOverlay) loadingOverlay.classList.remove('hidden');

    try {
        const formData = new FormData(e.target);
        const userData = {
            fullName: formData.get('fullName'),
            email: formData.get('email'),
            phone: formData.get('phone'),
            location: formData.get('location'),
            mode: window.currentMode || 'structured' // Fallback
        };

        if (window.currentMode === 'structured') {
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
            // Validate Bulk Mode input manually
            const bulkText = formData.get('bulkData');
            if (!bulkText || bulkText.trim().length < 10) {
                alert('Kérlek írj be legalább néhány mondatot a szabad szöveges mezőbe!');
                if (loadingOverlay) loadingOverlay.classList.add('hidden');
                return;
            }
            userData.bulkData = bulkText;
        }

        const theme = document.getElementById('theme').value;
        const profilePicture = document.getElementById('profilePicture').files[0];

        if (profilePicture && profilePicture.size > 4 * 1024 * 1024) {
            alert('A profilkép túl nagy. Kérlek válassz 4MB-nál kisebb képet.');
            if (loadingOverlay) loadingOverlay.classList.add('hidden');
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
        if (loadingOverlay) loadingOverlay.classList.add('hidden');
    }
}

function displayCV(html) {
    const container = document.getElementById('previewContainer');
    if (!container) return;

    container.innerHTML = ''; // Helyőrző törlése

    const iframe = document.createElement('iframe');
    container.appendChild(iframe);

    const doc = iframe.contentWindow.document;
    doc.open();
    doc.write(html);
    doc.close();

    const downloadBtn = document.getElementById('downloadPdf');
    if (downloadBtn) downloadBtn.classList.remove('hidden');

    // Mobilnézeten görgetés az előnézethez
    if (window.innerWidth < 1024) {
        container.scrollIntoView({ behavior: 'smooth' });
    }
}

const downloadBtn = document.getElementById('downloadPdf');
if (downloadBtn) {
    downloadBtn.addEventListener('click', () => {
        const iframe = document.querySelector('#previewContainer iframe');
        if (iframe) {
            iframe.contentWindow.print();
        }
    });
}
