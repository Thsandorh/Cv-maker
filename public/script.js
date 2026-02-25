document.addEventListener('DOMContentLoaded', () => {
    // Add initial empty fields
    addExperience();
    addEducation();
});

function addExperience() {
    const container = document.getElementById('experienceList');
    const div = document.createElement('div');
    div.className = 'experience-entry group';
    div.innerHTML = `
        <button type="button" class="remove-btn opacity-0 group-hover:opacity-100 transition-opacity" onclick="this.parentElement.remove()">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
        </button>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <input type="text" placeholder="Company Name" class="p-2 border rounded company focus:ring-2 focus:ring-indigo-200 outline-none" required>
            <input type="text" placeholder="Job Title" class="p-2 border rounded title focus:ring-2 focus:ring-indigo-200 outline-none" required>
            <input type="text" placeholder="Duration (e.g. 2020 - Present)" class="p-2 border rounded duration focus:ring-2 focus:ring-indigo-200 outline-none">
            <input type="text" placeholder="Location" class="p-2 border rounded location focus:ring-2 focus:ring-indigo-200 outline-none">
        </div>
        <textarea placeholder="Key Responsibilities & Achievements" class="w-full mt-2 p-2 border rounded description focus:ring-2 focus:ring-indigo-200 outline-none" rows="2"></textarea>
    `;
    container.appendChild(div);
}

function addEducation() {
    const container = document.getElementById('educationList');
    const div = document.createElement('div');
    div.className = 'education-entry group';
    div.innerHTML = `
        <button type="button" class="remove-btn opacity-0 group-hover:opacity-100 transition-opacity" onclick="this.parentElement.remove()">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
        </button>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <input type="text" placeholder="Institution" class="p-2 border rounded institution focus:ring-2 focus:ring-indigo-200 outline-none" required>
            <input type="text" placeholder="Degree / Qualification" class="p-2 border rounded degree focus:ring-2 focus:ring-indigo-200 outline-none" required>
            <input type="text" placeholder="Year of Graduation" class="p-2 border rounded year focus:ring-2 focus:ring-indigo-200 outline-none">
            <input type="text" placeholder="Field of Study" class="p-2 border rounded field focus:ring-2 focus:ring-indigo-200 outline-none">
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
            summary: formData.get('summary'),
            skills: formData.get('skills'),
            experience: [],
            education: []
        };

        // Gather Experience
        document.querySelectorAll('.experience-entry').forEach(entry => {
            userData.experience.push({
                company: entry.querySelector('.company').value,
                title: entry.querySelector('.title').value,
                duration: entry.querySelector('.duration').value,
                location: entry.querySelector('.location').value,
                description: entry.querySelector('.description').value
            });
        });

        // Gather Education
        document.querySelectorAll('.education-entry').forEach(entry => {
            userData.education.push({
                institution: entry.querySelector('.institution').value,
                degree: entry.querySelector('.degree').value,
                year: entry.querySelector('.year').value,
                field: entry.querySelector('.field').value
            });
        });

        const theme = document.getElementById('theme').value;
        const profilePicture = document.getElementById('profilePicture').files[0];

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
            throw new Error('Failed to generate CV');
        }

        const htmlContent = await response.text();
        displayCV(htmlContent);
    } catch (error) {
        console.error('Error:', error);
        alert('An error occurred while generating your CV. Please try again.');
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
}

document.getElementById('downloadPdf').addEventListener('click', () => {
    const iframe = document.querySelector('#previewContainer iframe');
    if (iframe) {
        iframe.contentWindow.print();
    }
});
