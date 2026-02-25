document.addEventListener('DOMContentLoaded', () => {
    // Add initial empty fields
    addExperience();
    addEducation();
});

function addExperience() {
    const container = document.getElementById('experienceList');
    const div = document.createElement('div');
    div.className = 'experience-entry';
    div.innerHTML = `
        <span class="remove-btn" onclick="this.parentElement.remove()">Remove</span>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <input type="text" placeholder="Company Name" class="p-2 border rounded company" required>
            <input type="text" placeholder="Job Title" class="p-2 border rounded title" required>
            <input type="text" placeholder="Duration (e.g. 2020 - Present)" class="p-2 border rounded duration">
            <input type="text" placeholder="Location" class="p-2 border rounded location">
        </div>
        <textarea placeholder="Key Responsibilities & Achievements" class="w-full mt-2 p-2 border rounded description" rows="2"></textarea>
    `;
    container.appendChild(div);
}

function addEducation() {
    const container = document.getElementById('educationList');
    const div = document.createElement('div');
    div.className = 'education-entry';
    div.innerHTML = `
        <span class="remove-btn" onclick="this.parentElement.remove()">Remove</span>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <input type="text" placeholder="Institution" class="p-2 border rounded institution" required>
            <input type="text" placeholder="Degree / Qualification" class="p-2 border rounded degree" required>
            <input type="text" placeholder="Year of Graduation" class="p-2 border rounded year">
            <input type="text" placeholder="Field of Study" class="p-2 border rounded field">
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
