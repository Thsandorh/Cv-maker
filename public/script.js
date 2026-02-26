let currentMode = 'structured';

document.addEventListener('DOMContentLoaded', () => {
    // Add initial empty fields
    addExperience();
    addEducation();

    // PayPal Skeleton (Commented out for future use)
    /*
    const initPayPal = () => {
        // Mock PayPal SDK initialization
        console.log("PayPal SDK Ready");
    };
    initPayPal();
    */
});

function switchMode(mode) {
    currentMode = mode;
    const structuredBtn = document.getElementById('structuredModeBtn');
    const bulkBtn = document.getElementById('bulkModeBtn');
    const structuredSections = document.getElementById('structuredSections');
    const bulkSection = document.getElementById('bulkSection');

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
    }
}

function addExperience() {
    const container = document.getElementById('experienceList');
    const div = document.createElement('div');
    div.className = 'experience-entry group animate-in fade-in duration-300';
    div.innerHTML = `
        <button type="button" class="remove-btn opacity-0 group-hover:opacity-100 transition-opacity" onclick="this.parentElement.remove()">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
        </button>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <input type="text" placeholder="Company Name" class="p-3 bg-white/50 border border-gray-100 rounded-xl company focus:ring-2 focus:ring-indigo-200 outline-none transition-all" required>
            <input type="text" placeholder="Job Title" class="p-3 bg-white/50 border border-gray-100 rounded-xl title focus:ring-2 focus:ring-indigo-200 outline-none transition-all" required>
            <input type="text" placeholder="Duration (e.g. 2020 - Present)" class="p-3 bg-white/50 border border-gray-100 rounded-xl duration focus:ring-2 focus:ring-indigo-200 outline-none transition-all">
            <input type="text" placeholder="Location" class="p-3 bg-white/50 border border-gray-100 rounded-xl location focus:ring-2 focus:ring-indigo-200 outline-none transition-all">
        </div>
        <textarea placeholder="Key Responsibilities & Achievements" class="w-full mt-3 p-3 bg-white/50 border border-gray-100 rounded-xl description focus:ring-2 focus:ring-indigo-200 outline-none transition-all" rows="2"></textarea>
    `;
    container.appendChild(div);
}

function addEducation() {
    const container = document.getElementById('educationList');
    const div = document.createElement('div');
    div.className = 'education-entry group animate-in fade-in duration-300';
    div.innerHTML = `
        <button type="button" class="remove-btn opacity-0 group-hover:opacity-100 transition-opacity" onclick="this.parentElement.remove()">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
        </button>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <input type="text" placeholder="Institution" class="p-3 bg-white/50 border border-gray-100 rounded-xl institution focus:ring-2 focus:ring-indigo-200 outline-none transition-all" required>
            <input type="text" placeholder="Degree / Qualification" class="p-3 bg-white/50 border border-gray-100 rounded-xl degree focus:ring-2 focus:ring-indigo-200 outline-none transition-all" required>
            <input type="text" placeholder="Year of Graduation" class="p-3 bg-white/50 border border-gray-100 rounded-xl year focus:ring-2 focus:ring-indigo-200 outline-none transition-all">
            <input type="text" placeholder="Field of Study" class="p-3 bg-white/50 border border-gray-100 rounded-xl field focus:ring-2 focus:ring-indigo-200 outline-none transition-all">
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

            // Gather Experience
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

            // Gather Education
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
            alert('The profile picture is too large. Please select an image smaller than 4MB.');
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
            throw new Error(errorText || 'Failed to generate CV');
        }

        const htmlContent = await response.text();
        displayCV(htmlContent);
    } catch (error) {
        console.error('Error:', error);
        alert('An error occurred: ' + error.message);
    } finally {
        loadingOverlay.classList.add('hidden');
    }
});

function displayCV(html) {
    const container = document.getElementById('previewContainer');
    container.innerHTML = ''; // Clear placeholder

    const iframe = document.createElement('iframe');
    container.appendChild(iframe);

    const doc = iframe.contentWindow.document;
    doc.open();
    doc.write(html);
    doc.close();

    document.getElementById('downloadPdf').classList.remove('hidden');

    // Smooth scroll to preview on mobile
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
